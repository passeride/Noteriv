/**
 * HTML (and Evernote's ENML) to Markdown, over the DOM (`DOMParser`: browsers and the desktop WebView). Covers what
 * notes are made of: headings, paragraphs and line breaks, bold/italic/strike/highlight/code, links, images, lists
 * (nested, numbered, tasks, with blocks inside items), quotes, code blocks (Evernote's too), rules and tables.
 * Anything else keeps its text.
 */

export interface HtmlToMarkdownOptions {
  /** Markdown for an image (`src` as written in the HTML), or null to keep only its alt text. */
  image?(src: string, alt: string): string | null;
  /** Markdown for Evernote's `<en-media hash type>` (an attached image or file), or null to drop it. */
  media?(hash: string, type: string): string | null;
  /** Markdown for a link (`href` as written, `label` already converted), or null for the plain `[label](href)`. */
  link?(href: string, label: string): string | null;
}

const SKIP = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "META", "LINK", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON", "EN-CRYPT"]);
const BLOCK = new Set(["EN-NOTE", "P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "FIGURE", "FIGCAPTION", "BODY", "HTML", "CENTER", "DL", "DT", "DD", "ADDRESS", "DETAILS", "SUMMARY"]);
const OTHER_BLOCKS = /^(H[1-6]|UL|OL|BLOCKQUOTE|PRE|HR|TABLE|LI)$/;
const isBlockTag = (tag: string) => BLOCK.has(tag) || OTHER_BLOCKS.test(tag);

/** Characters that would turn text into markup (`$` starts math). */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>$])/g, "\\$1");
}

/** A line of text that would start a heading, list or quote is escaped there. */
function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^(\s*)(#{1,6}(?=\s)|[-+](?=\s)|\d+(?=[.)]\s)|>|={3,}\s*$|-{3,}\s*$)/, "$1\\$2"))
    .join("\n");
}

/** Inline code, fenced with enough backticks for the text inside. */
function inlineCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  return longest ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/** A fenced code block around `text`. */
function codeBlock(text: string, lang = ""): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

/** Wraps `inner` in `mark` (`**`…) keeping spaces outside it, as Markdown needs. */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

/** A URL as a Markdown link target: whitespace, brackets and parentheses encoded. */
function linkTarget(url: string): string {
  return url.trim().replace(/[\s()<>]/g, (c) => encodeURIComponent(c));
}

/** Links that may stay links: web, mail, and paths inside the export. */
function allowedHref(href: string): boolean {
  const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(href.replace(/[\u0000- ]/g, ""))?.[1]?.toLowerCase();
  return !scheme || scheme === "http" || scheme === "https" || scheme === "mailto";
}

/** Converts a document, a fragment or an HTML string. */
export function htmlToMarkdown(input: string | Node, options: HtmlToMarkdownOptions = {}): string {
  // HTML parsing ignores the `/>` of custom elements (Evernote's `<en-todo/>`), which would swallow what follows.
  const html = typeof input === "string" ? input.replace(/<([a-z]+-[a-z-]+)([^<>]*?)\s*\/>/gi, "<$1$2></$1>") : "";
  const root = typeof input === "string" ? new DOMParser().parseFromString(html, "text/html").body : input;
  return blocks(root, options)
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Block = { text: string; tight?: boolean; blank?: boolean };

/** Markdown of the children of a block container: blocks separated by blank lines, loose text as paragraphs. */
function blocks(node: Node, o: HtmlToMarkdownOptions): string {
  let out = "";
  let line = "";
  /** Whether the last block ended with a single line break (a div line): a block after it needs a blank line. */
  let afterTight = false;
  const flush = () => {
    const text = line.replace(/^[ \t]+|[ \t]+$/g, "");
    if (text) {
      out += `${afterTight ? "\n" : ""}${escapeLineStarts(text)}\n\n`;
      afterTight = false;
    }
    line = "";
  };
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      line += escapeText((child.textContent ?? "").replace(/\s+/g, " "));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) continue;
    const block = blockOf(el, tag, o);
    if (block === null) {
      line += inline(el, o);
      continue;
    }
    flush();
    if (block.blank) {
      // An empty line in the note (Evernote's `<div><br/></div>`).
      if (out && !out.endsWith("\n\n")) out += "\n";
      afterTight = false;
      continue;
    }
    if (!block.text) continue;
    if (afterTight && !block.tight) out += "\n";
    out += `${block.text}${block.tight ? "\n" : "\n\n"}`;
    afterTight = !!block.tight;
  }
  flush();
  return out;
}

/** The Markdown of a block element, or null when it is inline. */
function blockOf(el: Element, tag: string, o: HtmlToMarkdownOptions): Block | null {
  if (/^H[1-6]$/.test(tag)) {
    const text = inlineChildren(el, o).replace(/\s*\n\s*/g, " ").trim();
    return { text: text ? `${"#".repeat(Number(tag[1]))} ${text}` : "" };
  }
  switch (tag) {
    case "UL":
    case "OL":
      return { text: list(el, o, "") };
    case "LI":
      return { text: list(el, o, "", true) };
    case "BLOCKQUOTE": {
      const inner = blocks(el, o).trim();
      return { text: inner ? inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") : "" };
    }
    case "PRE": {
      const code = el.querySelector("code");
      const lang = /(?:lang|language)-([\w+#.-]+)/.exec(`${code?.className ?? ""} ${el.className}`)?.[1] ?? "";
      return { text: codeBlock((el.textContent ?? "").replace(/\n$/, ""), lang) };
    }
    case "HR":
      return { text: "---" };
    case "TABLE":
      return { text: table(el, o) };
  }
  if (!BLOCK.has(tag)) return null;
  // Evernote's code block: a div styled `-en-codeblock:true`, one div per line inside.
  if (/-en-codeblock\s*:\s*true/i.test(el.getAttribute("style") ?? "")) {
    const lines = el.children.length
      ? Array.from(el.children).map((c) => (c.textContent ?? "").replace(/ /g, " "))
      : (el.textContent ?? "").split("\n");
    return { text: codeBlock(lines.join("\n").replace(/\n+$/, "")) };
  }
  // A div with nothing but line breaks: an empty line.
  if (tag === "DIV" && !el.textContent?.trim() && !el.querySelector("img, en-media, en-todo, input, hr, table")) return { text: "", blank: true };
  // A div with only inline content is a line (Evernote writes one div per line); with blocks inside, it is a group.
  if (Array.from(el.children).some((c) => isBlockTag(c.tagName.toUpperCase()))) return { text: blocks(el, o).trim() };
  let text = escapeLineStarts(inlineChildren(el, o).trim());
  // Evernote's checkbox lines: `<div><en-todo/>Buy milk</div>`.
  if (/^\[[ x]\] /.test(text)) text = `- ${text}`;
  return { text, tight: tag === "DIV" || text.startsWith("- [") };
}

/** A list; nested lists and blocks inside an item are indented under its text. `single`: an `<li>` outside a list. */
function list(el: Element, o: HtmlToMarkdownOptions, indent: string, single = false): string {
  const ordered = el.tagName.toUpperCase() === "OL";
  let n = Number(el.getAttribute("start") ?? 1) || 1;
  const items = single ? [el] : Array.from(el.children).filter((c) => c.tagName.toUpperCase() === "LI");
  const lines: string[] = [];
  for (const li of items) {
    const box = li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > en-todo");
    const checked = box ? box.hasAttribute("checked") && box.getAttribute("checked") !== "false" : false;
    const marker = ordered ? `${n++}.` : "-";
    const inner = indent + " ".repeat(marker.length + 1);
    let text = "";
    const after: string[] = [];
    for (const child of Array.from(li.childNodes)) {
      if (child === box) continue;
      if (child.nodeType === 3) {
        if (after.length === 0) text += escapeText((child.textContent ?? "").replace(/\s+/g, " "));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const c = child as Element;
      const tag = c.tagName.toUpperCase();
      if (SKIP.has(tag)) continue;
      if (tag === "UL" || tag === "OL") {
        after.push(list(c, o, inner));
        continue;
      }
      // The first paragraph is the item's text; later blocks go under it, indented.
      if ((tag === "P" || tag === "DIV") && !text.trim() && after.length === 0 && !Array.from(c.children).some((x) => isBlockTag(x.tagName.toUpperCase()))) {
        text += inlineChildren(c, o);
        continue;
      }
      const block = isBlockTag(tag) ? blockOf(c, tag, o) : null;
      if (block) {
        if (block.text) after.push(`\n${block.text.split("\n").map((l) => (l ? inner + l : "")).join("\n")}`);
      } else if (after.length === 0) text += inline(c, o);
    }
    const first = text.replace(/\s+/g, " ").trim();
    lines.push(`${indent}${marker} ${box ? `[${checked ? "x" : " "}] ` : ""}${escapeLineStarts(first)}`.replace(/\s+$/, ""));
    lines.push(...after);
  }
  return lines.join("\n");
}

/** A GFM table of the table's own rows (not those of tables inside its cells); the first row is the header. */
function table(el: Element, o: HtmlToMarkdownOptions): string {
  const rows = Array.from(el.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr")).map((tr) =>
    Array.from(tr.children)
      .filter((c) => /^(TD|TH)$/i.test(c.tagName))
      .map((cell) => {
        // A table inside a cell cannot be one in Markdown: its cells' text, on the line.
        const flat = cell.cloneNode(true) as Element;
        for (const inner of Array.from(flat.querySelectorAll("table"))) {
          const words = Array.from(inner.querySelectorAll("td, th")).map((c) => c.textContent?.trim()).filter(Boolean);
          inner.replaceWith(flat.ownerDocument.createTextNode(` ${words.join(" ")} `));
        }
        return inlineChildren(flat, o).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
      })
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const row = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [row(rows[0]), row(Array(width).fill("---")), ...rows.slice(1).map(row)].join("\n");
}

/** Inline Markdown of an element's children. */
function inlineChildren(el: Element, o: HtmlToMarkdownOptions): string {
  return Array.from(el.childNodes)
    .map((c) => (c.nodeType === 3 ? escapeText((c.textContent ?? "").replace(/\s+/g, " ")) : c.nodeType === 1 ? inline(c as Element, o) : ""))
    .join("");
}

/** Inline Markdown of an element and its children. */
function inline(el: Element, o: HtmlToMarkdownOptions): string {
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return "";
  const children = () => inlineChildren(el, o);
  switch (tag) {
    case "BR":
      return "\n";
    case "STRONG":
    case "B":
      return wrap(children(), "**");
    case "EM":
    case "I":
    case "CITE":
      return wrap(children(), "*");
    case "S":
    case "DEL":
    case "STRIKE":
      return wrap(children(), "~~");
    case "MARK":
      return wrap(children(), "==");
    case "CODE":
    case "KBD":
    case "SAMP":
      return inlineCode((el.textContent ?? "").replace(/\s+/g, " "));
    case "A": {
      const href = (el.getAttribute("href") ?? "").trim();
      const label = children().replace(/\s*\n\s*/g, " ").trim();
      if (!href || !allowedHref(href)) return label;
      const custom = o.link?.(href, label);
      if (custom) return custom;
      if (href.startsWith("#")) return label;
      return `[${label || escapeText(href)}](${linkTarget(href)})`;
    }
    case "IMG": {
      const src = (el.getAttribute("src") ?? "").trim();
      const alt = (el.getAttribute("alt") ?? "").replace(/[[\]\n]/g, " ").trim();
      if (!src) return alt;
      if (o.image) return o.image(src, alt) ?? alt;
      return /^data:/i.test(src) || !allowedHref(src) ? alt : `![${alt}](${linkTarget(src)})`;
    }
    case "EN-MEDIA":
      return o.media?.(el.getAttribute("hash") ?? "", el.getAttribute("type") ?? "") ?? "";
    case "EN-TODO":
      return el.getAttribute("checked") === "true" ? "[x] " : "[ ] ";
    case "INPUT":
      return el.getAttribute("type") === "checkbox" ? (el.hasAttribute("checked") ? "[x] " : "[ ] ") : "";
  }
  // A block found inside inline content (a <div> in a <span>): its text, on lines of its own.
  if (isBlockTag(tag)) {
    const inner = blockOf(el, tag, o)?.text ?? children();
    return inner ? `\n${inner}\n` : "";
  }
  return children();
}
