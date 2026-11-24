/**
 * Conflict copies: when sync finds a note changed on both sides it keeps the local version at the note's path and
 * saves the other version next to it as `<name> (conflict YYYY-MM-DD HHmm[ N]).<ext>` (web server and desktop git
 * sync use the same pattern). This recognises such a path and tells which note it belongs to.
 */

const CONFLICT_RE = /^(.*) \(conflict (\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})(?: \d+)?\)(\.[^./]*)?$/;

export interface ConflictCopyInfo {
  /** Vault-relative path of the note the copy belongs to. */
  originalPath: string;
  /** When the conflict was found, as written in the name (UTC), e.g. `2026-10-17 01:53`. */
  stamp: string;
}

/** `notes/a (conflict 2026-10-17 0153).md` → `{ originalPath: "notes/a.md", stamp: "2026-10-17 01:53" }`; otherwise null. */
export function parseConflictCopy(path: string): ConflictCopyInfo | null {
  const m = CONFLICT_RE.exec(path);
  if (!m) return null;
  const [, stem, date, hh, mm, ext] = m;
  if (!stem || stem.endsWith("/")) return null;
  return { originalPath: `${stem}${ext ?? ""}`, stamp: `${date} ${hh}:${mm}` };
}

export function isConflictCopy(path: string): boolean {
  return parseConflictCopy(path) !== null;
}

/**
 * Names for a conflict copy of `path`, in the order to try: `notes/a (conflict 2026-10-17 0153).md`, then
 * `… 0153 2).md`, and so on. The stamp is `now` in UTC, as web/server/src/lib/gitSync.ts and the desktop's git
 * sync write it (both keep their own copy: the server image cannot read packages/).
 */
export function* conflictCopyCandidates(path: string, now = new Date()): Generator<string> {
  const slash = path.lastIndexOf("/");
  const dirPart = slash === -1 ? "" : path.slice(0, slash + 1);
  const file = slash === -1 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10)} ${iso.slice(11, 13)}${iso.slice(14, 16)}`;
  for (let n = 1; ; n++) yield `${dirPart}${stem} (conflict ${stamp}${n > 1 ? ` ${n}` : ""})${ext}`;
}

/** The first conflict copy name for `path` that `taken` says is free. */
export function conflictCopyPath(path: string, taken: (candidate: string) => boolean, now = new Date()): string {
  for (const candidate of conflictCopyCandidates(path, now)) if (!taken(candidate)) return candidate;
  throw new Error("unreachable");
}
