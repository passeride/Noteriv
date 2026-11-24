// Sends the edits kept on this device (offline-store "pending") once the server can be reached again.

import { ApiError, webApi, type ApiNote, type StaleNote } from "@/lib/webApi";
import { contentHash } from "@/lib/content-hash";
import { staleNote } from "@/lib/offline";
import { dropPendingEdit, pendingEdits, storeNote, type PendingEdit } from "@/lib/offline-store";

export interface FlushResult {
  saved: { edit: PendingEdit; note: ApiNote }[];
  /** Changed elsewhere meanwhile: the server kept the stored note and saved the edit as a conflict copy. */
  conflicts: { edit: PendingEdit; stale: StaleNote }[];
  /** Still waiting (no network); kept for the next try. */
  waiting: number;
}

let inFlight: Promise<FlushResult> | null = null;

/**
 * Sends every waiting edit (of one vault, or all), except those of `skip` (notes open in a tab, which saves them
 * itself). One run at a time; a second caller gets the running one.
 */
export function flushPending(vaultId?: string, skip: Set<string> = new Set()): Promise<FlushResult> {
  if (!inFlight) {
    inFlight = run(vaultId, skip).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(vaultId: string | undefined, skip: Set<string>): Promise<FlushResult> {
  const result: FlushResult = { saved: [], conflicts: [], waiting: 0 };
  for (const edit of await pendingEdits(vaultId)) {
    if (skip.has(edit.noteId)) continue;
    try {
      const baseHash = (await contentHash(edit.base)) ?? undefined;
      const note = await webApi.notes.update(edit.vaultId, edit.noteId, { content: edit.content, baseHash });
      await dropPendingEdit(edit.noteId);
      await storeNote({ id: note.id, vaultId: note.vaultId, path: note.path, name: note.name, content: note.content });
      result.saved.push({ edit, note });
    } catch (err) {
      const stale = staleNote(err);
      if (stale) {
        await dropPendingEdit(edit.noteId);
        await storeNote({ id: stale.note.id, vaultId: stale.note.vaultId, path: stale.note.path, name: stale.note.name, content: stale.note.content });
        result.conflicts.push({ edit, stale });
      } else if (err instanceof ApiError && [400, 403, 404].includes(err.status)) {
        // The server refused for good (note deleted meanwhile, access removed): nothing left to retry.
        await dropPendingEdit(edit.noteId);
      } else {
        // No network, server trouble, or a session to renew by signing in again: kept for the next try.
        result.waiting++;
      }
    }
  }
  return result;
}
