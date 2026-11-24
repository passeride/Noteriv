import type { InlineRenderer, InlineReplacement } from "../types";
import { isExternalPath, parseDestination } from "@/lib/link-resolve";

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The attribute that marks a link to a file in the vault, holding its destination as written. */
export const VAULT_LINK_ATTRIBUTE = "data-vault-link";

/** The external URL schemes the system opener handles for note links. */
export function isOpenableMarkdownUrl(url: string): boolean {
  return !/[\x00-\x1f\x7f]/.test(url) && /^(https?:\/\/|mailto:|tel:)\S/i.test(url);
}

/** Render a link for the system opener or the app's vault navigation. */
export function linkOpenTag(destination: string): string {
  const { path, fragment } = parseDestination(destination);
  const url = (path.startsWith("//") ? `https:${path}` : path) + fragment;
  if (isOpenableMarkdownUrl(url)) {
    return `<a href="${escapeAttr(url)}" class="md-link">`;
  }
  if (isExternalPath(path) || path.startsWith("//")) return '<a>';
  return `<a class="md-link" ${VAULT_LINK_ATTRIBUTE}="${escapeAttr(destination)}">`;
}

export const linkRenderer: InlineRenderer = {
  name: "links",
  priority: 20, // After images (which use similar syntax)

  find(text: string, offset: number): InlineReplacement[] {
    const results: InlineReplacement[] = [];
    // A URL can include a parenthesized segment, such as `/article-(mcp)`.
    // Match one balanced level instead of stopping at the first closing paren.
    const regex = /(?<!!)\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+?)\)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      results.push({
        from: offset + match.index,
        to: offset + match.index + match[0].length,
        html: `${linkOpenTag(match[2])}${match[1]}</a>`,
        className: "md-link-wrapper",
      });
    }

    return results;
  },
};
