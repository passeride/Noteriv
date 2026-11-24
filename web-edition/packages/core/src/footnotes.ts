/**
 * Footnotes of a note, for the Footnotes panel: `[^id]` references with their `[^id]: text` definitions (a definition
 * goes on over the indented lines after it, blank lines between paragraphs included), and inline footnotes `^[text]`.
 * Front matter, fenced code, inline code and link URLs are skipped. Pure.
 */

export interface FootnotePlace {
  /** 0-based line and column. */
  line: number;
  ch: number;
}

export interface Footnote {
  /** The label (`1`, `note`); null for an inline footnote. */
  id: string | null;
  /** The definition's text (or an inline footnote's); null when a reference has no definition. */
  text: string | null;
  /** Where the definition starts (or the inline footnote is); null when there is none. */
  definition: FootnotePlace | null;
  /** Where the note refers to it, in order. */
  refs: FootnotePlace[];
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
/** A definition, also inside a quote or a list item, or indented up to 3 spaces. */
const DEFINITION = /^((?: {0,3}>\s?)*(?: {0,3}(?:[-*+]|\d+[.)])\s+)? {0,3})\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const REFERENCE = /\[\^([^\]\s]+)\]/g;

/** The line with what cannot hold a footnote blanked out (same length, so columns stay right): code, URLs, escapes. */
function blankNonText(line: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return line
    .replace(/^﻿/, " ")
    .replace(/(`+)[^`]*?\1/g, blank)
    .replace(/\\\[/g, blank)
    .replace(/\]\(([^)]*)\)/g, (m) => `](${" ".repeat(m.length - 3)})`)
    .replace(/<[a-z][a-z0-9+.-]*:[^>\s]*>/gi, blank);
}

/** Inline footnotes `^[…]` of a line, brackets inside them (a `[[link]]`) included. */
function inlineFootnotes(line: string): { ch: number; text: string }[] {
  const found: { ch: number; text: string }[] = [];
  for (let i = line.indexOf("^["); i >= 0; i = line.indexOf("^[", i + 1)) {
    let depth = 0;
    for (let j = i + 1; j < line.length; j++) {
      if (line[j] === "[") depth++;
      else if (line[j] === "]" && --depth === 0) {
        found.push({ ch: i, text: line.slice(i + 2, j).trim() });
        i = j;
        break;
      }
    }
  }
  return found;
}

/**
 * The note's footnotes in reading order: by their first reference (an inline one where it is), then definitions that
 * nothing refers to, in the order they are written.
 */
export function listFootnotes(content: string): Footnote[] {
  const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
  let start = 0;
  if (lines[0]?.replace(/^﻿/, "") === "---") {
    const close = lines.findIndex((l, i) => i > 0 && (l === "---" || l === "..."));
    if (close > 0) start = close + 1;
  }

  const byId = new Map<string, Footnote>();
  const met: Footnote[] = [];
  const named = (id: string) => {
    let f = byId.get(id);
    if (!f) {
      f = { id, text: null, definition: null, refs: [] };
      byId.set(id, f);
    }
    return f;
  };

  const scan = (line: string, i: number, from: number) => {
    const part = line.slice(from);
    for (const r of part.matchAll(REFERENCE)) {
      const f = named(r[1]);
      f.refs.push({ line: i, ch: from + r.index! });
      if (!met.includes(f)) met.push(f);
    }
    for (const { ch, text } of inlineFootnotes(part)) {
      const place = { line: i, ch: from + ch };
      met.push({ id: null, text, definition: place, refs: [place] });
    }
  };

  let fence: string | null = null;
  /** The definition whose indented continuation lines are being read. */
  let open: Footnote | null = null;
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (fence) {
      // A closing fence has nothing after it (```js only opens one).
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(raw);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const opening = FENCE_OPEN.exec(raw);
    if (opening) {
      fence = opening[1];
      open = null;
      continue;
    }
    if (open && raw.trim() === "") continue; // a blank line between paragraphs of a definition
    const line = blankNonText(raw);
    if (open && /^( {4,}|\t)\S/.test(raw)) {
      open.text = `${open.text}${open.text ? " " : ""}${raw.trim()}`;
      scan(line, i, 0);
      continue;
    }
    open = null;
    const def = DEFINITION.exec(line);
    let from = 0;
    if (def) {
      const f = named(def[2]);
      // A second definition of the same label is ignored, as when the note is shown.
      if (!f.definition) {
        f.definition = { line: i, ch: def[1].length };
        f.text = raw.slice(raw.length - def[3].length).trim();
        open = f;
      }
      from = def[1].length + def[2].length + 4;
    }
    scan(line, i, from);
  }

  met.sort((a, b) => a.refs[0].line - b.refs[0].line || a.refs[0].ch - b.refs[0].ch);
  return [...met, ...[...byId.values()].filter((f) => f.refs.length === 0)];
}
