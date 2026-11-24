import { readWebAutolink, startsWebAutolink } from './markdown-links';

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'strikethrough'; children: InlineNode[] }
  | { type: 'highlight'; children: InlineNode[] }
  | { type: 'superscript'; text: string }
  | { type: 'subscript'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'image'; alt: string; url: string; width?: number; height?: number }
  | { type: 'wikilink'; name: string }
  | { type: 'tag'; tag: string }
  | { type: 'embed'; name: string }
  | { type: 'math'; code: string }
  | { type: 'footnote_ref'; id: string };

function findLinkDestinationEnd(raw: string, start: number): number {
  let depth = 1;
  for (let index = start; index < raw.length; index++) {
    if (raw[index] === '\\') {
      index++;
      continue;
    }
    if (raw[index] === '(') depth++;
    if (raw[index] === ')' && --depth === 0) return index;
  }
  return -1;
}

export function parseInline(raw: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;

  while (i < raw.length) {
    if (raw[i] === '<' || startsWebAutolink(raw, i)) {
      const link = readWebAutolink(raw, i);
      if (link) {
        nodes.push({ type: 'link', text: link.url, url: link.url });
        i = link.end;
        continue;
      }
    }

    // Inline code
    if (raw[i] === '`') {
      const end = raw.indexOf('`', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'code', text: raw.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Inline math $...$
    if (raw[i] === '$' && raw[i + 1] !== '$') {
      const end = raw.indexOf('$', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'math', code: raw.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // File embed ![[name]]
    if (raw[i] === '!' && raw[i + 1] === '[' && raw[i + 2] === '[') {
      const end = raw.indexOf(']]', i + 3);
      if (end !== -1) {
        nodes.push({ type: 'embed', name: raw.substring(i + 3, end) });
        i = end + 2;
        continue;
      }
    }

    // Wiki-link [[...]]
    if (raw[i] === '[' && raw[i + 1] === '[') {
      const end = raw.indexOf(']]', i + 2);
      if (end !== -1) {
        const inner = raw.substring(i + 2, end);
        nodes.push({ type: 'wikilink', name: inner });
        i = end + 2;
        continue;
      }
    }

    // Image ![alt](url) or ![alt|300](url) or ![alt|300x200](url)
    if (raw[i] === '!' && raw[i + 1] === '[') {
      const altEnd = raw.indexOf(']', i + 2);
      if (altEnd !== -1 && raw[altEnd + 1] === '(') {
        const urlEnd = findLinkDestinationEnd(raw, altEnd + 2);
        if (urlEnd !== -1) {
          const fullAlt = raw.substring(i + 2, altEnd);
          const url = raw.substring(altEnd + 2, urlEnd);
          let alt = fullAlt;
          let width: number | undefined;
          let height: number | undefined;
          const sizeMatch = fullAlt.match(/^(.*?)\|(\d+)(?:x(\d+))?$/);
          if (sizeMatch) {
            alt = sizeMatch[1];
            width = parseInt(sizeMatch[2], 10);
            if (sizeMatch[3]) height = parseInt(sizeMatch[3], 10);
          }
          nodes.push({ type: 'image', alt, url, width, height });
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // Link [text](url)
    if (raw[i] === '[') {
      const textEnd = raw.indexOf(']', i + 1);
      if (textEnd !== -1 && raw[textEnd + 1] === '(') {
        const urlEnd = findLinkDestinationEnd(raw, textEnd + 2);
        if (urlEnd !== -1) {
          nodes.push({
            type: 'link',
            text: raw.substring(i + 1, textEnd),
            url: raw.substring(textEnd + 2, urlEnd),
          });
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // Bold **...** or __...__
    if ((raw[i] === '*' && raw[i + 1] === '*') || (raw[i] === '_' && raw[i + 1] === '_')) {
      const marker = raw.substring(i, i + 2);
      const end = raw.indexOf(marker, i + 2);
      if (end !== -1) {
        nodes.push({ type: 'bold', children: parseInline(raw.substring(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // Strikethrough ~~...~~
    if (raw[i] === '~' && raw[i + 1] === '~') {
      const end = raw.indexOf('~~', i + 2);
      if (end !== -1) {
        nodes.push({
          type: 'strikethrough',
          children: parseInline(raw.substring(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }

    // Subscript ~text~ (single tilde)
    if (raw[i] === '~' && raw[i + 1] !== '~') {
      const end = raw.indexOf('~', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'subscript', text: raw.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Highlight ==text==
    if (raw[i] === '=' && raw[i + 1] === '=') {
      const end = raw.indexOf('==', i + 2);
      if (end !== -1) {
        nodes.push({ type: 'highlight', children: parseInline(raw.substring(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // Superscript ^text^
    if (raw[i] === '^') {
      const end = raw.indexOf('^', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'superscript', text: raw.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Italic *...* or _..._
    if ((raw[i] === '*' || raw[i] === '_') && raw[i + 1] !== raw[i]) {
      const marker = raw[i];
      const end = raw.indexOf(marker, i + 1);
      if (end !== -1 && end > i + 1) {
        nodes.push({ type: 'italic', children: parseInline(raw.substring(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    // Footnote reference [^id]
    if (raw[i] === '[' && raw[i + 1] === '^') {
      const end = raw.indexOf(']', i + 2);
      if (end !== -1) {
        const id = raw.substring(i + 2, end);
        if (id && !id.includes(' ')) {
          nodes.push({ type: 'footnote_ref', id });
          i = end + 1;
          continue;
        }
      }
    }

    // #tag (standalone word starting with #, not heading context)
    if (raw[i] === '#' && (i === 0 || raw[i - 1] === ' ') && raw[i + 1] && /[a-zA-Z]/.test(raw[i + 1])) {
      const match = raw.substring(i).match(/^#([a-zA-Z0-9_/\-]+)/);
      if (match) {
        nodes.push({ type: 'tag', tag: match[0] });
        i += match[0].length;
        continue;
      }
    }

    // Plain text - consume until next special char
    let textEnd = i + 1;
    while (textEnd < raw.length && !'[`*_~!#=^$<'.includes(raw[textEnd]) && !startsWebAutolink(raw, textEnd)) {
      textEnd++;
    }
    nodes.push({ type: 'text', text: raw.substring(i, textEnd) });
    i = textEnd;
  }

  return nodes;
}
