export type SearchFile = { filePath: string; fileName: string; relativePath: string };
export type ContentHit = SearchFile & { line: number; text: string };

type CachedNote = { text: string; lower: string };
type SearchIO = {
  list: (vault: string) => Promise<SearchFile[]>;
  read: (path: string) => Promise<string | null>;
};

const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function matchSearchFiles(files: SearchFile[], query: string): SearchFile[] {
  const term = query.trim().normalize('NFC').toLowerCase();
  if (!term) return files.slice(0, 30);
  return files.flatMap(file => {
    const name = file.fileName.normalize('NFC').toLowerCase();
    const path = file.relativePath.normalize('NFC').toLowerCase();
    let position = 0;
    for (const character of name) if (character === term[position]) position++;
    const rank = name.startsWith(term) ? 4 : name.includes(term) ? 3 :
      path.includes(term) ? 2 : position === term.length ? 1 : 0;
    return rank ? [{ file, rank }] : [];
  }).sort((a, b) => b.rank - a.rank).slice(0, 30).map(({ file }) => file);
}

export class QuickSearchCache {
  private vault = '';
  private files?: Promise<SearchFile[]>;
  private notes = new Map<string, CachedNote>();
  private pending = new Map<string, Promise<CachedNote | null>>();
  private length = 0;
  private revision = 0;
  private listeners = new Set<() => void>();
  private warming?: Promise<void>;

  constructor(private io: SearchIO, private budget = 4_000_000) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  version = () => this.revision;

  reset(vault: string) {
    if (this.vault === vault) return;
    this.vault = vault;
    this.files = undefined;
    this.notes.clear();
    this.pending.clear();
    this.length = 0;
    this.changed();
  }

  invalidate(path: string, structure = true) {
    if (!this.vault) return;
    const root = this.vault.replace(/\/$/, '');
    const target = path.replace(/\/$/, '');
    if (target !== root && !target.startsWith(root + '/')) return;
    // Temporary files, Git data and plugin assets do not participate in search.
    if (target.slice(root.length + 1).split('/').some(part => part.startsWith('.'))) return;
    if (structure) this.files = undefined;
    for (const [notePath, note] of this.notes) {
      if (notePath !== target && !notePath.startsWith(target + '/')) continue;
      this.notes.delete(notePath);
      this.length -= note.text.length;
    }
    for (const notePath of this.pending.keys()) {
      if (notePath === target || notePath.startsWith(target + '/')) this.pending.delete(notePath);
    }
    this.changed();
  }

  private changed() {
    this.warming = undefined;
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  list(vault: string) {
    if (vault !== this.vault) return this.io.list(vault);
    if (this.files) return this.files;
    const listing = this.io.list(vault).catch(error => {
      if (this.files === listing) this.files = undefined;
      throw error;
    });
    return this.files = listing;
  }

  private read(path: string, cache: boolean): Promise<CachedNote | null> {
    const existing = this.notes.get(path);
    if (existing) return Promise.resolve(existing);
    const pending = this.pending.get(path);
    if (pending) return pending;
    const promise = this.io.read(path).then(text => {
      if (text === null) return null;
      const note = { text, lower: text.toLowerCase() };
      if (cache && this.pending.get(path) === promise && this.length + text.length <= this.budget) {
        this.notes.set(path, note);
        this.length += text.length;
      }
      return note;
    }).finally(() => {
      if (this.pending.get(path) === promise) this.pending.delete(path);
    });
    if (cache) this.pending.set(path, promise);
    return promise;
  }

  warm(vault: string) {
    if (vault !== this.vault || this.warming) return;
    const revision = this.revision;
    this.warming = (async () => {
      const files = await this.list(vault);
      for (let i = 0; i < files.length; i += 4) {
        if (revision !== this.revision || this.length >= this.budget) return;
        await Promise.all(files.slice(i, i + 4).map(file => this.read(file.filePath, true)));
        await yieldToUI();
      }
    })().catch(() => {
      if (this.revision === revision) this.warming = undefined;
    });
  }

  async search(
    vault: string, query: string, signal: AbortSignal,
    draft?: { path: string; text: string },
  ): Promise<ContentHit[]> {
    const term = query.trim().toLowerCase();
    if (!term || signal.aborted) return [];
    const hits: ContentHit[] = [];
    const files = await this.list(vault);
    for (let i = 0; i < files.length && hits.length < 80; i += 8) {
      if (signal.aborted) return [];
      const batch = files.slice(i, i + 8);
      const notes = await Promise.all(batch.map(file =>
        draft?.path === file.filePath
          ? { text: draft.text, lower: draft.text.toLowerCase() }
          : this.read(file.filePath, vault === this.vault)));
      if (signal.aborted) return [];
      for (const [index, note] of notes.entries()) {
        if (!note?.lower.includes(term)) continue;
        for (const [line, text] of note.text.split('\n').entries()) {
          const at = text.toLowerCase().indexOf(term);
          if (at < 0) continue;
          const from = Math.max(0, at - 55);
          const to = Math.min(text.length, at + Math.max(100, term.length));
          hits.push({
            ...batch[index], line: line + 1,
            text: (from > 0 ? '…' : '') + text.slice(from, to).trim() + (to < text.length ? '…' : ''),
          });
          if (hits.length >= 80) return hits;
        }
      }
      // Cached vaults can finish without IO, so explicitly yield between batches.
      if (i % 64 === 56) await yieldToUI();
    }
    return hits;
  }
}
