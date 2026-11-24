// What the web app keeps on this device so a vault opened before still opens without a network (stage 4, session 4.8):
//
// - kv:      vault list, vault, file index and open tabs per vault, the account the data belongs to;
// - notes:   the text of recently opened notes (at most MAX_NOTES / MAX_BYTES, least recently used dropped first);
// - pending: edits not yet accepted by the server, with the server text they started from. Sent again when online.
//
// IndexedDB without a library. Every call is best effort: where IndexedDB is unavailable or full (private mode, quota)
// the app simply works online-only, as before.

import { pickEvictions } from "@/lib/offline";

const DB_NAME = "noteriv-offline";
const DB_VERSION = 1;
const MAX_NOTES = 300;
const MAX_BYTES = 25 * 1024 * 1024;

export interface StoredNote {
  id: string;
  vaultId: string;
  path: string;
  name: string;
  content: string;
  touchedAt: number;
}

export interface PendingEdit {
  noteId: string;
  vaultId: string;
  path: string;
  name: string;
  /** The edited text to send. */
  content: string;
  /** The server text the edit started from; its hash goes with the save so a conflict is detected. */
  base: string;
  queuedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
          if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id" });
          if (!db.objectStoreNames.contains("pending")) db.createObjectStore("pending", { keyPath: "noteId" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

type StoreName = "kv" | "notes" | "pending";

/** Runs `fn` in one transaction and resolves with its request's result (undefined on any failure). */
async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const kvGet = <T>(key: string) => run<T>("kv", "readonly", (s) => s.get(key));
export const kvSet = (key: string, value: unknown) => run("kv", "readwrite", (s) => void s.put(value, key));

export const getStoredNote = (id: string) => run<StoredNote>("notes", "readonly", (s) => s.get(id));

/** Keeps a note's text on this device, then drops the least recently used notes beyond the limits. */
export async function storeNote(note: Omit<StoredNote, "touchedAt">): Promise<void> {
  await run("notes", "readwrite", (s) => void s.put({ ...note, touchedAt: Date.now() }));
  const all = (await run<StoredNote[]>("notes", "readonly", (s) => s.getAll())) ?? [];
  if (all.length <= MAX_NOTES / 2 && all.reduce((n, x) => n + x.content.length, 0) < MAX_BYTES / 2) return;
  const drop = pickEvictions(
    all.map((x) => ({ id: x.id, size: x.content.length * 2, touchedAt: x.touchedAt })),
    MAX_NOTES,
    MAX_BYTES
  );
  if (drop.length) await run("notes", "readwrite", (s) => void drop.forEach((id) => s.delete(id)));
}

export const forgetNote = (id: string) => run("notes", "readwrite", (s) => void s.delete(id));

export async function pendingEdits(vaultId?: string): Promise<PendingEdit[]> {
  const all = (await run<PendingEdit[]>("pending", "readonly", (s) => s.getAll())) ?? [];
  return vaultId ? all.filter((p) => p.vaultId === vaultId) : all;
}
export const getPendingEdit = (noteId: string) => run<PendingEdit>("pending", "readonly", (s) => s.get(noteId));
export const putPendingEdit = (edit: PendingEdit) => run("pending", "readwrite", (s) => void s.put(edit));
export const dropPendingEdit = (noteId: string) => run("pending", "readwrite", (s) => void s.delete(noteId));

/** Forgets everything stored (sign-out). */
export async function clearOfflineData(): Promise<void> {
  for (const store of ["kv", "notes", "pending"] as const) await run(store, "readwrite", (s) => void s.clear());
}

/** The stored data belongs to one account: another one signing in on this browser starts from nothing. */
export async function claimOfflineData(userId: string): Promise<void> {
  const owner = await kvGet<string>("owner");
  if (owner === userId) return;
  if (owner) await clearOfflineData();
  await kvSet("owner", userId);
}
