/** Heading outline of a markdown document, as shown in the Outline panel. */

export interface OutlineHeading {
  /** 1 for `#` through 6 for `######`. */
  level: number;
  text: string;
  /** 1-based line number of the heading. */
  line: number;
}

/**
 * Headings in document order. Lines inside fenced code blocks are not headings, and a trailing run of `#`
 * (closing sequence) is dropped from the text.
 */
export function extractOutline(content: string): OutlineHeading[] {
  const result: OutlineHeading[] = [];
  const lines = content.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code fences to avoid matching headings inside code blocks
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      result.push({
        level: match[1].length,
        text: match[2].replace(/\s*#+\s*$/, ""),
        line: i + 1,
      });
    }
  }
  return result;
}
