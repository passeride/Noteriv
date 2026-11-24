/**
 * Tag parsing and vault-wide aggregation.
 *
 * Tags follow Obsidian conventions:
 *  - `#word`, `#CamelCase`, `#nested/tag`, `#tag-with-dashes`
 *  - Must start with a letter (no pure numbers like `#123`)
 *  - Must be preceded by whitespace or be at line start
 *  - Headings (`# Heading`) are NOT tags
 *  - Tags inside fenced code blocks and inline code are skipped
 *  - Tags inside URLs (http://...#anchor) are skipped
 */

import type { NoteRef } from "./vault-adapter";

// Matches a tag: # followed by a letter, then word chars, hyphens, or slashes
// The lookbehind ensures the # is preceded by whitespace or is at line start.
const TAG_REGEX = /(?<=\s|^)#([a-zA-Z][\w/\-]*)/g;

// Detect fenced code block delimiters
const CODE_FENCE_REGEX = /^(`{3,}|~{3,})/;

// Detect inline code spans — we strip these before matching tags
const INLINE_CODE_REGEX = /`[^`]*`/g;

// Detect URLs so we don't match anchors inside them
const URL_REGEX = /https?:\/\/[^\s)>\]]+/g;

/**
 * Extract all unique tags from markdown content.
 * Skips tags inside code blocks (fenced and inline) and URLs.
 * Skips heading lines (lines starting with `# `).
 */
export function parseTags(content: string): string[] {
  const tags = new Set<string>();
  const lines = content.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    // Toggle fenced code block state
    const fenceMatch = line.match(CODE_FENCE_REGEX);
    if (fenceMatch) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip lines inside code blocks
    if (inCodeBlock) continue;

    // Skip heading lines: lines starting with one or more # followed by a space
    if (/^#{1,6}\s/.test(line.trimStart())) continue;

    // Strip inline code spans and URLs so we don't match tags inside them
    let cleaned = line.replace(INLINE_CODE_REGEX, (m) => " ".repeat(m.length));
    cleaned = cleaned.replace(URL_REGEX, (m) => " ".repeat(m.length));

    // Reset the regex lastIndex since we reuse it
    TAG_REGEX.lastIndex = 0;
    let match;
    while ((match = TAG_REGEX.exec(cleaned)) !== null) {
      tags.add("#" + match[1]);
    }
  }

  return Array.from(tags);
}

export interface TagSummary {
  tag: string;
  count: number;
  notes: NoteRef[];
}

/**
 * Aggregate tags over a set of notes, sorted by count descending then tag name.
 * Reads run in small batches so a big vault does not open hundreds of requests at once.
 */
export async function aggregateTags(
  notes: NoteRef[],
  readNote: (id: string) => Promise<string | null>,
  concurrency = 10
): Promise<TagSummary[]> {
  const tagMap = new Map<string, Map<string, NoteRef>>();

  for (let i = 0; i < notes.length; i += concurrency) {
    const batch = notes.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (note) => {
        const content = await readNote(note.id);
        return { note, tags: content ? parseTags(content) : [] };
      })
    );
    for (const { note, tags } of results) {
      for (const tag of tags) {
        if (!tagMap.has(tag)) tagMap.set(tag, new Map());
        tagMap.get(tag)!.set(note.id, note);
      }
    }
  }

  const result = Array.from(tagMap.entries()).map(([tag, byId]) => ({
    tag,
    count: byId.size,
    notes: Array.from(byId.values()),
  }));
  result.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return result;
}
