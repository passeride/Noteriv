/**
 * Keeping links working when notes or files move: after a rename or a move, rewrite the `[[wiki links]]`,
 * `![[embeds]]` and `[markdown](links.md)` that pointed at the old place so they point at the new one.
 *
 * Paths are vault-relative with `/` separators and keep their extension (`projects/Plan.md`, `img/a.png`).
 * A link keeps the form it was written in: a bare name stays a bare name unless the new name would resolve
 * elsewhere (then it becomes a path), a path stays a path, `.md` stays when it was written, and the
 * alias, `#heading` and `#^block` parts are kept. Text inside code spans and fenced code blocks is left alone.
 */

import { relativeVaultPath, type NoteRef, type VaultAdapter } from "./vault-adapter";

export interface PathMove {
  from: string;
  to: string;
}

export interface LinkRewriteContext {
  /** The note's path before the move (differs from `sourceAfter` when the note itself moved). */
  sourceBefore: string;
  sourceAfter: string;
  moves: PathMove[];
  /** Every file path in the vault before the move (notes, and attachments where the platform has them). */
  before: string[];
}

const WIKI_LINK = /(!?)\[\[([^\]|#]+)((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]/g;
// The label may hold one level of brackets, so `[![img](a.png)](b.md)` is matched as a link to b.md.
const MD_LINK = /(!?\[(?:[^[\]\n]|\[[^[\]\n]*\])*\]\()(<[^>\n]*>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g;
// Any indentation: fences inside list items are indented too.
const FENCE = /^\s*(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function fileOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stripMd(path: string): string {
  return path.replace(/\.md$/i, "");
}

/** `a/b/../c/./d` → `a/c/d`; null when it climbs above the vault root. */
function normalise(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

const percent = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;

/**
 * `path` written the way `original` (a link URL as it appears in the note) was: fully percent-encoded when it encoded
 * more than spaces (`Caf%C3%A9.md`), otherwise as-is except the characters that would break the link (space, `%`,
 * parentheses, `#`, `?`, angle brackets).
 */
function encodeLike(original: string, path: string): string {
  return encodePath(path, /%(?!20)[0-9a-f]{2}/i.test(original));
}

function encodePath(path: string, full: boolean): string {
  return path
    .split("/")
    .map((seg) => (seg === ".." ? seg : full ? encodeURIComponent(seg).replace(/[()]/g, percent) : seg.replace(/[\s%()<>#?]/g, percent)))
    .join("/");
}

function relativePath(fromDir: string, to: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const target = to.split("/");
  let i = 0;
  while (i < from.length && i < target.length - 1 && from[i].toLowerCase() === target[i].toLowerCase()) i++;
  return [...Array(from.length - i).fill(".."), ...target.slice(i)].join("/");
}

/**
 * Which file a wiki-link target means, seen from `sourcePath`. A target with `/` is a path (exact, else a suffix);
 * a bare name matches file names, `.md` optional for notes. When several files share the name, the one in the
 * source's folder wins, then the shortest path, then the alphabetically first, so the answer never depends on
 * listing order.
 */
export function resolveLinkTarget(target: string, sourcePath: string, files: string[]): string | null {
  const t = target.trim().toLowerCase();
  if (!t) return null;
  const matches = (file: string) => {
    const f = file.toLowerCase();
    return f === t || (f.endsWith(".md") && stripMd(f) === t);
  };
  if (t.includes("/")) {
    const exact = files.find(matches);
    if (exact) return exact;
    const endsWith = (file: string) => {
      const f = file.toLowerCase();
      return f.endsWith(`/${t}`) || (f.endsWith(".md") && stripMd(f).endsWith(`/${t}`));
    };
    return pick(files.filter(endsWith), sourcePath);
  }
  return pick(files.filter((f) => matches(fileOf(f))), sourcePath);
}

/**
 * `resolveLinkTarget` for many links over the same files: the names are indexed once, so resolving a link costs
 * a lookup instead of a scan (only a path target that is not an exact path still scans, for the suffix match).
 */
export function linkResolver(files: string[]): (target: string, sourcePath: string) => string | null {
  // Lower-cased path, with and without `.md`, to the index of the first file that has it.
  const byPath = new Map<string, number>();
  const byName = new Map<string, string[]>();
  files.forEach((file, i) => {
    const f = file.toLowerCase();
    const keys = f.endsWith(".md") ? [f, stripMd(f)] : [f];
    for (const key of keys) {
      if (!byPath.has(key)) byPath.set(key, i);
      const name = fileOf(key);
      const list = byName.get(name);
      if (!list) byName.set(name, [file]);
      else if (list[list.length - 1] !== file) list.push(file);
    }
  });
  return (target, sourcePath) => {
    const t = target.trim().toLowerCase();
    if (!t) return null;
    if (t.includes("/")) {
      const exact = byPath.get(t);
      if (exact !== undefined) return files[exact];
      return pick(
        files.filter((file) => {
          const f = file.toLowerCase();
          return f.endsWith(`/${t}`) || (f.endsWith(".md") && stripMd(f).endsWith(`/${t}`));
        }),
        sourcePath
      );
    }
    return pick(byName.get(t) ?? [], sourcePath);
  };
}

function pick(candidates: string[], sourcePath: string): string | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const dir = dirOf(sourcePath).toLowerCase();
  const local = candidates.filter((c) => dirOf(c).toLowerCase() === dir);
  const pool = local.length > 0 ? local : candidates;
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/** Apply `fn` to the parts of `text` outside fenced code blocks and inline code spans. */
function mapOutsideCode(text: string, fn: (segment: string) => string): string {
  const lines = text.split("\n");
  let fence: string | null = null;
  return lines
    .map((line) => {
      const m = FENCE.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        return line;
      }
      if (m) {
        fence = m[1];
        return line;
      }
      let out = "";
      let last = 0;
      for (const code of line.matchAll(INLINE_CODE)) {
        out += fn(line.slice(last, code.index)) + code[0];
        last = code.index! + code[0].length;
      }
      return out + fn(line.slice(last));
    })
    .join("\n");
}

/** `content` with every link to a moved file (and the note's own relative links, if it moved) pointing at the new place. */
export function rewriteLinksForMoves(content: string, ctx: LinkRewriteContext): string {
  const moved = new Map(ctx.moves.map((m) => [m.from.toLowerCase(), m.to]));
  const after = ctx.before.map((p) => moved.get(p.toLowerCase()) ?? p);
  const sourceMoved = ctx.sourceBefore.toLowerCase() !== ctx.sourceAfter.toLowerCase();
  if (moved.size === 0) return content;

  const wiki = (whole: string, bang: string, target: string, sub: string, alias: string) => {
    const old = resolveLinkTarget(target, ctx.sourceBefore, ctx.before);
    const dest = old ? moved.get(old.toLowerCase()) : undefined;
    if (!dest) return whole;
    const keepExt = /\.[^./]+$/.test(target.trim()) && (!dest.toLowerCase().endsWith(".md") || /\.md$/i.test(target.trim()));
    const asName = keepExt ? fileOf(dest) : stripMd(fileOf(dest));
    const asPath = keepExt ? dest : stripMd(dest);
    let next: string;
    if (target.includes("/")) next = asPath;
    else next = resolveLinkTarget(asName, ctx.sourceAfter, after)?.toLowerCase() === dest.toLowerCase() ? asName : asPath;
    return next === target.trim() ? whole : `${bang}[[${next}${sub}${alias}]]`;
  };

  const markdown = (whole: string, open: string, rawUrl: string, close: string) => {
    const angled = rawUrl.startsWith("<");
    const url = angled ? rawUrl.slice(1, -1) : rawUrl;
    if (!url || url.startsWith("#") || URL_SCHEME.test(url)) return whole;
    const hash = url.indexOf("#");
    const pathPart = hash < 0 ? url : url.slice(0, hash);
    const fragment = hash < 0 ? "" : url.slice(hash);
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      return whole;
    }
    const rooted = decoded.startsWith("/");
    const resolved = normalise(rooted ? decoded : `${dirOf(ctx.sourceBefore)}/${decoded}`);
    if (resolved === null) return whole;
    const old = ctx.before.find((p) => p.toLowerCase() === resolved.toLowerCase());
    if (!old) return whole;
    const dest = moved.get(old.toLowerCase());
    if (!dest && !sourceMoved) return whole;
    const target = dest ?? old;
    const nextPath = rooted ? `/${target}` : relativePath(dirOf(ctx.sourceAfter), target);
    if (nextPath === decoded) return whole;
    const written = angled ? `<${nextPath}${fragment}>` : `${encodeLike(pathPart, nextPath)}${fragment}`;
    return `${open}${written}${close}`;
  };

  return mapOutsideCode(content, (segment) => segment.replace(WIKI_LINK, wiki).replace(MD_LINK, markdown));
}

/** Every file under `fromFolder` (any depth) moved to the same place under `toFolder`. */
export function expandFolderMove(fromFolder: string, toFolder: string, files: string[]): PathMove[] {
  const prefix = fromFolder.replace(/\/+$/, "") + "/";
  const target = toFolder.replace(/\/+$/, "");
  return files
    .filter((f) => f.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((f) => ({ from: f, to: (target ? `${target}/` : "") + f.slice(prefix.length) }));
}

/**
 * What a filesystem rename moved (desktop, where the rename has already happened): the note moves (one note, or every
 * note under a renamed folder) and every note path from before. `notesAfter` are the vault's note files (absolute
 * paths) as they are now. Null when no note moved (an empty folder, a file that is not a note).
 */
export function notesMovedByRename(
  vaultPath: string,
  oldPath: string,
  newPath: string,
  notesAfter: string[]
): { moves: PathMove[]; before: string[] } | null {
  const oldRel = relativeVaultPath(vaultPath, oldPath);
  const newRel = relativeVaultPath(vaultPath, newPath);
  const after = notesAfter.map((p) => relativeVaultPath(vaultPath, p));
  const folderMoves = expandFolderMove(newRel, oldRel, after).map((m) => ({ from: m.to, to: m.from }));
  const isDirectFile =
    after.some((p) => p.toLowerCase() === newRel.toLowerCase()) ||
    (/\.[a-z0-9]+$/i.test(newRel) && !newRel.endsWith("/"));
  const moves =
    folderMoves.length > 0
      ? folderMoves
      : isDirectFile
      ? [{ from: oldRel, to: newRel }]
      : [];
  if (moves.length === 0) return null;
  const back = new Map(moves.map((m) => [m.to.toLowerCase(), m.from]));
  const before = after.map((p) => back.get(p.toLowerCase()) ?? p);
  if (folderMoves.length === 0 && !before.some((p) => p.toLowerCase() === oldRel.toLowerCase())) {
    before.push(oldRel);
  }
  return { moves, before };
}

/**
 * Text a note must contain to possibly link to one of the moved files: each file's name without `.md`, also in the two
 * percent-encoded forms a markdown link may use. Used to narrow which notes are read.
 */
export function linkSearchTerms(moves: PathMove[]): string[] {
  const terms = new Set<string>();
  for (const m of moves) {
    const name = stripMd(fileOf(m.from));
    terms.add(name);
    terms.add(encodePath(name, false));
    terms.add(encodePath(name, true));
  }
  return Array.from(terms);
}

export interface LinkUpdateResult {
  /** Notes whose text was rewritten, with the new text (what the server or disk now holds). */
  changed: (NoteRef & { content: string })[];
  /** Paths of notes that needed a change but could not be written. */
  failed: string[];
}

/**
 * After `moves` happened (the files are already at their new paths), rewrite the links in every note that pointed
 * at a moved file, plus the moved notes' own relative links. `beforePaths` is every file path before the move.
 * Uses `adapter.notesContaining` to read only notes that can match, when the adapter has it.
 */
export async function updateLinksAfterMove(
  adapter: VaultAdapter,
  moves: PathMove[],
  beforePaths: string[],
  /** Notes not to write (an open tab with unsaved edits: the caller rewrites the tab and its save writes the note). */
  skip: (ref: NoteRef) => boolean = () => false
): Promise<LinkUpdateResult> {
  const result: LinkUpdateResult = { changed: [], failed: [] };
  if (moves.length === 0) return result;
  const backToBefore = new Map(moves.map((m) => [m.to.toLowerCase(), m.from]));
  const notes = await adapter.listNotes();
  const movedNotes = notes.filter((n) => backToBefore.has(n.path.toLowerCase()));

  const readAll = (refs: NoteRef[]) => Promise.all(refs.map(async (ref) => ({ ref, content: await adapter.readNote(ref.id) })));
  // Narrowed when the adapter can; an incomplete answer (null) means reading every note instead.
  const found = adapter.notesContaining ? await adapter.notesContaining(linkSearchTerms(moves)) : null;
  let candidates: { ref: NoteRef; content: string | null }[];
  if (found) {
    const seen = new Set(found.map((f) => f.ref.id));
    candidates = [...found, ...(await readAll(movedNotes.filter((n) => !seen.has(n.id))))];
  } else {
    candidates = await readAll(notes);
  }

  const rewrite = (ref: NoteRef, text: string) =>
    rewriteLinksForMoves(text, { sourceBefore: backToBefore.get(ref.path.toLowerCase()) ?? ref.path, sourceAfter: ref.path, moves, before: beforePaths });
  /** Writes `next` over `previous`; false when the note changed in between (adapters that can tell). */
  const write = async (ref: NoteRef, previous: string, next: string) => {
    if (adapter.writeNoteIfUnchanged) return adapter.writeNoteIfUnchanged(ref.id, next, previous);
    await adapter.writeNote(ref.id, next);
    return true;
  };

  for (const { ref, content } of candidates) {
    if (content === null || skip(ref)) continue;
    let previous = content;
    let next = rewrite(ref, previous);
    if (next === previous) continue;
    try {
      // Changed elsewhere since it was read: once more on the fresh text, never over it.
      let written = await write(ref, previous, next);
      if (!written) {
        const fresh = await adapter.readNote(ref.id);
        if (fresh === null) throw new Error("gone");
        previous = fresh;
        next = rewrite(ref, previous);
        written = next === previous || (await write(ref, previous, next));
      }
      if (!written) throw new Error("changed");
      if (next !== previous) result.changed.push({ ...ref, content: next });
    } catch {
      result.failed.push(ref.path);
    }
  }
  return result;
}
