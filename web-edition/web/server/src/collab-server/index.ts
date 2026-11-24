// Realtime collaboration server — standalone process (run with `npm run dev:collab`),
// separate from the API per the plan (docs/plans/2026-10-12-noteriv-web-version.md §8).
//
// Hand-rolls the Yjs websocket sync protocol directly against `yjs` + `y-protocols`
// instead of depending on the `y-websocket` package's CJS server utils, which avoids
// ESM/CJS interop friction in this `"type": "module"` project. The wire protocol here
// matches y-websocket's reference server exactly, so `y-websocket`'s client-side
// `WebsocketProvider` (used in web/src/lib/collab.ts) works against it unmodified.

import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { PrismaClient } from "@prisma/client";
import { parseCookie } from "cookie";
import jwt from "jsonwebtoken";
import { recomputeBacklinksForNote } from "../lib/backlinks.js";
import { snapshotBeforeOverwrite } from "../lib/noteSnapshots.js";
import { captureError, initSentry } from "../lib/sentry.js";
import { isAllowedOrigin } from "../lib/collabOrigin.js";

// Uncaught exceptions and unhandled rejections go to Sentry when it is configured (the SDK's default handlers).
initSentry("collab");

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const PERSIST_DEBOUNCE_MS = 2500;

const prisma = new PrismaClient();

interface Room {
  noteId: string;
  vaultId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket>;
  persistTimer: ReturnType<typeof setTimeout> | null;
  /** Which awareness client IDs each socket has announced, so disconnect can clear exactly those. */
  connAwarenessIds: Map<WebSocket, Set<number>>;
  /** The note's DB content as of the room's load or last persist; anything else in the DB was written by someone else. */
  baseContent: string;
  /** Sockets of viewers: they receive updates but their edits are ignored. */
  readOnly: Set<WebSocket>;
  /** Clients past auth whose upgrade hasn't completed yet; the room must not be dropped under them. */
  joining: number;
}

const rooms = new Map<string, Room>();
/** Rooms being created, so two clients joining a new note at once share one room. */
const pendingRooms = new Map<string, Promise<Room>>();

function getOrCreateRoom(noteId: string, vaultId: string): Promise<Room> {
  const existing = rooms.get(noteId);
  if (existing) return Promise.resolve(existing);
  let pending = pendingRooms.get(noteId);
  if (!pending) {
    pending = createRoom(noteId, vaultId).finally(() => pendingRooms.delete(noteId));
    pendingRooms.set(noteId, pending);
  }
  return pending;
}

async function createRoom(noteId: string, vaultId: string): Promise<Room> {
  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { content: true } });
  if (note && ytext.length === 0) {
    ytext.insert(0, note.content);
  }

  const awareness = new awarenessProtocol.Awareness(doc);
  const room: Room = {
    noteId,
    vaultId,
    doc,
    awareness,
    clients: new Set(),
    persistTimer: null,
    connAwarenessIds: new Map(),
    baseContent: note?.content ?? "",
    readOnly: new Set(),
    joining: 0,
  };

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    broadcast(room, message, origin as WebSocket | undefined);
    schedulePersist(room);
  });

  awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = added.concat(updated, removed);
    if (origin instanceof WebSocket || (origin && room.clients.has(origin as WebSocket))) {
      const ws = origin as WebSocket;
      const ids = room.connAwarenessIds.get(ws) ?? new Set<number>();
      for (const id of added.concat(updated)) ids.add(id);
      for (const id of removed) ids.delete(id);
      room.connAwarenessIds.set(ws, ids);
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    broadcast(room, encoding.toUint8Array(encoder), origin as WebSocket | undefined);
  });

  rooms.set(noteId, room);
  return room;
}

function broadcast(room: Room, message: Uint8Array, exclude?: WebSocket) {
  for (const client of room.clients) {
    if (client !== exclude && client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Writes the room's text to the note. If the DB content changed behind the room's back
 * (a sync import, an edit outside collaboration), that version is kept as a snapshot
 * first so File Recovery can bring it back — the room never silently erases it.
 */
async function persistRoom(room: Room): Promise<void> {
  const content = room.doc.getText("content").toString();
  try {
    const current = await prisma.note.findUnique({ where: { id: room.noteId }, select: { content: true, deletedAt: true } });
    if (!current || current.deletedAt) return; // deleted or trashed meanwhile: don't write into the trash
    if (current.content === content) {
      room.baseContent = content;
      return;
    }
    if (current.content !== room.baseContent) {
      await snapshotBeforeOverwrite(prisma, room.noteId, current.content);
    }
    await prisma.note.update({ where: { id: room.noteId }, data: { content, sizeBytes: Buffer.byteLength(content, "utf8") } });
    room.baseContent = content;
    await recomputeBacklinksForNote(prisma, room.vaultId, room.noteId, content);
  } catch (err) {
    console.error(`[collab-server] failed to persist note ${room.noteId}:`, err);
    captureError(err, { tags: { step: "persist" } });
  }
}

function schedulePersist(room: Room) {
  if (room.persistTimer) clearTimeout(room.persistTimer);
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void persistRoom(room);
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Last client left: flush any pending write, then drop the room so the next visitor
 * starts from the DB (which may have changed since — e.g. a sync import). A room kept
 * alive forever used to overwrite such changes with its stale text on the next edit.
 */
async function closeRoomIfEmpty(room: Room): Promise<void> {
  if (room.clients.size > 0 || room.joining > 0) return;
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
    room.persistTimer = null;
    await persistRoom(room);
  }
  if (room.clients.size > 0 || room.joining > 0 || rooms.get(room.noteId) !== room) return; // someone (re)joined meanwhile
  rooms.delete(room.noteId);
  room.awareness.destroy();
  room.doc.destroy();
}

async function authenticate(cookieHeader: string | undefined): Promise<{ userId: string } | null> {
  if (!cookieHeader) return null;
  const cookies = parseCookie(cookieHeader);
  const token = cookies["noteriv_access"];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as { sub: string };
    // A locked account (admin page) cannot open new connections; open ones end with the access token.
    const account = await prisma.user.findUnique({ where: { id: payload.sub }, select: { lockedAt: true } });
    if (!account || account.lockedAt) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

/** Members may join a live (not trashed) note; viewers join read-only. */
async function canAccessNote(userId: string, noteId: string): Promise<{ vaultId: string; canWrite: boolean } | null> {
  const note = await prisma.note.findUnique({ where: { id: noteId }, select: { vaultId: true, deletedAt: true } });
  if (!note || note.deletedAt) return null;
  const vault = await prisma.vault.findUnique({ where: { id: note.vaultId }, select: { workspaceId: true } });
  if (!vault) return null;
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: vault.workspaceId, userId } },
  });
  return membership ? { vaultId: note.vaultId, canWrite: membership.role !== "viewer" } : null;
}


const httpServer = createServer();
const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

httpServer.on("upgrade", async (request, socket, head) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/collab\/notes\/([^/]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const noteId = match[1];

  const auth = await authenticate(request.headers.cookie);
  if (!auth) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const access = await canAccessNote(auth.userId, noteId);
  if (!access) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }

  // Load the room BEFORE completing the upgrade: the client sends its sync step 1 as soon
  // as the socket opens, and a message arriving before the handlers below are attached is
  // dropped — the joining client then never received the document.
  const room = await getOrCreateRoom(noteId, access.vaultId);
  room.joining++;
  let joined = false;
  socket.once("close", () => {
    // Upgrade never completed (client went away): stop holding the room open.
    if (joined) return;
    joined = true;
    room.joining--;
    void closeRoomIfEmpty(room);
  });

  wss.handleUpgrade(request, socket, head, (ws) => {
    if (!joined) {
      joined = true;
      room.joining--;
    }
    room.clients.add(ws);
    if (!access.canWrite) room.readOnly.add(ws);

    // Initial sync: tell the new client what we have (step 1), and ask for theirs.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, room.doc);
    ws.send(encoding.toUint8Array(syncEncoder));

    const awarenessStates = room.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys()))
      );
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }

    ws.on("message", (data: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        if (room.readOnly.has(ws)) {
          // Viewers may ask for the document (step 1) but their step 2 / updates are dropped.
          const syncType = decoding.readVarUint(decoder);
          if (syncType === syncProtocol.messageYjsSyncStep1) {
            syncProtocol.readSyncStep1(decoder, encoder, room.doc);
          }
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        }
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        // `connAwarenessIds` bookkeeping for this socket happens in the room-level
        // awareness "update" listener (it receives `origin === ws` for this call).
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws);
      }
    });

    ws.on("close", () => {
      room.clients.delete(ws);
      room.readOnly.delete(ws);
      const ids = room.connAwarenessIds.get(ws);
      if (ids && ids.size > 0) {
        awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(ids), null);
      }
      room.connAwarenessIds.delete(ws);
      void closeRoomIfEmpty(room);
    });
  });
});

const port = Number(process.env.COLLAB_PORT ?? 4002);
httpServer.listen(port, () => {
  console.log(`noteriv collab-server listening on :${port}`);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
