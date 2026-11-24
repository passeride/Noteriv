import type { InlineRenderer, InlineReplacement } from "../types";

// Bare URLs (http/https) and email addresses that aren't already part of a
// markdown link. Runs late (priority 55) so URLs inside `[text](url)`,
// `![alt](url)` or inline code are claimed by those renderers first and the
// overlap resolver skips the bare match.
const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Escape text for safe insertion via innerHTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Trim trailing punctuation that is almost always sentence punctuation rather
 * than part of the URL (mirrors GFM autolink behavior). A closing paren is only
 * trimmed when the URL has no matching opening paren.
 */
function trimUrlEnd(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (".,;:!?\"'".includes(ch)) {
      end--;
      continue;
    }
    // Trim a trailing ")" only when it's unbalanced (i.e. sentence punctuation
    // wrapping the URL), keeping parens that belong to the URL like /Foo_(bar).
    if (ch === ")") {
      const slice = url.slice(0, end);
      const opens = (slice.match(/\(/g) || []).length;
      const closes = (slice.match(/\)/g) || []).length;
      if (closes > opens) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

export const autolinkRenderer: InlineRenderer = {
  name: "autolinks",
  priority: 55, // After inline code/bold/italic (50) and links (20)/images (10)

  find(text: string, offset: number): InlineReplacement[] {
    const results: InlineReplacement[] = [];

    const urlRe = new RegExp(URL_REGEX.source, URL_REGEX.flags);
    let match: RegExpExecArray | null;
    while ((match = urlRe.exec(text)) !== null) {
      const url = trimUrlEnd(match[0]);
      if (!url) continue;
      const safe = escapeHtml(url);
      results.push({
        from: offset + match.index,
        to: offset + match.index + url.length,
        html: `<a href="${safe}" class="md-link">${safe}</a>`,
        className: "md-link-wrapper",
      });
    }

    const emailRe = new RegExp(EMAIL_REGEX.source, EMAIL_REGEX.flags);
    while ((match = emailRe.exec(text)) !== null) {
      const from = offset + match.index;
      const to = from + match[0].length;
      // Skip emails that fall inside an already-matched URL (e.g. user@host in a path).
      if (results.some((r) => from < r.to && to > r.from)) continue;
      const safe = escapeHtml(match[0]);
      results.push({
        from,
        to,
        html: `<a href="mailto:${safe}" class="md-link">${safe}</a>`,
        className: "md-link-wrapper",
      });
    }

    return results;
  },
};
