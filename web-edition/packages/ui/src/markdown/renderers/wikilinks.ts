import type { InlineRenderer, InlineReplacement } from "../types";
import { isNoteEmbedTarget } from "./note-embed";

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// Obsidian-style wikilinks: [[page]] or [[page|display text]]
export const wikilinkRenderer: InlineRenderer = {
  name: "wikilinks",
  priority: 8, // Before other inline but after footnotes

  find(text: string, offset: number): InlineReplacement[] {
    const results: InlineReplacement[] = [];
    const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const target = match[1];
      const display = match[2] || match[1];

      results.push({
        from: offset + match.index,
        to: offset + match.index + match[0].length,
        html: `<span class="md-wikilink" data-target="${target}">${display}</span>`,
        className: "md-wikilink-wrapper",
      });
    }

    return results;
  },
};

// Obsidian-style embeds: ![[file]]
export const embedRenderer: InlineRenderer = {
  name: "embeds",
  priority: 7,

  find(text: string, offset: number): InlineReplacement[] {
    const results: InlineReplacement[] = [];
    const regex = /!\[\[([^\]]+)\]\]/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const target = match[1];

      results.push({
        from: offset + match.index,
        to: offset + match.index + match[0].length,
        // Inside a line of text an embed stays a chip; one naming a note opens it like a link (a file such as an
        // image or PDF does not: there is no note to open, and the link would create one).
        html: isNoteEmbedTarget(target) && !IMAGE_FILE.test(target.split(/[#|]/)[0])
          ? `<span class="md-embed md-wikilink" data-target="${target}"><span class="md-embed-icon">&#8689;</span> ${target}</span>`
          : `<span class="md-embed"><span class="md-embed-icon">&#8689;</span> ${target}</span>`,
        className: "md-embed-wrapper",
      });
    }

    return results;
  },
};
