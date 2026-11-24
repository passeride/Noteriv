import { ApiError, type StaleNote } from "./webApi";

/**
 * True when a request failed for want of a server rather than because the server said no: no network (fetch rejects
 * with a TypeError), or the proxy answering that the app behind it is unreachable.
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 502 || err.status === 503 || err.status === 504;
  return err instanceof TypeError;
}

/** The 409 a save gets when the note changed elsewhere since the edit started (the server kept both). */
export function staleNote(err: unknown): StaleNote | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as Partial<StaleNote> | null;
  return body?.error === "stale" && body.note && body.copy ? (body as StaleNote) : null;
}

/**
 * Which stored notes to drop so at most `maxCount` notes and `maxBytes` of text remain: the least recently used first.
 */
export function pickEvictions(entries: { id: string; size: number; touchedAt: number }[], maxCount: number, maxBytes: number): string[] {
  const newestFirst = [...entries].sort((a, b) => b.touchedAt - a.touchedAt);
  const drop: string[] = [];
  let count = 0;
  let bytes = 0;
  for (const e of newestFirst) {
    if (count + 1 > maxCount || bytes + e.size > maxBytes) {
      drop.push(e.id);
      continue;
    }
    count++;
    bytes += e.size;
  }
  return drop;
}
