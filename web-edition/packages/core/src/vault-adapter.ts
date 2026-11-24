/**
 * The storage seam between the UI and a vault.
 *
 * Web talks to a REST API and identifies notes by server id; desktop talks to the filesystem and identifies notes by
 * absolute path. `NoteRef.id` hides that difference: it is an opaque key the adapter understands and the UI only
 * passes back (bookmarks, tabs and selections store it as-is). `path` is always vault-relative with `/` separators
 * and is what the UI may show or parse.
 */

import type { Backlink as WikiBacklink } from "./wiki-link-utils";

export interface NoteRef {
  /** Opaque, adapter-specific key (web: note id, desktop: absolute path). */
  id: string;
  /** Vault-relative path with `/` separators, e.g. `openings/sicilian.md`. */
  path: string;
  /** File name without directories, e.g. `sicilian.md`. */
  name: string;
}

export interface NoteDates {
  createdAt: number;
  modifiedAt: number;
}

/** A saved past version of a note. */
export interface NoteSnapshotInfo {
  id: string;
  /** Milliseconds since epoch. */
  timestamp: number;
  size: number;
}

/** A git commit that touched a note. */
export interface NoteCommitInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface NoteBacklink {
  ref: NoteRef;
  /** 1-based line of the link. Absent when the backend cannot say (web). */
  line?: number;
  /** Text around the link. Absent when the backend cannot say (web). */
  snippet?: string;
}

export interface NoteSearchMatch {
  /** 1-based line number in the note. */
  line: number;
  /** The line's text (trimmed, may be shortened). */
  text: string;
}

export interface NoteSearchHit {
  ref: NoteRef;
  snippet: string;
  /** Matching lines, in order (a few per note). Absent when the backend only knows the note matched. */
  matches?: NoteSearchMatch[];
}

export interface VaultAdapter {
  readonly kind: "web" | "desktop" | "memory";
  /** Every markdown note in the vault, in no particular order. */
  listNotes(): Promise<NoteRef[]>;
  /** Note body, or null when the note does not exist or cannot be read. */
  readNote(id: string): Promise<string | null>;
  writeNote(id: string, content: string): Promise<void>;
  /**
   * Writes only if the note still holds `expected`; false (nothing written) when it changed meanwhile. Optional: for
   * automatic edits that must not overwrite a newer version (links rewritten after a rename).
   */
  writeNoteIfUnchanged?(id: string, content: string, expected: string): Promise<boolean>;
  createNote(path: string, content?: string): Promise<NoteRef>;
  renameNote(id: string, newPath: string): Promise<NoteRef>;
  deleteNote(id: string): Promise<void>;
  search(query: string): Promise<NoteSearchHit[]>;
  /** Notes that link to `id`, sorted by name then line. */
  backlinks(id: string): Promise<NoteBacklink[]>;
  getSettings(): Promise<Record<string, unknown>>;
  saveSettings(settings: Record<string, unknown>): Promise<void>;
  /**
   * Creation and last-change time of every note (ms since epoch), keyed by note id. Optional: callers treat a
   * missing method or a missing entry as "unknown".
   */
  noteDates?(): Promise<Record<string, NoteDates>>;
  /**
   * Stores a binary attachment and returns the link target for markdown (web: attachment URL, desktop:
   * `attachments/<name>` in the vault). Optional: plugins get an error where it is missing.
   */
  saveAttachment?(name: string, data: Blob): Promise<string>;
  /**
   * Past versions of a note (all optional; callers treat a missing method as "no history of that kind"). Snapshots
   * are automatic copies (web: server job every ~10 minutes; desktop: `.noteriv/snapshots` on every save); git history
   * needs a git repository (desktop) or a git sync connection that has run (web). Lists are newest first.
   */
  historySources?(): Promise<{ snapshots: boolean; git: boolean }>;
  noteSnapshots?(id: string): Promise<NoteSnapshotInfo[]>;
  readNoteSnapshot?(id: string, snapshotId: string): Promise<string | null>;
  noteGitLog?(id: string): Promise<NoteCommitInfo[]>;
  readNoteAtCommit?(id: string, hash: string): Promise<string | null>;
  /** Images stored in the vault (web: attachments; desktop: image files under the vault folder). Optional. */
  listAttachments?(): Promise<{ target: string; name: string }[]>;
  /**
   * A displayable URL for an attachment target: what `saveAttachment`/`listAttachments` return, or an older form
   * (web: attachment id; desktop: absolute path). Optional.
   */
  attachmentUrl?(target: string): Promise<string | null>;
  /** Bytes of an attachment, from any target `attachmentUrl` accepts. Optional. */
  readAttachment?(target: string): Promise<ArrayBuffer | null>;
  /** JSON kept with one attachment (web: on the attachment row; desktop: `.<name>-annotations.json` beside it). */
  getAttachmentData?(target: string): Promise<unknown>;
  setAttachmentData?(target: string, data: unknown): Promise<void>;
  /** Whether any file (not only a note) exists at this vault path: a `.canvas` on desktop. Optional. */
  fileExists?(path: string): Promise<boolean>;
  /**
   * Notes whose text contains any of `terms` (case-insensitive), with that text; null when the answer would be
   * incomplete (too many matches), so the caller reads every note instead. Optional: a quicker way than reading every
   * note, for link rewriting and unlinked mentions (web asks the server instead of fetching each note).
   */
  notesContaining?(terms: string[]): Promise<{ ref: NoteRef; content: string }[] | null>;
  /**
   * The start of every note that has front matter (enough to hold the block), for listing properties across the
   * vault. Optional: without it, callers read every note.
   */
  frontmatterHeads?(): Promise<{ ref: NoteRef; head: string }[]>;
  /**
   * Batch reads multiple notes with their contents (optional). Used by plugins to scan notes
   * efficiently without making individual read requests per note (Bug #5).
   */
  readBatchNotes?(options?: { ids?: string[]; paths?: string[]; all?: boolean }): Promise<{ ref: NoteRef; content: string }[]>;
  /** Subscribe to external changes. Optional: the web client has no change feed yet. */
  watch?(onChange: (id: string) => void): () => void;
}

/** Normalise Windows separators so paths compare and display the same everywhere. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Last path segment, `/` or `\` separated. */
export function baseName(path: string): string {
  const p = toPosixPath(path);
  return p.slice(p.lastIndexOf("/") + 1);
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * Vault-relative `/` path for an absolute filesystem path. A path outside the vault is returned normalised but
 * otherwise unchanged rather than guessed at.
 */
export function relativeVaultPath(vaultPath: string, absolutePath: string): string {
  const root = toPosixPath(vaultPath).replace(/\/+$/, "");
  const abs = toPosixPath(absolutePath);
  const insideVault = abs.toLowerCase().startsWith(root.toLowerCase() + "/");
  return insideVault ? abs.slice(root.length + 1) : abs;
}

export function refFromAbsolutePath(vaultPath: string, absolutePath: string): NoteRef {
  return { id: absolutePath, path: relativeVaultPath(vaultPath, absolutePath), name: baseName(absolutePath) };
}

/** Desktop backlinks come from `findBacklinks` keyed by absolute file path. */
export function backlinksFromWikiScan(vaultPath: string, found: WikiBacklink[]): NoteBacklink[] {
  return found.map((b) => ({
    ref: {
      id: b.filePath,
      path: b.relativePath ? toPosixPath(b.relativePath) : relativeVaultPath(vaultPath, b.filePath),
      name: b.fileName,
    },
    line: b.line,
    snippet: b.snippet,
  }));
}
