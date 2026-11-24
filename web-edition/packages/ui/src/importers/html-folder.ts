/**
 * A folder (or zip) of HTML pages, as Bear, Google Keep (Takeout), a browser or another app exports them: each page
 * becomes a note (its `<title>` or first `<h1>` names it; Keep's labels become tags), pictures and files it uses
 * become attachments, links between the pages become wiki-links. Markdown files in the folder are taken as they are.
 */

import { htmlToMarkdown } from "./html-to-markdown";
import {
  attachmentName,
  dirOf,
  fileOf,
  fromBase64,
  joinPath,
  MARKDOWN_LINK,
  PathAllocator,
  resolvePath,
  safeName,
  wikiLink,
  withProperties,
  type ImportOptions,
  type ImportResult,
  type InputFile,
} from "./types";

/** Files kept as attachments: pictures, documents, sound and video. */
const MEDIA = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|pdf|mp3|wav|m4a|ogg|opus|flac|mp4|mov|webm|docx?|xlsx?|pptx?|txt|csv|zip)$/i;

/** Converts an HTML export into notes under `folder`; attachments go to `<folder, spaces as ->/_resources/`. */
export async function importHtml(files: InputFile[], folder: string, options: ImportOptions = {}): Promise<ImportResult> {
  const result: ImportResult = { notes: [], attachments: [], skipped: [] };
  const taken = Array.from(options.taken ?? []);
  const notePaths = new PathAllocator(taken);
  const filePaths = new PathAllocator(taken);
  const resources = joinPath(folder.replace(/\s+/g, "-"), "_resources");

  const pages = files.filter((f) => /\.(html?|md|markdown)$/i.test(f.path));
  const media = files.filter((f) => MEDIA.test(f.path));
  // Google Keep puts a .json of the same note beside each page: not worth listing as left out.
  const pageBases = new Set(pages.map((p) => p.path.replace(/\.[^./]+$/, "").toLowerCase()));
  for (const f of files) {
    if (pages.includes(f) || media.includes(f)) continue;
    if (/\.json$/i.test(f.path) && pageBases.has(f.path.replace(/\.json$/i, "").toLowerCase())) continue;
    result.skipped.push({ path: f.path, reason: "unsupported" });
  }

  const cleanDir = (path: string) => dirOf(path).split("/").filter(Boolean).map(safeName);

  // Pages first claim their paths, so links between them resolve whatever the order.
  const parsed = new Map<InputFile, { doc: Document | null; title: string; path: string }>();
  const pageByPath = new Map<string, string>();
  for (const page of pages) {
    let doc: Document | null = null;
    let title = fileOf(page.path).replace(/\.(html?|md|markdown)$/i, "");
    if (/\.html?$/i.test(page.path)) {
      try {
        doc = new DOMParser().parseFromString(await page.text(), "text/html");
      } catch {
        result.skipped.push({ path: page.path, reason: "unreadable" });
        continue;
      }
      title = (doc.querySelector(".note .title, body > .title")?.textContent || doc.title || doc.querySelector("h1")?.textContent || title).trim();
    }
    const path = notePaths.claim(joinPath(folder, ...cleanDir(page.path), `${safeName(title)}.md`));
    parsed.set(page, { doc, title, path });
    pageByPath.set(page.path.toLowerCase(), path);
  }

  const fileByPath = new Map<string, string>();
  const addFile = (name: string, data: Uint8Array) => {
    const path = filePaths.claim(joinPath(resources, attachmentName(name)), "-");
    result.attachments.push({ path, data });
    return path;
  };
  for (const f of media) {
    try {
      fileByPath.set(f.path.toLowerCase(), addFile(fileOf(f.path), await f.bytes()));
    } catch {
      result.skipped.push({ path: f.path, reason: "unreadable" });
    }
  }

  /** Where a link or picture of the page at `from` points, among the imported notes and files. */
  const target = (from: string, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null;
    const key = resolvePath(dirOf(from), href.split(/[?#]/)[0]).toLowerCase();
    const note = pageByPath.get(key);
    if (note) return { note };
    const file = fileByPath.get(key);
    return file ? { file } : null;
  };

  for (const [page, { doc, title, path }] of parsed) {
    if (!doc) {
      // Markdown as it is, its relative links pointed at where the notes and files went.
      const text = (await page.text()).replace(MARKDOWN_LINK, (whole, bang: string, label: string, href: string) => {
        const t = target(page.path, href);
        return t?.note ? wikiLink(t.note, label) : t?.file ? `${bang}[${label}](${t.file})` : whole;
      });
      result.notes.push({ path, content: text });
      continue;
    }
    let images = 0;
    const keep = doc.querySelector(".note .content, body > .content");
    const root = keep ?? doc.body;
    // The title is the note's name already: an <h1> or Keep title block repeating it is left out.
    for (const el of Array.from(root.querySelectorAll(":scope > h1, :scope > .title"))) if (el.textContent?.trim() === title) el.remove();
    const body = htmlToMarkdown(root, {
      image: (src, alt) => {
        const data = /^data:([\w/+.-]+);base64,(.*)$/i.exec(src);
        if (data) {
          // A picture written into the page (base64): an attachment of its own; a damaged one keeps only its text.
          try {
            const bytes = fromBase64(data[2]);
            const ext = (data[1].split("/")[1] ?? "bin").replace("jpeg", "jpg").replace("svg+xml", "svg").replace(/[^a-z0-9]/gi, "");
            return `![${alt}](${addFile(`${safeName(title)}-${++images}.${ext}`, bytes)})`;
          } catch {
            return alt || null;
          }
        }
        const t = target(page.path, src);
        return t?.file ? `![${alt}](${t.file})` : /^https?:/i.test(src) ? `![${alt}](${src})` : null;
      },
      link: (href, label) => {
        const t = target(page.path, href);
        return t?.note ? wikiLink(t.note, label.replace(/\\(.)/g, "$1")) : t?.file ? `[${label || fileOf(t.file)}](${t.file})` : null;
      },
    });
    const tags = Array.from(doc.querySelectorAll(".label-name, .labels .label"))
      .map((l) => l.textContent?.trim() ?? "")
      .filter(Boolean);
    result.notes.push({ path, content: withProperties(`${body}\n`, { tags }) });
  }
  return result;
}
