// End-to-end check of the collaboration server against the dev database:
// editors write, viewers are read-only, trashed notes are refused, an emptied room is
// dropped (so a later sync import is not overwritten), and content changed behind a
// live room is kept as a snapshot. Run: npx tsx scripts/test-collab.ts
// Starts its own collab-server on COLLAB_TEST_PORT (default 4092) and removes everything it creates.

import { PrismaClient } from "@prisma/client";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import WebSocket from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

if (existsSync(".env")) process.loadEnvFile(".env");
const SECRET = process.env.JWT_ACCESS_SECRET;
if (!SECRET) throw new Error("JWT_ACCESS_SECRET is not set (web/server/.env)");
const PORT = Number(process.env.COLLAB_TEST_PORT ?? 4092);

const prisma = new PrismaClient();
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client {
  ws: WebSocket;
  doc: Y.Doc;
  text: () => string;
  edit: (fn: (t: Y.Text) => void) => void;
  close: () => Promise<void>;
}

/** A minimal y-websocket client: joins the note's room as `userId`. Rejects on a refused upgrade. */
function connect(userId: string, noteId: string): Promise<Client> {
  const token = jwt.sign({ sub: userId }, SECRET!, { expiresIn: "10m" });
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/collab/notes/${noteId}`, { headers: { Cookie: `noteriv_access=${token}` } });
  const doc = new Y.Doc();
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  });
  return new Promise((resolve, reject) => {
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on("error", reject);
    ws.on("message", (data: Buffer) => {
      const dec = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(dec) !== 0) return; // awareness: ignored
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.readSyncMessage(dec, enc, doc, "remote");
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    });
    ws.on("open", () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, doc);
      ws.send(encoding.toUint8Array(enc));
      resolve({
        ws,
        doc,
        text: () => doc.getText("content").toString(),
        edit: (fn) => doc.transact(() => fn(doc.getText("content"))),
        close: () => new Promise((r) => { ws.once("close", () => r()); ws.close(); }),
      });
    });
  });
}

async function main() {
  const owner = await prisma.user.create({ data: { email: `collab-owner-${Date.now()}@example.test`, displayName: "Owner" } });
  const viewer = await prisma.user.create({ data: { email: `collab-viewer-${Date.now()}@example.test`, displayName: "Viewer" } });
  const ws = await prisma.workspace.create({
    data: { name: "collab-test", ownerId: owner.id, members: { create: [{ userId: owner.id, role: "owner" }, { userId: viewer.id, role: "viewer" }] } },
  });
  const vault = await prisma.vault.create({ data: { name: "collab-test", workspaceId: ws.id } });
  const note = await prisma.note.create({ data: { vaultId: vault.id, name: "c.md", path: "c.md", content: "hello" } });
  const dbContent = async () => (await prisma.note.findUnique({ where: { id: note.id } }))!.content;

  const server: ChildProcess = spawn(process.execPath, ["--import", "tsx", path.join("src", "collab-server", "index.ts")], {
    env: { ...process.env, COLLAB_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => process.stderr.write(`[collab] ${d}`));
  try {
    await sleep(3000);

    // editor writes
    const ed = await connect(owner.id, note.id);
    await sleep(500);
    check("editor sees the note", ed.text() === "hello", ed.text());
    ed.edit((t) => t.insert(t.length, " world"));
    await sleep(3500);
    check("editor edit persisted", (await dbContent()) === "hello world", await dbContent());

    // viewer is read-only
    const vw = await connect(viewer.id, note.id);
    await sleep(500);
    check("viewer receives the document", vw.text() === "hello world", vw.text());
    vw.edit((t) => t.insert(0, "VIEWER "));
    await sleep(3500);
    check("viewer edit is not persisted", (await dbContent()) === "hello world", await dbContent());
    check("viewer edit is not broadcast", ed.text() === "hello world", ed.text());

    // content changed behind a live room is snapshotted before being overwritten
    await prisma.note.update({ where: { id: note.id }, data: { content: "changed behind the room" } });
    ed.edit((t) => t.insert(t.length, "!"));
    await sleep(3500);
    const snap = await prisma.noteSnapshot.findFirst({ where: { noteId: note.id, content: "changed behind the room" } });
    check("content changed behind the room kept as a snapshot", !!snap);

    // emptied room is dropped: a later DB change (e.g. sync import) is what the next visitor gets
    await vw.close();
    await ed.close();
    await sleep(1000);
    await prisma.note.update({ where: { id: note.id }, data: { content: "imported by sync" } });
    const ed2 = await connect(owner.id, note.id);
    await sleep(500);
    check("room reloaded from the DB after everyone left", ed2.text() === "imported by sync", ed2.text());
    await ed2.close();

    // trashed note is refused
    await prisma.note.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
    let refused = "";
    try {
      const c = await connect(owner.id, note.id);
      await c.close();
    } catch (e) {
      refused = (e as Error).message;
    }
    check("trashed note refused", refused === "HTTP 403", refused || "connected");
  } finally {
    server.kill();
    await prisma.vault.delete({ where: { id: vault.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: ws.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } }).catch(() => undefined);
  }
}

main()
  .catch((e) => {
    console.error("SCRIPT ERROR", e);
    failures++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
