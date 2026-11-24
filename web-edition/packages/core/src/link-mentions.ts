/**
 * What a note links to, and where notes are named without a link ("unlinked mentions"), for the Outgoing links and
 * Backlinks panels. Paths are vault-relative with `/` and keep their extension, as in `link-rename`.
 *
 * Never a link or a mention: front matter, fenced code blocks, inline code, math, HTML comments. Never a mention
 * either: text inside a link, a bare URL or a #tag. A mention is a note's name (without `.md`, NFC) as a whole word,
 * any case.
 */

import { resolveLinkTarget } from "./link-rename";

export interface OutgoingLink {
  /** The target as written (`Plan`, `plan#Goals` → `plan`, `projects/Notes.md`). */
  target: string;
  /** The file it points to, or null when no file matches. */
  resolved: string | null;
  /** 1-based line of its first occurrence. */
  line: number;
  embed: boolean;
}

export interface Mention {
  /** Offsets in the text: `text.slice(start, end)` is the mention. */
  start: number;
  end: number;
  text: string;
  line: number;
  /** The mention's line, trimmed and shortened. */
  snippet: string;
}

const WIKI_LINK = /(!?)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
const MD_LINK = /(!?)\[(?:[^[\]\n]|\[[^[\]\n]*\])*\]\((<[^>\n]*>|[^)\s]+)(?:\s+"[^"\n]*")?\)/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FENCE = /^\s*(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
/** Not mentions: bare URLs, #tags, HTML comments, $math$ and $$math$$. */
const NOT_PROSE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+|(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_/-]+|<!--[\s\S]*?-->|\$\$[\s\S]+?\$\$|\$[^\s$](?:[^$\n]*[^\s$])?\$/giu;
const WORD = /^[\p{L}\p{N}\p{M}_]$/u;

type Range = [number, number];

/** Front matter, fenced code blocks and inline code spans, as offset ranges. Lines may end in `\r\n`. */
function codeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let offset = 0;
  const lines = text.split("\n");
  const bare = (line: string) => line.replace(/\r$/, "").replace(/^﻿/, "");
  let i = 0;
  if (bare(lines[0]) === "---") {
    const close = lines.findIndex((l, n) => n > 0 && (bare(l) === "---" || bare(l) === "..."));
    if (close > 0) {
      for (; i <= close; i++) offset += lines[i].length + 1;
      ranges.push([0, offset]);
    }
  }
  let fence: { mark: string; start: number } | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const m = FENCE.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.mark[0] && m[1].length >= fence.mark.length) {
        ranges.push([fence.start, offset + line.length]);
        fence = null;
      }
    } else if (m) {
      fence = { mark: m[1], start: offset };
    } else {
      for (const code of line.matchAll(INLINE_CODE)) ranges.push([offset + code.index!, offset + code.index! + code[0].length]);
    }
    offset += line.length + 1;
  }
  if (fence) ranges.push([fence.start, text.length]);
  return ranges;
}

function matchRanges(text: string, ...patterns: RegExp[]): Range[] {
  const ranges: Range[] = [];
  for (const re of patterns) for (const m of text.matchAll(re)) ranges.push([m.index!, m.index! + m[0].length]);
  return ranges;
}

/** Sorted, merged ranges, for binary search. */
function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function overlaps(ranges: Range[], start: number, end: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][1] <= start) lo = mid + 1;
    else if (ranges[mid][0] >= end) hi = mid - 1;
    else return true;
  }
  return false;
}

/** Line lookups for one text: line number and trimmed line of an offset, without re-splitting per lookup. */
function lineIndex(text: string) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    const end = lo + 1 < starts.length ? starts[lo + 1] - 1 : text.length;
    const raw = text.slice(starts[lo], end).trim();
    return { line: lo + 1, snippet: raw.length > 120 ? `${raw.slice(0, 119)}…` : raw, lineText: text.slice(starts[lo], end) };
  };
}

/** Whether the code point just before `index` (or at `index`) is a letter, digit, mark or `_`. */
function wordBefore(text: string, index: number): boolean {
  if (index <= 0) return false;
  const low = text.charCodeAt(index - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return WORD.test(String.fromCodePoint(text.codePointAt(start)!));
}

function wordAt(text: string, index: number): boolean {
  return index < text.length && WORD.test(String.fromCodePoint(text.codePointAt(index)!));
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

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

/** Each link in `text` once (by the file it resolves to, else by its target), in order of first appearance. */
export function outgoingLinks(text: string, sourcePath: string, files: string[]): OutgoingLink[] {
  const code = merge(codeRanges(text));
  const lineOf = lineIndex(text);
  const found: (OutgoingLink & { at: number })[] = [];
  for (const m of text.matchAll(WIKI_LINK)) {
    if (overlaps(code, m.index!, m.index! + m[0].length)) continue;
    const target = m[2].trim();
    found.push({ target, resolved: resolveLinkTarget(target, sourcePath, files), line: 0, embed: m[1] === "!", at: m.index! });
  }
  for (const m of text.matchAll(MD_LINK)) {
    if (overlaps(code, m.index!, m.index! + m[0].length)) continue;
    const raw = m[2].startsWith("<") ? m[2].slice(1, -1) : m[2];
    const url = raw.split("#")[0];
    if (!url || URL_SCHEME.test(url)) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      continue;
    }
    const path = normalise(decoded.startsWith("/") ? decoded : `${dirOf(sourcePath)}/${decoded}`);
    const resolved = path === null ? null : files.find((f) => f.toLowerCase() === path.toLowerCase()) ?? null;
    found.push({ target: decoded, resolved, line: 0, embed: m[1] === "!", at: m.index! });
  }
  found.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const out: OutgoingLink[] = [];
  for (const { at, ...link } of found) {
    const key = (link.resolved ?? link.target).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...link, line: lineOf(at).line });
  }
  return out;
}

/**
 * Plain-text occurrences of several names at once, in one pass over `text`: name → mentions. Names are compared
 * NFC and case-insensitively; a name must start and end on a word boundary.
 */
function scanMentions(text: string, names: string[]): Map<string, Mention[]> {
  const result = new Map<string, Mention[]>();
  const wanted = names.map((n) => n.normalize("NFC").trim()).filter(Boolean);
  if (wanted.length === 0) return result;
  const skip = merge([...codeRanges(text), ...matchRanges(text, WIKI_LINK, MD_LINK, NOT_PROSE)]);
  const lineOf = lineIndex(text);
  // Candidates by their first character (lower case): each position of the text is compared only with names that
  // could start there.
  const byFirst = new Map<string, { name: string; lower: string }[]>();
  for (const name of new Set(wanted)) {
    const lower = name.toLowerCase();
    const first = String.fromCodePoint(lower.codePointAt(0)!);
    const list = byFirst.get(first) ?? [];
    list.push({ name, lower });
    byFirst.set(first, list);
  }
  for (let at = 0; at < text.length; ) {
    const cp = text.codePointAt(at)!;
    const ch = String.fromCodePoint(cp);
    const step = ch.length;
    const candidates = byFirst.get(ch.toLowerCase());
    if (candidates && !(wordAt(text, at) && wordBefore(text, at))) {
      for (const { name, lower } of candidates) {
        const end = at + name.length;
        if (end > text.length || text.slice(at, end).toLowerCase() !== lower) continue;
        if ((wordAt(text, at) && wordBefore(text, at)) || (wordBefore(text, end) && wordAt(text, end))) continue;
        if (overlaps(skip, at, end)) continue;
        const { line, snippet } = lineOf(at);
        const list = result.get(name) ?? [];
        list.push({ start: at, end, text: text.slice(at, end), line, snippet });
        result.set(name, list);
      }
    }
    at += step;
  }
  return result;
}

/** Plain-text occurrences of `name` in `text` (whole word, any case), outside links, code, front matter and the like. */
export function findMentions(text: string, name: string): Mention[] {
  return scanMentions(text, [name]).get(name.normalize("NFC").trim()) ?? [];
}

/**
 * Notes (`.md` files other than `sourcePath`) whose name appears in `text` without a link, with the mentions, in
 * `files` order. For the Outgoing links panel ("could link to"). One pass over the text for all names.
 */
export function unlinkedMentionsIn(text: string, sourcePath: string, files: string[]): { path: string; mentions: Mention[] }[] {
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "").normalize("NFC").trim();
  const notes = files.filter((p) => /\.md$/i.test(p) && p.toLowerCase() !== sourcePath.toLowerCase());
  const found = scanMentions(text, notes.map(nameOf));
  const out: { path: string; mentions: Mention[] }[] = [];
  for (const path of notes) {
    const mentions = found.get(nameOf(path));
    if (mentions?.length) out.push({ path, mentions });
  }
  return out;
}

/**
 * `text` with `mention` turned into a link to `targetPath`, keeping the mention's words: `[[words]]` when that
 * resolves to the target from `sourcePath`, else `[[path|words]]` (`\|` inside a table row). Null when the text no
 * longer has the mention there.
 */
export function linkMention(text: string, mention: Mention, targetPath: string, sourcePath: string, files: string[]): string | null {
  if (text.slice(mention.start, mention.end) !== mention.text) return null;
  const resolvesToTarget = resolveLinkTarget(mention.text, sourcePath, files)?.toLowerCase() === targetPath.toLowerCase();
  const inTable = /^\s*\|/.test(lineIndex(text)(mention.start).lineText);
  const link = resolvesToTarget ? `[[${mention.text}]]` : `[[${targetPath.replace(/\.md$/i, "")}${inTable ? "\\|" : "|"}${mention.text}]]`;
  return text.slice(0, mention.start) + link + text.slice(mention.end);
}
