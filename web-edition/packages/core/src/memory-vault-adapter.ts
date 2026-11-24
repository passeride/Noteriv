import {
  baseName,
  toPosixPath,
  type NoteBacklink,
  type NoteCommitInfo,
  type NoteDates,
  type NoteRef,
  type NoteSearchHit,
  type NoteSnapshotInfo,
  type VaultAdapter,
} from "./vault-adapter";

/**
 * In-memory vault for tests and demos. Note ids are the vault-relative paths, so tests can read them without a
 * lookup table.
 */
export class MemoryVaultAdapter implements VaultAdapter {
  readonly kind = "memory" as const;
  private notes = new Map<string, string>();
  private dates = new Map<string, NoteDates>();
  private settings: Record<string, unknown> = {};
  private watchers = new Set<(id: string) => void>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) this.notes.set(toPosixPath(path), content);
  }

  private ref(path: string): NoteRef {
    return { id: path, path, name: baseName(path) };
  }

  private notify(id: string) {
    const now = Date.now();
    this.dates.set(id, { createdAt: this.dates.get(id)?.createdAt ?? now, modifiedAt: now });
    for (const cb of this.watchers) cb(id);
  }

  /** Tests: give a note fixed dates. */
  setDates(id: string, dates: NoteDates) {
    this.dates.set(id, dates);
  }

  /** Tests: attachments saved through `saveAttachment`, by link target. */
  readonly attachments = new Map<string, Blob>();

  async listAttachments() {
    return Array.from(this.attachments.keys(), (target) => ({ target, name: baseName(target) }));
  }

  async attachmentUrl(target: string): Promise<string | null> {
    return this.attachments.has(target) ? `memory://${target}` : null;
  }

  /** Tests: data kept with attachments, by target. */
  readonly attachmentData = new Map<string, unknown>();

  async readAttachment(target: string): Promise<ArrayBuffer | null> {
    const blob = this.attachments.get(target);
    return blob ? blob.arrayBuffer() : null;
  }

  async getAttachmentData(target: string): Promise<unknown> {
    return this.attachmentData.get(target) ?? null;
  }

  async setAttachmentData(target: string, data: unknown): Promise<void> {
    this.attachmentData.set(target, data);
  }

  /** Tests: files that are not notes (a `.canvas`), by vault path. */
  readonly files = new Set<string>();

  async fileExists(path: string): Promise<boolean> {
    return this.notes.has(path) || this.files.has(path);
  }

  async saveAttachment(name: string, data: Blob): Promise<string> {
    const target = `attachments/${name}`;
    this.attachments.set(target, data);
    return target;
  }

  /** Tests: past versions, keyed by note id, newest first. Git counts as available once any commit is set. */
  readonly snapshots = new Map<string, (NoteSnapshotInfo & { content: string })[]>();
  readonly commits = new Map<string, (NoteCommitInfo & { content: string })[]>();

  async historySources() {
    return { snapshots: true, git: this.commits.size > 0 };
  }

  async noteSnapshots(id: string): Promise<NoteSnapshotInfo[]> {
    return (this.snapshots.get(id) ?? []).map(({ content: _content, ...info }) => info);
  }

  async readNoteSnapshot(id: string, snapshotId: string): Promise<string | null> {
    return this.snapshots.get(id)?.find((s) => s.id === snapshotId)?.content ?? null;
  }

  async noteGitLog(id: string): Promise<NoteCommitInfo[]> {
    return (this.commits.get(id) ?? []).map(({ content: _content, ...info }) => info);
  }

  async readNoteAtCommit(id: string, hash: string): Promise<string | null> {
    return this.commits.get(id)?.find((c) => c.hash === hash)?.content ?? null;
  }

  async noteDates(): Promise<Record<string, NoteDates>> {
    return Object.fromEntries(Array.from(this.dates).filter(([id]) => this.notes.has(id)));
  }

  async listNotes(): Promise<NoteRef[]> {
    return Array.from(this.notes.keys(), (p) => this.ref(p));
  }

  async readNote(id: string): Promise<string | null> {
    return this.notes.get(id) ?? null;
  }

  async writeNote(id: string, content: string): Promise<void> {
    if (!this.notes.has(id)) throw new Error(`No such note: ${id}`);
    this.notes.set(id, content);
    this.notify(id);
  }

  async createNote(path: string, content = ""): Promise<NoteRef> {
    const p = toPosixPath(path);
    if (this.notes.has(p)) throw new Error(`Note already exists: ${p}`);
    this.notes.set(p, content);
    this.notify(p);
    return this.ref(p);
  }

  async renameNote(id: string, newPath: string): Promise<NoteRef> {
    const content = this.notes.get(id);
    if (content === undefined) throw new Error(`No such note: ${id}`);
    const p = toPosixPath(newPath);
    if (p !== id && this.notes.has(p)) throw new Error(`Note already exists: ${p}`);
    this.notes.delete(id);
    this.notes.set(p, content);
    this.notify(p);
    return this.ref(p);
  }

  async deleteNote(id: string): Promise<void> {
    if (this.notes.delete(id)) this.notify(id);
  }

  async search(query: string): Promise<NoteSearchHit[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: NoteSearchHit[] = [];
    for (const [path, content] of this.notes) {
      const line = content.split("\n").find((l) => l.toLowerCase().includes(q));
      if (line !== undefined) hits.push({ ref: this.ref(path), snippet: line.trim().slice(0, 120) });
    }
    return hits;
  }

  async backlinks(id: string): Promise<NoteBacklink[]> {
    const target = baseName(id).replace(/\.md$/i, "").toLowerCase();
    const out: NoteBacklink[] = [];
    for (const [path, content] of this.notes) {
      if (path === id) continue;
      content.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
          if (m[1].trim().toLowerCase() === target) {
            out.push({ ref: this.ref(path), line: i + 1, snippet: line.trim().slice(0, 120) });
            break;
          }
        }
      });
    }
    return out.sort((a, b) => a.ref.name.localeCompare(b.ref.name) || (a.line ?? 0) - (b.line ?? 0));
  }

  async readBatchNotes(options: { ids?: string[]; paths?: string[]; all?: boolean } = { all: true }): Promise<{ ref: NoteRef; content: string }[]> {
    const out: { ref: NoteRef; content: string }[] = [];
    if (options.all) {
      for (const [path, content] of this.notes.entries()) {
        out.push({ ref: this.ref(path), content });
      }
      return out;
    }
    if (options.ids && options.ids.length > 0) {
      for (const id of options.ids) {
        const norm = toPosixPath(id);
        const content = this.notes.get(norm);
        if (content !== undefined) out.push({ ref: this.ref(norm), content });
      }
      return out;
    }
    if (options.paths && options.paths.length > 0) {
      for (const path of options.paths) {
        const norm = toPosixPath(path);
        const content = this.notes.get(norm);
        if (content !== undefined) out.push({ ref: this.ref(norm), content });
      }
      return out;
    }
    return out;
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return { ...this.settings };
  }

  async saveSettings(settings: Record<string, unknown>): Promise<void> {
    this.settings = { ...settings };
  }

  watch(onChange: (id: string) => void): () => void {
    this.watchers.add(onChange);
    return () => this.watchers.delete(onChange);
  }
}
