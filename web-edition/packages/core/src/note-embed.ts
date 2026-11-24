/**
 * Embedding part of a note (`![[Note]]`, `![[Note#Heading]]`, `![[Note#^block-id]]`) and jumping to a heading or block
 * a link names (`[[Note#Heading]]`, `[[Note#^id]]`).
 *
 * A block id is `^id` (letters, digits, `-`) at the end of a line, or alone on the line after a block. A heading's
 * section runs to the next heading of the same or a higher level. Headings inside fenced code are not headings.
 */

export interface LinkTarget {
  /** Note name or path as written; empty for a link inside the same note (`#Heading`). */
  note: string;
  heading: string | null;
  block: string | null;
  alias: string | null;
}

export interface Anchor {
  heading: string | null;
  block: string | null;
}

/** ATX heading; a closing `#` run only counts after a space (`## C#` is the heading "C#"). */
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const BLOCK_ID_AT_END = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const LONE_BLOCK_ID = /^\s*\^([A-Za-z0-9-]+)\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s/;

/** `Note#Heading|alias` → its parts. A `#^id` part names a block, any other `#part` a heading. */
export function parseLinkTarget(raw: string): LinkTarget {
  const bar = raw.indexOf("|");
  const alias = bar >= 0 ? raw.slice(bar + 1).trim() || null : null;
  const main = bar >= 0 ? raw.slice(0, bar) : raw;
  const hash = main.indexOf("#");
  const note = (hash >= 0 ? main.slice(0, hash) : main).trim();
  const sub = hash >= 0 ? main.slice(hash + 1).trim() : "";
  if (sub.startsWith("^")) return { note, heading: null, block: sub.slice(1) || null, alias };
  return { note, heading: sub || null, block: null, alias };
}

/** Lines of `content` with, for each, whether it is inside front matter or a fenced code block. */
function scanLines(content: string): { lines: string[]; inCode: boolean[]; bodyStart: number } {
  const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
  const inCode = new Array<boolean>(lines.length).fill(false);
  let bodyStart = 0;
  if (lines[0]?.replace(/^﻿/, "") === "---") {
    const close = lines.findIndex((l, i) => i > 0 && (l === "---" || l === "..."));
    if (close > 0) {
      for (let i = 0; i <= close; i++) inCode[i] = true;
      bodyStart = close + 1;
    }
  }
  let fence: string | null = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (fence) {
      inCode[i] = true;
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    } else if (m) {
      fence = m[1];
      inCode[i] = true;
    }
  }
  return { lines, inCode, bodyStart };
}

const sameHeading = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** [first, last] line indexes (0-based, inclusive) of what an anchor names, or null. */
function anchorRange(content: string, anchor: Anchor): { lines: string[]; from: number; to: number } | null {
  const { lines, inCode, bodyStart } = scanLines(content);
  if (anchor.heading) {
    for (let i = 0; i < lines.length; i++) {
      const m = !inCode[i] && HEADING.exec(lines[i]);
      if (!m || !sameHeading(m[2], anchor.heading)) continue;
      const level = m[1].length;
      let end = lines.length - 1;
      for (let j = i + 1; j < lines.length; j++) {
        const h = !inCode[j] && HEADING.exec(lines[j]);
        if (h && h[1].length <= level) {
          end = j - 1;
          break;
        }
      }
      return { lines, from: i, to: end };
    }
    return null;
  }
  if (anchor.block) {
    const id = anchor.block.toLowerCase();
    for (let i = bodyStart; i < lines.length; i++) {
      if (inCode[i]) continue;
      const lone = LONE_BLOCK_ID.exec(lines[i]);
      if (lone && lone[1].toLowerCase() === id) {
        // The block above the marker (a blank line may separate them): a fenced code block as a whole, else back to
        // the previous blank line.
        let last = i - 1;
        while (last >= bodyStart && lines[last].trim() === "") last--;
        if (last < bodyStart) return null;
        let start = last;
        if (inCode[last]) {
          while (start > bodyStart && inCode[start - 1]) start--;
        } else {
          while (start > bodyStart && lines[start - 1].trim() !== "" && !inCode[start - 1]) start--;
        }
        return { lines, from: start, to: last };
      }
      const end = BLOCK_ID_AT_END.exec(lines[i]);
      if (!end || end[1].toLowerCase() !== id) continue;
      const item = LIST_ITEM.exec(lines[i]);
      if (item) {
        // A list item and the lines indented under it.
        let last = i;
        while (last + 1 < lines.length && lines[last + 1].trim() !== "" && /^\s*/.exec(lines[last + 1])![0].length > item[1].length) last++;
        return { lines, from: i, to: last };
      }
      // A paragraph ending in the marker: back to its first line.
      let start = i;
      while (
        start > bodyStart &&
        lines[start - 1].trim() !== "" &&
        !inCode[start - 1] &&
        !HEADING.test(lines[start - 1]) &&
        !LIST_ITEM.test(lines[start - 1])
      ) {
        start--;
      }
      return { lines, from: start, to: i };
    }
  }
  return null;
}

/**
 * The markdown an embed shows: the whole note without front matter, a heading's section, or a block; null when the
 * heading or block is not there.
 */
export function extractEmbed(content: string, anchor: Anchor): string | null {
  if (!anchor.heading && !anchor.block) {
    const { lines, bodyStart } = scanLines(content);
    return lines.slice(bodyStart).join("\n").replace(/^\n+/, "");
  }
  const range = anchorRange(content, anchor);
  return range ? range.lines.slice(range.from, range.to + 1).join("\n") : null;
}

/** 1-based line where a heading or block starts, for jumping there; null when it is not in the note. */
export function anchorLine(content: string, anchor: Anchor): number | null {
  const range = anchorRange(content, anchor);
  return range ? range.from + 1 : null;
}

/** Text without block id markers (shown in an embed or a reading view, where the marker is noise). */
export function stripBlockIds(text: string): string {
  return text
    .split("\n")
    .map((line) => (LONE_BLOCK_ID.test(line) ? "" : line.replace(/\s+\^[A-Za-z0-9-]+\s*$/, "")))
    .join("\n");
}
