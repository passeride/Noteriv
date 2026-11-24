/**
 * Simple markdown-to-HTML converter.
 * Supports: headings, bold, italic, code (inline + blocks), links, images,
 * lists (ordered + unordered), blockquotes, horizontal rules, tables, task lists,
 * [TOC] placeholder, excalidraw embeds, and fenced blocks of languages a plugin renders (Mermaid, Dataview,
 * a chess board…) through the same processors as the editor.
 */

import { renderTocHTML } from "./toc-utils";
import { isSafeUrl } from "./sanitize-html";
import {
  getCodeBlockProcessor,
  PENDING_ATTRIBUTE,
  type CodeBlockProcessor,
  type CodeBlockProcessorContext,
} from "./markdown-code-block-registry";

/**
 * Render a fenced code block through a plugin-registered processor (the same
 * registry the live editor's CodeBlockWidget uses), returning the resulting
 * HTML string. Returns null if there's no processor, it throws, or we're not
 * in a browser context — callers should fall back to a plain <pre><code>.
 */
function renderCodeBlockWithProcessor(
  processor: CodeBlockProcessor,
  language: string,
  source: string
): string | null {
  try {
    const container = document.createElement("div");
    const ctx: CodeBlockProcessorContext = { source, language, sourcePath: null };
    const cleanup = processor(source, container, ctx);
    // Read innerHTML before running cleanup — some processors (e.g. the
    // chessboard plugin) clear the element in their cleanup function.
    // A processor still drawing (PENDING_ATTRIBUTE) has nothing to show yet: the plain code is the better export.
    const result = container.querySelector(`[${PENDING_ATTRIBUTE}]`) || container.hasAttribute(PENDING_ATTRIBUTE) ? "" : container.innerHTML;
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch {
        // ignore cleanup errors — we already captured the rendered HTML
      }
    }
    return result || null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Renders every fenced block whose language has a processor and returns the HTML keyed for `markdownToHTML`'s
 * `preRendered`, so an export shows what the editor shows. Processors may draw asynchronously: a sandboxed community
 * plugin answers through its iframe into a Shadow DOM, a core plugin such as Mermaid loads its library first. Either
 * way the block counts as done once something is drawn and no `PENDING_ATTRIBUTE` is left; a block still pending
 * after `timeoutMs` stays plain code in the export.
 */
export async function preRenderCodeBlocks(md: string, timeoutMs = 9000): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (typeof document === "undefined") return out;
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(`{3,}|~{3,})\s*(.*)$/);
    if (!open) continue;
    const fence = open[1];
    const langKey = open[2].trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith(fence)) body.push(lines[j++]);
    i = j; // continue after the closing fence

    const entry = langKey ? getCodeBlockProcessor(langKey) : undefined;
    if (!entry) continue;
    const source = body.join("\n");
    const key = `${langKey}\u0000${source}`;
    if (out.has(key)) continue;

    const el = document.createElement("div");
    let cleanup: void | (() => void) = undefined;
    try {
      cleanup = entry.processor(source, el, { source, language: langKey, sourcePath: null });
      const deadline = Date.now() + timeoutMs;
      let html: string | null = null;
      while (Date.now() < deadline) {
        const root: ParentNode & { innerHTML: string } = el.shadowRoot ?? el;
        if (root.innerHTML && !root.querySelector(`[${PENDING_ATTRIBUTE}]`) && !el.hasAttribute(PENDING_ATTRIBUTE)) {
          html = root.innerHTML;
          break;
        }
        await sleep(60);
      }
      if (html) out.set(key, `<div class="plugin-block">${html}</div>`);
    } catch {
      // leave this block as plain code in the export
    } finally {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch {
        // ignore
      }
    }
  }
  return out;
}

/**
 * Convert a markdown string to HTML.
 */
export interface MarkdownToHtmlOptions {
  /**
   * Plugin blocks rendered ahead of time (key = `${language}\u0000${source}`). The web's plugin processors
   * run in a sandboxed iframe and answer asynchronously, which this synchronous converter cannot await.
   */
  preRendered?: Map<string, string>;
}

export function markdownToHTML(md: string, opts: MarkdownToHtmlOptions = {}): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // [TOC] placeholder
    if (line.trim() === "[TOC]") {
      html.push(renderTocHTML(md));
      i++;
      continue;
    }

    // Fenced code blocks (``` or ~~~)
    if (line.match(/^```/) || line.match(/^~~~/)) {
      const fence = line.match(/^(`{3,}|~{3,})/)?.[1] || "```";
      const lang = line.slice(fence.length).trim();
      const codeLines: string[] = [];
      const rawLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence)) {
        rawLines.push(lines[i]);
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing fence

      // Plugin-registered code block languages (e.g. ```chessboard) — render
      // through the same processor the live editor uses, so exports keep
      // the rendered widget instead of printing raw source text.
      const langKey = lang.split(/\s+/)[0]?.toLowerCase() ?? "";
      const pre = opts.preRendered?.get(`${langKey}\u0000${rawLines.join("\n")}`);
      if (pre) {
        html.push(pre);
        continue;
      }
      const entry = typeof document !== "undefined" && langKey ? getCodeBlockProcessor(langKey) : undefined;
      if (entry) {
        const rendered = renderCodeBlockWithProcessor(entry.processor, langKey, rawLines.join("\n"));
        if (rendered !== null) {
          html.push(rendered);
          continue;
        }
      }

      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      html.push(`<pre><code${langAttr}>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (line.match(/^(\*{3,}|-{3,}|_{3,})\s*$/)) {
      html.push("<hr>");
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = inlineFormat(headingMatch[2]);
      html.push(`<h${level}>${text}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.match(/^>\s?/)) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].match(/^>\s?/)) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote><p>${inlineFormat(quoteLines.join("\n"))}</p></blockquote>`);
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].match(/^\|?\s*[-:]+[-|:\s]*$/)) {
      const tableHtml = parseTable(lines, i);
      if (tableHtml) {
        html.push(tableHtml.html);
        i = tableHtml.endIndex;
        continue;
      }
    }

    // Unordered list (-, *, +) including task lists
    if (line.match(/^(\s*)([-*+])\s/)) {
      const result = parseUnorderedList(lines, i);
      html.push(result.html);
      i = result.endIndex;
      continue;
    }

    // Ordered list
    if (line.match(/^(\s*)\d+\.\s/)) {
      const result = parseOrderedList(lines, i);
      html.push(result.html);
      i = result.endIndex;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^>\s?/) &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^~~~/) &&
      !lines[i].match(/^(\*{3,}|-{3,}|_{3,})\s*$/) &&
      !lines[i].match(/^(\s*)([-*+])\s/) &&
      !lines[i].match(/^(\s*)\d+\.\s/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      html.push(`<p>${inlineFormat(paraLines.join("\n"))}</p>`);
    }
  }

  return html.join("\n");
}

/**
 * Apply inline formatting: bold, italic, strikethrough, code, links, images.
 */
function inlineFormat(text: string): string {
  let result = escapeHtml(text);

  // Inline code (must come first to prevent inner formatting)
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Drawing embeds: ![[filename.drawing]]
  result = result.replace(
    /!\[\[([^\]]+\.drawing)\]\]/g,
    '<div class="drawing-embed" data-file="$1" style="background:#313244;border:1px solid #45475a;border-radius:8px;padding:12px;margin:4px 0;text-align:center;color:#a6adc8;font-size:12px;cursor:pointer" title="Click to open drawing">&#x1f4dd; $1</div>'
  );

  // Images: ![alt](url)
  result = result.replace(
    /!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+?)\)/g,
    // A scheme isSafeUrl rejects (javascript:, vbscript:, ...) leaves the alt text, no element.
    (_m, alt: string, url: string) => (isSafeUrl(url) ? `<img src="${url}" alt="${alt}">` : alt)
  );

  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+?)\)/g,
    // Same rule for links: an unsafe target leaves the link text as plain text.
    (_m, text: string, url: string) => (isSafeUrl(url) ? `<a href="${url}">${text}</a>` : text)
  );

  // Bold + italic: ***text*** or ___text___
  result = result.replace(/\*{3}(.+?)\*{3}/g, "<strong><em>$1</em></strong>");
  result = result.replace(/_{3}(.+?)_{3}/g, "<strong><em>$1</em></strong>");

  // Bold: **text** or __text__
  result = result.replace(/\*{2}(.+?)\*{2}/g, "<strong>$1</strong>");
  result = result.replace(/_{2}(.+?)_{2}/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Autolink bare URLs and emails. Runs after [text](url)/images so the
  // lookbehind can skip URLs already inside an href="" or anchor text (">…").
  result = autolink(result);

  // Line breaks
  result = result.replace(/\n/g, "<br>");

  return result;
}

/**
 * Trim trailing sentence punctuation from a matched URL, keeping balanced
 * parentheses that are part of the URL (e.g. /Foo_(bar)).
 */
function trimUrlEnd(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (".,;:!?\"'".includes(ch)) {
      end--;
      continue;
    }
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

/**
 * Wrap bare http(s) URLs and email addresses in anchor tags. URLs/emails that
 * are already inside a tag (href attribute or anchor text) are skipped via the
 * lookbehinds.
 */
function autolink(text: string): string {
  let out = text.replace(/(?<!["'>])\bhttps?:\/\/[^\s<>"'`]+/g, (m) => {
    const url = trimUrlEnd(m);
    return `<a href="${url}">${url}</a>${m.slice(url.length)}`;
  });
  out = out.replace(
    /(?<![\w.@:/="'>])[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    (m) => `<a href="mailto:${m}">${m}</a>`
  );
  return out;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Parse an unordered list (with support for task lists).
 */
function parseUnorderedList(
  lines: string[],
  start: number
): { html: string; endIndex: number } {
  const items: string[] = [];
  let i = start;

  while (i < lines.length) {
    // (.*) rather than (.+): an empty item such as "- " must still match, otherwise this loop makes no
    // progress and the caller (which resumes at the returned index) spins forever on that line.
    const match = lines[i].match(/^(\s*)([-*+])\s(.*)/);
    if (!match) break;

    const text = match[3];

    // Task list item
    const taskMatch = text.match(/^\[([ xX])\]\s*(.*)/);
    if (taskMatch) {
      const checked = taskMatch[1].toLowerCase() === "x";
      items.push(
        `<li><input type="checkbox" ${checked ? "checked" : ""} disabled> ${inlineFormat(taskMatch[2])}</li>`
      );
    } else {
      items.push(`<li>${inlineFormat(text)}</li>`);
    }
    i++;
  }

  return {
    html: `<ul>\n${items.join("\n")}\n</ul>`,
    endIndex: i,
  };
}

/**
 * Parse an ordered list.
 */
function parseOrderedList(
  lines: string[],
  start: number
): { html: string; endIndex: number } {
  const items: string[] = [];
  let i = start;

  while (i < lines.length) {
    // (.*) rather than (.+): see parseUnorderedList.
    const match = lines[i].match(/^(\s*)\d+\.\s(.*)/);
    if (!match) break;

    items.push(`<li>${inlineFormat(match[2])}</li>`);
    i++;
  }

  return {
    html: `<ol>\n${items.join("\n")}\n</ol>`,
    endIndex: i,
  };
}

/**
 * Parse a markdown table.
 */
function parseTable(
  lines: string[],
  start: number
): { html: string; endIndex: number } | null {
  // Header row
  const headerLine = lines[start];
  const headers = parseTableRow(headerLine);
  if (headers.length === 0) return null;

  // Separator row
  const sepLine = lines[start + 1];
  if (!sepLine.match(/^\|?\s*[-:]+[-|:\s]*$/)) return null;

  // Parse alignment from separator
  const sepCells = sepLine
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

  const alignments = sepCells.map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });

  // Build header
  const thCells = headers
    .map((h, idx) => {
      const align = alignments[idx] || "left";
      return `<th style="text-align:${align}">${inlineFormat(h)}</th>`;
    })
    .join("");

  // Body rows
  const bodyRows: string[] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
    const cells = parseTableRow(lines[i]);
    const tdCells = cells
      .map((c, idx) => {
        const align = alignments[idx] || "left";
        return `<td style="text-align:${align}">${inlineFormat(c)}</td>`;
      })
      .join("");
    bodyRows.push(`<tr>${tdCells}</tr>`);
    i++;
  }

  const html = `<table>\n<thead><tr>${thCells}</tr></thead>\n<tbody>\n${bodyRows.join("\n")}\n</tbody>\n</table>`;
  return { html, endIndex: i };
}

/**
 * Parse a single table row into cell contents.
 */
function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}
