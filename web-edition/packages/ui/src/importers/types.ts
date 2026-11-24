import { isValidPropertyKey, writeProperty } from "@noteriv/core/properties";

/**
 * What the importers (Notion, Evernote, HTML) turn an export into: notes and attachments at vault paths under the
 * folder chosen for the import, ready for the app to write. Links between them already use those paths:
 * `[[Folder/Note]]` for notes, `![](Folder/_resources/file.png)` (from the vault root) for attachments.
 */

export interface ImportedNote {
  /** Vault path, `.md` included. */
  path: string;
  content: string;
}

export interface ImportedFile {
  path: string;
  data: Uint8Array;
}

export type SkipReason = "unsupported" | "unreadable" | "empty";

export interface ImportResult {
  notes: ImportedNote[];
  attachments: ImportedFile[];
  /** Files of the export left out, and why. */
  skipped: { path: string; reason: SkipReason }[];
}

/** One file of what the person picked (a zip entry, a file of a folder, a single file). */
export interface InputFile {
  /** Path inside the export, `/`-separated. */
  path: string;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

/** A file or folder name that Windows, macOS and links all accept, at most 120 characters. */
export function safeName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, "");
  if (!cleaned) return "Untitled";
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) ? `${cleaned}_` : cleaned;
}

/** An attachment's name for `_resources/`: also without spaces, so links to it need no escaping on any platform. */
export function attachmentName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  return `${safeName(base).replace(/\s+/g, "-").replace(/[()%&'+,;=@$!{}~`]/g, "") || "file"}${ext}`;
}

/** Hands out paths that are not taken yet: `a.md`, then `a 2.md`, `a 3.md`… (case-insensitive, as on Windows). */
export class PathAllocator {
  private taken: Set<string>;
  /** `taken`: paths already in the vault, so imported notes never land on them. */
  constructor(taken: Iterable<string> = []) {
    this.taken = new Set(Array.from(taken, (p) => p.toLowerCase()));
  }
  claim(path: string, sep = " "): string {
    const dot = path.lastIndexOf(".");
    const slash = path.lastIndexOf("/");
    const [base, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
    let candidate = path;
    for (let n = 2; this.taken.has(candidate.toLowerCase()); n++) candidate = `${base}${sep}${n}${ext}`;
    this.taken.add(candidate.toLowerCase());
    return candidate;
  }
}

/**
 * A Markdown link or image: `(!)[label](target)`. The target may hold one level of parentheses (`My%20(draft).md`);
 * groups: 1 `!` or empty, 2 label, 3 target.
 */
export const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/** Options every importer takes. */
export interface ImportOptions {
  /** Vault paths already taken: imported notes and files get another name (`Note 2.md`) instead. */
  taken?: Iterable<string>;
}

/** `a/b` + `c` → `a/b/c`, dropping empty parts. */
export function joinPath(...parts: string[]): string {
  return parts.flatMap((p) => p.split("/")).filter(Boolean).join("/");
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function fileOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Resolves `rel` (`../img/a.png`, URL-encoded or not) against folder `dir` of the export. */
export function resolvePath(dir: string, rel: string): string {
  let decoded = rel;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    // Not encoded (a bare `%` in a name).
  }
  const out = dir ? dir.split("/") : [];
  for (const seg of decoded.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** The wiki-link to a note at `path` (`.md` dropped), with `label` when it differs from the note's name. */
export function wikiLink(path: string, label?: string): string {
  const target = path.replace(/\.md$/i, "");
  const name = fileOf(target);
  const text = label?.trim();
  return text && text !== name && text !== target ? `[[${target}|${text.replace(/[[\]|]/g, "")}]]` : `[[${target}]]`;
}

/** A property name the front matter accepts: characters it cannot hold become spaces; never empty. */
export function propertyKey(name: string): string {
  const key = name
    .replace(/[:#[\]{},\r\n]/g, " ")
    .replace(/^[\s\-?!&*|>'"%@`]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return isValidPropertyKey(key) ? key : "property";
}

/** `body` with front matter holding `props` (strings, numbers, booleans, string lists); empty values are left out. */
export function withProperties(body: string, props: Record<string, string | number | boolean | string[] | null | undefined>): string {
  let text = "";
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    text = writeProperty(text, propertyKey(name), value);
  }
  return text ? `${text.replace(/\n*$/, "\n")}${body}` : body;
}

/** The base64 text of `data` (desktop writes attachments as base64). */
export function toBase64(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The bytes of a base64 text (Evernote resources), whitespace allowed. */
export function fromBase64(text: string): Uint8Array {
  const bin = atob(text.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
