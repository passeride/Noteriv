/**
 * Evernote export (`.enex`, Evernote's published XML format): each `<note>` becomes a Markdown note (its ENML
 * content converted), with `created`, `updated`, `tags` and `source` properties; each `<resource>` becomes an
 * attachment in `_resources/`, put where the note shows it (`<en-media hash>` is the MD5 of the resource's data).
 */

import { htmlToMarkdown } from "./html-to-markdown";
import { md5 } from "./md5";
import { attachmentName, fromBase64, joinPath, PathAllocator, safeName, withProperties, type ImportOptions, type ImportResult, type InputFile } from "./types";

/** `20231002T143005Z` → `2023-10-02T14:30:05Z`; other text is kept. */
function isoDate(text: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text?.trim() ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : text?.trim() || null;
}

const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-m4a": ".m4a",
  "video/mp4": ".mp4",
  "text/plain": ".txt",
};

const child = (el: Element, name: string) => Array.from(el.children).find((c) => c.localName === name) ?? null;
const childText = (el: Element, name: string) => child(el, name)?.textContent ?? null;

/**
 * Converts `.enex` files into notes under `folder` (a sub-folder per file, named after it, when there are several).
 * Attachments go to `<folder, spaces as ->/_resources/`.
 */
export async function importEnex(files: InputFile[], folder: string, options: ImportOptions = {}): Promise<ImportResult> {
  const result: ImportResult = { notes: [], attachments: [], skipped: [] };
  const taken = Array.from(options.taken ?? []);
  const notePaths = new PathAllocator(taken);
  const filePaths = new PathAllocator(taken);
  const resources = joinPath(folder.replace(/\s+/g, "-"), "_resources");

  for (const file of files) {
    if (!/\.enex$/i.test(file.path)) {
      result.skipped.push({ path: file.path, reason: "unsupported" });
      continue;
    }
    let doc: Document;
    try {
      doc = new DOMParser().parseFromString(await file.text(), "application/xml");
    } catch {
      result.skipped.push({ path: file.path, reason: "unreadable" });
      continue;
    }
    if (doc.getElementsByTagName("parsererror").length > 0 || doc.documentElement.localName !== "en-export") {
      result.skipped.push({ path: file.path, reason: "unreadable" });
      continue;
    }
    const notebook = safeName(file.path.split("/").pop()!.replace(/\.enex$/i, ""));
    const dir = files.length > 1 ? joinPath(folder, notebook) : folder;

    for (const note of Array.from(doc.documentElement.children).filter((c) => c.localName === "note")) {
      const title = safeName(childText(note, "title") ?? "Untitled");
      // The note's attachments by MD5, written as they are met.
      const byHash = new Map<string, { path: string; image: boolean; name: string }>();
      for (const res of Array.from(note.children).filter((c) => c.localName === "resource")) {
        const encoded = childText(res, "data");
        if (!encoded) continue;
        let data: Uint8Array;
        try {
          data = fromBase64(encoded);
        } catch {
          continue;
        }
        const mime = childText(res, "mime")?.trim() ?? "application/octet-stream";
        const attributes = child(res, "resource-attributes");
        const given = attributes ? childText(attributes, "file-name") : null;
        const hash = md5(data);
        const name = attachmentName(given?.trim() || `${title}${EXT[mime] ?? ""}`);
        const path = filePaths.claim(joinPath(resources, name), "-");
        result.attachments.push({ path, data });
        byHash.set(hash, { path, image: mime.startsWith("image/"), name: given?.trim() || name });
      }

      const content = childText(note, "content") ?? "";
      const body = htmlToMarkdown(content.replace(/^\s*<\?xml[^>]*>/, "").replace(/<!DOCTYPE[^>]*>/i, ""), {
        media: (hash) => {
          const found = byHash.get(hash.toLowerCase());
          if (!found) return null;
          const label = found.name.replace(/[[\]]/g, "");
          return found.image ? `![${label}](${found.path})` : `[${label}](${found.path})`;
        },
      });
      const attributes = child(note, "note-attributes");
      const tags = Array.from(note.children)
        .filter((c) => c.localName === "tag")
        .map((t) => t.textContent?.trim() ?? "")
        .filter(Boolean);
      const path = notePaths.claim(joinPath(dir, `${title}.md`));
      result.notes.push({
        path,
        content: withProperties(`${body}\n`, {
          created: isoDate(childText(note, "created")),
          updated: isoDate(childText(note, "updated")),
          tags,
          source: attributes ? childText(attributes, "source-url")?.trim() : null,
        }),
      });
    }
  }
  return result;
}
