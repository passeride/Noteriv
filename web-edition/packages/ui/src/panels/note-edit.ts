import type { VaultAdapter } from "@noteriv/core/vault-adapter";

/**
 * Changes a note's text with `transform` (null = leave it). The app passes one that goes through the note's open tab
 * when it has one, so the tab shows the change and saves it itself (writing under an open tab would make its next
 * save look stale). Resolves to whether the note changed.
 */
export type NoteEditor = (id: string, transform: (text: string) => string | null) => Promise<boolean>;

/** `fn` over `items`, at most `limit` at a time (reading every note of a large vault must not open thousands of requests). */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A NoteEditor that reads and writes through the adapter, never over a version changed in between (one retry). */
export function adapterNoteEditor(adapter: VaultAdapter): NoteEditor {
  return async (id, transform) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await adapter.readNote(id);
      if (text === null) return false;
      const next = transform(text);
      if (next === null || next === text) return false;
      if (!adapter.writeNoteIfUnchanged) {
        await adapter.writeNote(id, next);
        return true;
      }
      if (await adapter.writeNoteIfUnchanged(id, next, text)) return true;
    }
    return false;
  };
}
