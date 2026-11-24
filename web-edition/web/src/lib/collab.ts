/**
 * Live collaboration — ported from desktop/src/lib/collab.ts with the transport
 * swapped from WebRTC (P2P, no server, fine for a single-user desktop app) to a
 * WebSocket relay (web/server/src/collab-server): web clients are frequently
 * behind NATs/firewalls that can't discover each other directly, so a central
 * relay is required. Everything else — the Y.Doc, awareness, room-id shape —
 * is unchanged from desktop.
 *
 * Unlike desktop, a web note already has a durable identity (its id), so there
 * is no "generate/share a room code" step: the room IS `note:{noteId}`, and
 * anyone with access to the note is automatically in the same room.
 */

export interface CollabSession {
  noteId: string;
  connected: boolean;
  /**
   * Pushes this client's current editor content into the shared Yjs text.
   * Whole-content replace (not granular insert/delete at the cursor) — matches
   * the level of sophistication desktop's own collab.ts already had; a proper
   * CodeMirror<->Yjs binding (granular ops, preserving remote cursors through
   * local edits) is further work, not a Phase 5 regression.
   */
  pushLocalText: (content: string) => void;
  destroy: () => void;
}

export interface CollabPeer {
  clientId: number;
  name: string;
  color: string;
}

const COLLAB_COLORS = [
  "#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8", "#cba6f7",
  "#fab387", "#94e2d5", "#f5c2e7", "#89dceb", "#b4befe",
];

export function getCollabColor(): string {
  return COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)];
}

/** Get or create a persistent user-display name for collaboration (per-browser, not per-account). */
export function getCollabUserName(displayName?: string): string {
  if (displayName) return displayName;
  if (typeof localStorage === "undefined") return "Anonymous";
  let name = localStorage.getItem("noteriv-collab-name");
  if (!name) {
    name = `User-${Math.floor(Math.random() * 9999)}`;
    localStorage.setItem("noteriv-collab-name", name);
  }
  return name;
}

function collabServerUrl(noteId: string): string {
  const base = process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? "ws://127.0.0.1:4002";
  return `${base}/collab/notes/${noteId}`;
}

/** Joins the realtime collaboration room for a note. Returns null if the connection never opens. */
export async function startCollab(
  noteId: string,
  initialContent: string,
  onUpdate: (content: string) => void,
  onPeersChange: (peers: CollabPeer[]) => void,
  userName?: string
): Promise<CollabSession | null> {
  const Y = await import("yjs");
  const { WebsocketProvider } = await import("y-websocket");

  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  // Deliberately NOT seeding `ytext` from `initialContent` here (desktop's P2P
  // version did, since there was no server to be the source of truth). With a
  // server-backed room, the collab server already seeds its doc from Postgres
  // the first time the room is created (collab-server/index.ts). If every
  // client also inserted its own local copy before the sync handshake
  // completed, Yjs would merge two independent "insert at 0" ops as two
  // concurrent edits — duplicating the text. Let the websocket sync bring the
  // server's content down instead; `initialContent` is now unused but kept as
  // a parameter for API-shape parity / future offline-first use.
  void initialContent;

  const url = collabServerUrl(noteId);
  const wsBase = url.slice(0, url.lastIndexOf("/"));
  const roomName = url.slice(url.lastIndexOf("/") + 1);
  const provider = new WebsocketProvider(wsBase, roomName, doc, { connect: true });

  const LOCAL_PUSH_ORIGIN = "local-push";
  ytext.observe((_event, transaction) => {
    if (transaction.origin === LOCAL_PUSH_ORIGIN) return; // we already have this text locally
    onUpdate(ytext.toString());
  });

  const awareness = provider.awareness;
  const localUser = { name: getCollabUserName(userName), color: getCollabColor() };
  awareness.setLocalStateField("user", localUser);

  const emitPeers = () => {
    const peers: CollabPeer[] = [];
    awareness.getStates().forEach((state: Record<string, unknown>, clientId: number) => {
      if (clientId === doc.clientID) return; // exclude self
      const user = state.user as { name: string; color: string } | undefined;
      if (user) peers.push({ clientId, name: user.name, color: user.color });
    });
    onPeersChange(peers);
  };
  awareness.on("change", emitPeers);

  const session: CollabSession = {
    noteId,
    connected: true,
    pushLocalText(content: string) {
      if (ytext.toString() === content) return;
      doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, content);
      }, LOCAL_PUSH_ORIGIN);
    },
    destroy() {
      awareness.off("change", emitPeers);
      provider.disconnect();
      provider.destroy();
      doc.destroy();
      session.connected = false;
    },
  };

  return session;
}
