import { Decoration, WidgetType } from "@codemirror/view";
import { extractEmbed, parseLinkTarget, stripBlockIds } from "@noteriv/core/note-embed";
import { markdownToHTML } from "@noteriv/core/markdown-to-html";
import { sanitizeHtml } from "@noteriv/core/sanitize-html";
import type { BlockRenderer, InlineRenderer } from "../types";
import { getEmbedSource, getEmbedVersion } from "../vault-hooks";
import { t } from "../../i18n";

/** A line that is only `![[target]]`. */
const FULL_LINE_EMBED = /^\s*!\[\[([^\]]+)\]\]\s*$/;
/** Files other features show (drawings, canvases, PDFs, audio and video): not embedded as notes here. */
const OTHER_FILE = /\.(drawing|canvas|excalidraw|pdf|base|mp3|wav|m4a|ogg|oga|flac|webm|mp4|mov)$/i;
/** Embeds inside embeds stop here (a note embedding itself is caught earlier, by path). */
const MAX_DEPTH = 4;

/** Whether `![[target]]` on a line of its own is shown as an embedded note or image. */
export function isNoteEmbedTarget(target: string): boolean {
  const { note, heading, block } = parseLinkTarget(target);
  return (!!note || !!heading || !!block) && !OTHER_FILE.test(note);
}

function message(body: HTMLElement, text: string) {
  body.replaceChildren();
  const p = document.createElement("div");
  p.className = "md-note-embed-message";
  p.textContent = text;
  body.appendChild(p);
}

/**
 * `[[Note]]` and `[[Note|text]]` left as text by the HTML conversion become the same clickable links as in the
 * editor (`.md-wikilink[data-target]`); text inside code and existing links is left alone.
 */
function linkifyWikilinks(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.textContent ?? "").includes("[[") && !(n.parentElement?.closest("code, pre, a"))) nodes.push(n as Text);
  }
  for (const node of nodes) {
    const text = node.textContent ?? "";
    const parts = text.split(/(\[\[[^\]\n]+\]\])/g);
    if (parts.length === 1) continue;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(part);
      if (!m) {
        if (part) frag.appendChild(document.createTextNode(part));
        continue;
      }
      const span = document.createElement("span");
      span.className = "md-wikilink";
      span.dataset.target = m[1];
      span.textContent = m[2] ?? m[1];
      frag.appendChild(span);
    }
    node.replaceWith(frag);
  }
}

/** Markdown of an embedded section, rendered; lines that are embeds themselves become nested embeds. */
function renderSection(body: HTMLElement, markdown: string, depth: number, seen: Set<string>) {
  body.replaceChildren();
  const lines = stripBlockIds(markdown).split("\n");
  let chunk: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (chunk.length === 0) return;
    const div = document.createElement("div");
    div.className = "md-note-embed-md";
    div.innerHTML = sanitizeHtml(markdownToHTML(chunk.join("\n")));
    linkifyWikilinks(div);
    body.appendChild(div);
    chunk = [];
  };
  for (const line of lines) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    } else if (f) {
      fence = f[1];
    }
    const nested = !fence && !f ? FULL_LINE_EMBED.exec(line) : null;
    if (nested && isNoteEmbedTarget(nested[1])) {
      flush();
      body.appendChild(createEmbedElement(nested[1], depth + 1, seen));
    } else {
      chunk.push(line);
    }
  }
  flush();
}

/**
 * The DOM of one embed: a title bar (click to open the target) and the embedded content, loaded from the app's
 * EmbedSource. `seen` holds the vault paths of the embeds around this one, so a note embedding itself stops.
 */
export function createEmbedElement(target: string, depth = 0, seen: Set<string> = new Set()): HTMLElement {
  const parsed = parseLinkTarget(target);
  const root = document.createElement("div");
  root.className = "md-note-embed";
  // Not `data-target`: the desktop app treats any element with that attribute as a link to open on click.
  root.dataset.embedTarget = target;

  const header = document.createElement("div");
  header.className = "md-note-embed-header";
  const title = document.createElement("button");
  title.type = "button";
  title.className = "md-note-embed-title";
  const where = parsed.heading ?? (parsed.block ? `^${parsed.block}` : null);
  title.textContent = `${parsed.note.replace(/\.md$/i, "")}${where ? ` › ${where}` : ""}`;
  title.title = t("editor.embed.open");
  title.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    getEmbedSource()?.open(target);
  });
  header.appendChild(title);
  root.appendChild(header);

  const body = document.createElement("div");
  body.className = "md-note-embed-body";
  root.appendChild(body);

  if (depth >= MAX_DEPTH) {
    message(body, t("editor.embed.tooDeep"));
    return root;
  }
  const source = getEmbedSource();
  if (!source) {
    message(body, t("editor.embed.unavailable"));
    return root;
  }
  message(body, t("editor.embed.loading"));
  void source
    .load(parsed.note)
    .catch(() => null)
    .then((found) => {
      if (!found) return message(body, t("editor.embed.notFound", { target: parsed.note || target }));
      if ("image" in found) {
        body.replaceChildren();
        const img = document.createElement("img");
        img.className = "md-note-embed-image";
        img.src = found.image;
        img.alt = parsed.alias ?? parsed.note;
        body.appendChild(img);
        return;
      }
      const key = found.path.toLowerCase();
      if (seen.has(key)) return message(body, t("editor.embed.loop"));
      const section = extractEmbed(found.content, parsed);
      if (section === null) return message(body, t("editor.embed.anchorNotFound", { anchor: where ?? "" }));
      renderSection(body, section, depth, new Set(seen).add(key));
    });
  return root;
}

class NoteEmbedWidget extends WidgetType {
  /** Captured at construction: once the app reports changed notes, older widgets are unequal and load again. */
  private readonly version = getEmbedVersion();

  constructor(readonly target: string) {
    super();
  }
  eq(other: NoteEmbedWidget) {
    return other.target === this.target && other.version === this.version;
  }
  toDOM() {
    return createEmbedElement(this.target);
  }
  ignoreEvent(e: Event) {
    // The title opens the note; a click elsewhere puts the cursor on the line (showing the raw `![[…]]`).
    return e.type === "mousedown" && !!(e.target as HTMLElement | null)?.closest(".md-note-embed-title");
  }
}

/** A line that is only an embed of a note (or an image): the embedded content, live. */
export const noteEmbedRenderer: BlockRenderer = {
  name: "note-embed",
  process({ builder, line, text }) {
    const m = FULL_LINE_EMBED.exec(text);
    if (!m || !isNoteEmbedTarget(m[1])) return false;
    builder.add(line.from, line.to, Decoration.replace({ widget: new NoteEmbedWidget(m[1]) }));
    return true;
  },
};

/** A block id at the end of a line (` ^id`), or alone on its line: shown faint, like Obsidian hides it. */
export const blockIdRenderer: InlineRenderer = {
  name: "block-id",
  priority: 60,
  find(text, offset) {
    const m = /(?:^|\s)(\^[A-Za-z0-9-]+)\s*$/.exec(text);
    if (!m) return [];
    const from = offset + m.index + m[0].indexOf(m[1]);
    return [{ from, to: from + m[1].length, html: `<span class="md-block-id">${m[1]}</span>`, className: "md-block-id-wrapper" }];
  },
};
