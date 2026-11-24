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

export type BlockNode =
  | { type: 'heading'; level: number; text: string; line: number }
  | { type: 'paragraph'; text: string; line: number }
  | { type: 'code_block'; language: string; code: string; line: number }
  | { type: 'blockquote'; lines: string[]; line: number }
  | { type: 'callout'; kind: string; title: string; lines: string[]; line: number }
  | { type: 'hr'; line: number }
  | { type: 'ul'; items: { text: string; checked: boolean | null }[]; line: number }
  | { type: 'ol'; items: { text: string; num: number }[]; line: number }
  | { type: 'table'; headers: string[]; alignments: string[]; rows: string[][]; line: number }
  | { type: 'math_block'; code: string; line: number }
  | { type: 'toc'; line: number }
  | { type: 'embed'; name: string; line: number }
  | { type: 'footnote_def'; id: string; text: string; line: number }
  | { type: 'definition_list'; items: { term: string; definition: string }[]; line: number };

export type LiveMarkdownSegmentKind = 'simple_line' | 'raw_block';

export type LiveMarkdownSimpleKind =
  | 'blank'
  | 'heading'
  | 'paragraph'
  | 'ul'
  | 'ol'
  | 'task'
  | 'blockquote'
  | 'hr';

export interface LiveMarkdownSegment {
  id: string;
  kind: LiveMarkdownSegmentKind;
  simpleKind?: LiveMarkdownSimpleKind;
  rawBlockKind?:
    | 'frontmatter'
    | 'code_block'
    | 'math_block'
    | 'table'
    | 'callout'
    | 'embed'
    | 'footnote_def';
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  rawText: string;
  supportsLiveRender: boolean;
}

export interface LineInfo {
  lineNumber: number;
  start: number;
  end: number;
  text: string;
}

function splitLines(content: string): string[] {
  return content.split('\n');
}

function getLineStartOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

export function findLineFromOffset(content: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, content.length));
  const starts = getLineStartOffsets(content);
  let low = 0;
  let high = starts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= clamped) {
      if (mid === starts.length - 1 || starts[mid + 1] > clamped) {
        return mid;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return 0;
}

export function getLineInfo(content: string, lineNumber: number): LineInfo {
  const lines = splitLines(content);
  const starts = getLineStartOffsets(content);
  const clamped = Math.max(0, Math.min(lineNumber, Math.max(lines.length - 1, 0)));
  const start = starts[clamped] ?? 0;
  const text = lines[clamped] ?? '';
  return {
    lineNumber: clamped,
    start,
    end: start + text.length,
    text,
  };
}

function lineRangeToOffsets(
  content: string,
  startLine: number,
  endLine: number
): { start: number; end: number } {
  const lines = splitLines(content);
  const starts = getLineStartOffsets(content);
  const safeStartLine = Math.max(0, Math.min(startLine, Math.max(lines.length - 1, 0)));
  const safeEndLine = Math.max(safeStartLine, Math.min(endLine, Math.max(lines.length - 1, 0)));
  const start = starts[safeStartLine] ?? 0;
  const end =
    safeEndLine + 1 < starts.length
      ? starts[safeEndLine + 1] - 1
      : content.length;
  return { start, end };
}

export function replaceLineRange(
  content: string,
  startLine: number,
  endLine: number,
  replacementText: string
): string {
  if (content.length === 0) return replacementText;
  const { start, end } = lineRangeToOffsets(content, startLine, endLine);
  return content.slice(0, start) + replacementText + content.slice(end);
}

export function toggleTaskMarker(line: string): string {
  return line.replace(/^(\s*[-*+]\s+\[)([ xX])(\]\s)/, (_, before: string, mark: string, after: string) => {
    const nextMark = mark === ' ' ? 'x' : ' ';
    return `${before}${nextMark}${after}`;
  });
}

function isTableRow(line: string): boolean {
  return /^\|(.+)\|$/.test(line.trim());
}

function isTableAlignmentRow(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

export function parseInline(raw: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;

  while (i < raw.length) {
    if (raw[i] === '`') {
      const end = raw.indexOf('`', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'code', text: raw.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (raw[i] === '$' && raw[i + 1] !== '$') {
      const end = raw.indexOf('$', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'math', code: raw.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (raw[i] === '!' && raw[i + 1] === '[' && raw[i + 2] === '[') {
      const end = raw.indexOf(']]', i + 3);
      if (end !== -1) {
        nodes.push({ type: 'embed', name: raw.substring(i + 3, end) });
        i = end + 2;
        continue;
      }
    }

    if (raw[i] === '[' && raw[i + 1] === '[') {
      const end = raw.indexOf(']]', i + 2);
      if (end !== -1) {
        const inner = raw.substring(i + 2, end);
        nodes.push({ type: 'wikilink', name: inner });
        i = end + 2;
        continue;
      }
    }

    if (raw[i] === '!' && raw[i + 1] === '[') {
      const altEnd = raw.indexOf(']', i + 2);
      if (altEnd !== -1 && raw[altEnd + 1] === '(') {
        const urlEnd = raw.indexOf(')', altEnd + 2);
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

    if (raw[i] === '[') {
      const textEnd = raw.indexOf(']', i + 1);
      if (textEnd !== -1 && raw[textEnd + 1] === '(') {
        const urlEnd = raw.indexOf(')', textEnd + 2);
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

    if ((raw[i] === '*' && raw[i + 1] === '*') || (raw[i] === '_' && raw[i + 1] === '_')) {
      const marker = raw.substring(i, i + 2);
      const end = raw.indexOf(marker, i + 2);
      if (end !== -1) {
        nodes.push({ type: 'bold', children: parseInline(raw.substring(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

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

    if (raw[i] === '~' && raw[i + 1] !== '~') {
      const end = raw.indexOf('~', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'subscript', text: raw.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (raw[i] === '=' && raw[i + 1] === '=') {
      const end = raw.indexOf('==', i + 2);
      if (end !== -1) {
        nodes.push({ type: 'highlight', children: parseInline(raw.substring(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (raw[i] === '^') {
      const end = raw.indexOf('^', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'superscript', text: raw.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if ((raw[i] === '*' || raw[i] === '_') && raw[i + 1] !== raw[i]) {
      const marker = raw[i];
      const end = raw.indexOf(marker, i + 1);
      if (end !== -1 && end > i + 1) {
        nodes.push({ type: 'italic', children: parseInline(raw.substring(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

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

    if (raw[i] === '#' && (i === 0 || raw[i - 1] === ' ') && raw[i + 1] && /[a-zA-Z]/.test(raw[i + 1])) {
      const match = raw.substring(i).match(/^#([a-zA-Z0-9_/\-]+)/);
      if (match) {
        nodes.push({ type: 'tag', tag: match[0] });
        i += match[0].length;
        continue;
      }
    }

    let textEnd = i + 1;
    while (textEnd < raw.length && !'[`*_~!#=^$'.includes(raw[textEnd])) {
      textEnd++;
    }
    nodes.push({ type: 'text', text: raw.substring(i, textEnd) });
    i = textEnd;
  }

  return nodes;
}

export function parseBlocks(content: string): BlockNode[] {
  const lines = splitLines(content);
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().substring(3).trim();
      const codeLines: string[] = [];
      const startLine = i;
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code_block', language: lang, code: codeLines.join('\n'), line: startLine });
      continue;
    }

    if (line.trim() === '$$') {
      const codeLines: string[] = [];
      const startLine = i;
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'math_block', code: codeLines.join('\n'), line: startLine });
      continue;
    }

    const embedMatch = line.trim().match(/^!\[\[(.+?)\]\]$/);
    if (embedMatch) {
      blocks.push({ type: 'embed', name: embedMatch[1], line: i });
      i++;
      continue;
    }

    if (line.trim() === '[TOC]') {
      blocks.push({ type: 'toc', line: i });
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
        line: i,
      });
      i++;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr', line: i });
      i++;
      continue;
    }

    if (i + 1 < lines.length && isTableRow(line) && isTableAlignmentRow(lines[i + 1])) {
      const headers = line.trim().slice(1, -1).split('|').map((h) => h.trim());
      const alignRow = lines[i + 1].trim().slice(1, -1).split('|').map((a) => a.trim());
      const alignments = alignRow.map((a) => {
        if (a.startsWith(':') && a.endsWith(':')) return 'center';
        if (a.endsWith(':')) return 'right';
        return 'left';
      });
      const rows: string[][] = [];
      const startLine = i;
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
        i++;
      }
      blocks.push({ type: 'table', headers, alignments, rows, line: startLine });
      continue;
    }

    const calloutMatch = line.match(/^>\s*\[!(\w+)\]\s*(.*)?$/);
    if (calloutMatch) {
      const kind = calloutMatch[1].toLowerCase();
      const title = calloutMatch[2] || kind.charAt(0).toUpperCase() + kind.slice(1);
      const contentLines: string[] = [];
      const startLine = i;
      i++;
      while (i < lines.length && lines[i].startsWith('>')) {
        contentLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'callout', kind, title, lines: contentLines, line: startLine });
      continue;
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      const startLine = i;
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines, line: startLine });
      continue;
    }

    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: { text: string; checked: boolean | null }[] = [];
      const startLine = i;
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        const itemText = lines[i].replace(/^[\s]*[-*+]\s/, '');
        const taskMatch = itemText.match(/^\[([ xX])\]\s(.*)$/);
        if (taskMatch) {
          items.push({ text: taskMatch[2], checked: taskMatch[1] !== ' ' });
        } else {
          items.push({ text: itemText, checked: null });
        }
        i++;
      }
      blocks.push({ type: 'ul', items, line: startLine });
      continue;
    }

    if (/^[\s]*\d+[.)]\s/.test(line)) {
      const items: { text: string; num: number }[] = [];
      const startLine = i;
      while (i < lines.length && /^[\s]*\d+[.)]\s/.test(lines[i])) {
        const match = lines[i].match(/^[\s]*(\d+)[.)]\s(.*)$/);
        if (match) {
          items.push({ num: parseInt(match[1], 10), text: match[2] });
        }
        i++;
      }
      blocks.push({ type: 'ol', items, line: startLine });
      continue;
    }

    const fnMatch = line.match(/^\[\^(\w+)\]:\s*(.+)$/);
    if (fnMatch) {
      blocks.push({ type: 'footnote_def', id: fnMatch[1], text: fnMatch[2], line: i });
      i++;
      continue;
    }

    if (i + 1 < lines.length && lines[i + 1].match(/^:\s+/)) {
      const items: { term: string; definition: string }[] = [];
      const startLine = i;
      while (i < lines.length) {
        const term = lines[i];
        if (i + 1 >= lines.length || !lines[i + 1].match(/^:\s+/)) break;
        i++;
        const def = lines[i].replace(/^:\s+/, '');
        items.push({ term, definition: def });
        i++;
      }
      if (items.length > 0) {
        blocks.push({ type: 'definition_list', items, line: startLine });
        continue;
      }
    }

    const paraLines: string[] = [];
    const startLine = i;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|>|\*{3,}|-{3,}|_{3,}|[-*+]\s|\d+[.)]\s|\|)/.test(lines[i]) &&
      lines[i].trim() !== '$$'
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n'), line: startLine });
    }
  }

  return blocks;
}

function createSegment(
  content: string,
  startLine: number,
  endLine: number,
  kind: LiveMarkdownSegmentKind,
  options: Partial<LiveMarkdownSegment> = {}
): LiveMarkdownSegment {
  const { start, end } = lineRangeToOffsets(content, startLine, endLine);
  return {
    id: `${kind}:${startLine}:${endLine}`,
    kind,
    startLine,
    endLine,
    startOffset: start,
    endOffset: end,
    rawText: content.slice(start, end),
    supportsLiveRender: kind === 'simple_line',
    ...options,
  };
}

function classifySimpleLine(line: string): LiveMarkdownSimpleKind {
  if (line.trim() === '') return 'blank';
  if (/^(#{1,6})\s+/.test(line)) return 'heading';
  if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) return 'hr';
  if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) return 'task';
  if (/^\s*[-*+]\s+/.test(line)) return 'ul';
  if (/^\s*\d+[.)]\s+/.test(line)) return 'ol';
  if (/^>/.test(line)) return 'blockquote';
  return 'paragraph';
}

export function segmentLiveMarkdown(content: string): LiveMarkdownSegment[] {
  const lines = splitLines(content);
  const segments: LiveMarkdownSegment[] = [];
  let i = 0;

  if (lines.length === 0) {
    return [
      {
        id: 'simple_line:0:0',
        kind: 'simple_line',
        simpleKind: 'blank',
        startLine: 0,
        endLine: 0,
        startOffset: 0,
        endOffset: 0,
        rawText: '',
        supportsLiveRender: true,
      },
    ];
  }

  while (i < lines.length) {
    const line = lines[i];

    if (i === 0 && line.trim() === '---') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '---') {
        j++;
      }
      if (j < lines.length) {
        segments.push(
          createSegment(content, i, j, 'raw_block', {
            rawBlockKind: 'frontmatter',
            supportsLiveRender: false,
          })
        );
        i = j + 1;
        continue;
      }
    }

    if (line.trimStart().startsWith('```')) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trimStart().startsWith('```')) {
        j++;
      }
      const endLine = j < lines.length ? j : lines.length - 1;
      segments.push(
        createSegment(content, i, endLine, 'raw_block', {
          rawBlockKind: 'code_block',
          supportsLiveRender: false,
        })
      );
      i = endLine + 1;
      continue;
    }

    if (line.trim() === '$$') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '$$') {
        j++;
      }
      const endLine = j < lines.length ? j : lines.length - 1;
      segments.push(
        createSegment(content, i, endLine, 'raw_block', {
          rawBlockKind: 'math_block',
          supportsLiveRender: false,
        })
      );
      i = endLine + 1;
      continue;
    }

    if (i + 1 < lines.length && isTableRow(line) && isTableAlignmentRow(lines[i + 1])) {
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        j++;
      }
      segments.push(
        createSegment(content, i, j - 1, 'raw_block', {
          rawBlockKind: 'table',
          supportsLiveRender: false,
        })
      );
      i = j;
      continue;
    }

    if (/^>\s*\[!(\w+)\]\s*(.*)?$/.test(line)) {
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith('>')) {
        j++;
      }
      segments.push(
        createSegment(content, i, j - 1, 'raw_block', {
          rawBlockKind: 'callout',
          supportsLiveRender: false,
        })
      );
      i = j;
      continue;
    }

    if (line.trim().match(/^!\[\[(.+?)\]\]$/)) {
      segments.push(
        createSegment(content, i, i, 'raw_block', {
          rawBlockKind: 'embed',
          supportsLiveRender: false,
        })
      );
      i++;
      continue;
    }

    if (/^\[\^(\w+)\]:\s*(.+)$/.test(line)) {
      segments.push(
        createSegment(content, i, i, 'raw_block', {
          rawBlockKind: 'footnote_def',
          supportsLiveRender: false,
        })
      );
      i++;
      continue;
    }

    const simpleKind = classifySimpleLine(line);
    segments.push(
      createSegment(content, i, i, 'simple_line', {
        simpleKind,
        supportsLiveRender: true,
      })
    );
    i++;
  }

  return segments;
}
