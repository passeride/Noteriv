/**
 * Notion export ("Markdown & CSV", the zip Notion's Export gives). Pages are `.md` files named `Title <32-hex id>`,
 * sub-pages in a folder of the same name, databases a `.csv` (plus `_all.csv` in newer exports) beside a folder of
 * one page per row. This turns them into notes without the ids, links between pages into wiki-links, files into
 * attachments, and each database into a folder of notes whose properties come from the CSV, plus a note showing them
 * in a ```view table.
 */

import {
  attachmentName,
  dirOf,
  fileOf,
  joinPath,
  MARKDOWN_LINK,
  PathAllocator,
  propertyKey,
  resolvePath,
  safeName,
  wikiLink,
  withProperties,
  type ImportOptions,
  type ImportResult,
  type InputFile,
} from "./types";

/** `Name 0123…cdef` → `Name` (also `Name 0123…cdef.md`). */
const ID_SUFFIX = /\s+([0-9a-f]{32})(?=(\.[a-z0-9]+)?$)/i;
const NOTION_URL_ID = /notion\.so\/\S*?([0-9a-f]{32})(?:[?#)\s]|$)/i;

function idOf(path: string): string | null {
  return ID_SUFFIX.exec(fileOf(path))?.[1]?.toLowerCase() ?? null;
}

/** The export's folders and file names without ids, safe for every platform (the extension too). */
function cleanSegments(path: string): string[] {
  const parts = path.split("/");
  return parts.map((seg, i) => {
    if (i < parts.length - 1) return safeName(seg.replace(ID_SUFFIX, ""));
    const dot = seg.lastIndexOf(".");
    const [base, ext] = dot > 0 ? [seg.slice(0, dot), seg.slice(dot)] : [seg, ""];
    return safeName(base.replace(ID_SUFFIX, "")) + ext.toLowerCase().replace(/[^.a-z0-9]/g, "");
  });
}

/** Rows of a CSV text (RFC 4180: quoted fields, "" inside quotes, line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** A CSV value as a property: lists for multi-select style columns (`Tags`), Yes/No as true/false, else text. */
function propertyValue(column: string, value: string): string | boolean | string[] | null {
  const v = value.trim();
  if (!v) return null;
  if (/^(tags?|labels?)$/i.test(column)) return v.split(/,\s*/).filter(Boolean);
  if (/^(yes|no)$/i.test(v)) return v.toLowerCase() === "yes";
  return v;
}

interface Database {
  /** Export path of the CSV. */
  csv: string;
  /** Export folder holding its row pages. */
  folder: string;
  header: string[];
  /** Rows by title (first column); several when titles repeat. */
  rows: Map<string, string[][]>;
}

/** Converts the files of a Notion export into notes under `folder`; attachments go to `<folder, spaces as ->/_resources/`. */
export async function importNotion(files: InputFile[], folder: string, options: ImportOptions = {}): Promise<ImportResult> {
  const result: ImportResult = { notes: [], attachments: [], skipped: [] };
  const taken = Array.from(options.taken ?? []);
  const notePaths = new PathAllocator(taken);
  const filePaths = new PathAllocator(taken);
  /** Database notes go after the pages, so the first note is a page. */
  const indexNotes: ImportResult["notes"] = [];
  const resources = joinPath(folder.replace(/\s+/g, "-"), "_resources");

  const pages = files.filter((f) => /\.md$/i.test(f.path));
  const csvs = files.filter((f) => /\.csv$/i.test(f.path));
  const others = files.filter((f) => !/\.(md|csv)$/i.test(f.path));

  // Where each page goes, by export path and by Notion id (links use either).
  const pageByPath = new Map<string, string>();
  const pageById = new Map<string, string>();
  for (const page of pages) {
    const path = notePaths.claim(joinPath(folder, ...cleanSegments(page.path)));
    pageByPath.set(page.path.toLowerCase(), path);
    const id = idOf(page.path);
    if (id) pageById.set(id, path);
  }

  // Attachments, flat in _resources.
  const fileByPath = new Map<string, string>();
  for (const f of others) {
    let data: Uint8Array;
    try {
      data = await f.bytes();
    } catch {
      result.skipped.push({ path: f.path, reason: "unreadable" });
      continue;
    }
    const path = filePaths.claim(joinPath(resources, attachmentName(fileOf(cleanSegments(f.path).join("/")))), "-");
    fileByPath.set(f.path.toLowerCase(), path);
    result.attachments.push({ path, data });
  }

  // Databases: `X <id>_all.csv` (all rows) wins over `X <id>.csv` (the current view's rows).
  const databases: Database[] = [];
  const csvByBase = new Map<string, InputFile>();
  for (const c of csvs) {
    const base = c.path.replace(/(_all)?\.csv$/i, "");
    if (!csvByBase.has(base) || /_all\.csv$/i.test(c.path)) csvByBase.set(base, c);
  }
  const indexByCsv = new Map<string, string>();
  for (const [base, c] of csvByBase) {
    let rows: string[][];
    try {
      rows = parseCsv(await c.text());
    } catch {
      result.skipped.push({ path: c.path, reason: "unreadable" });
      continue;
    }
    if (rows.length === 0) {
      result.skipped.push({ path: c.path, reason: "empty" });
      continue;
    }
    const [header, ...body] = rows;
    const db: Database = { csv: c.path, folder: base, header: header.map((h) => h.trim()), rows: new Map() };
    for (const r of body) {
      const title = (r[0] ?? "").trim();
      db.rows.set(title, [...(db.rows.get(title) ?? []), r]);
    }
    databases.push(db);
    // The database's own note, beside its folder: a table of its rows.
    const rowsFolder = joinPath(folder, ...cleanSegments(base));
    const index = notePaths.claim(`${rowsFolder}.md`);
    for (const p of [c.path, `${base}.csv`, `${base}_all.csv`]) indexByCsv.set(p.toLowerCase(), index);
    // The same names the notes' properties get.
    const columns = [...new Set(["file", ...db.header.slice(1).map(propertyKey)])];
    indexNotes.push({
      path: index,
      content: `\`\`\`view\nfrom: "${rowsFolder.replace(/"/g, "")}"\nlayout: table\ncolumns: [${columns.join(", ")}]\nsort: file.name\n\`\`\`\n`,
    });
  }

  for (const page of pages) {
    let text: string;
    try {
      text = (await page.text()).replace(/\r\n/g, "\n");
    } catch {
      result.skipped.push({ path: page.path, reason: "unreadable" });
      continue;
    }
    const path = pageByPath.get(page.path.toLowerCase())!;
    const dir = dirOf(page.path);

    // A database row: its properties, from the "Name: value" lines Notion writes under the title (they are the page's
    // own, even when titles repeat), else from its CSV row when its title is the only one; the lines are removed.
    let props: Record<string, string | boolean | string[] | null> = {};
    const db = databases.find((d) => d.folder.toLowerCase() === dir.toLowerCase());
    if (db) {
      const lines = text.split("\n");
      const title = /^#\s+(.*)$/.exec(lines[0] ?? "")?.[1]?.trim() ?? fileOf(path).replace(/\.md$/i, "");
      let end = lines[0]?.startsWith("# ") ? 1 : 0;
      while (end < lines.length && lines[end].trim() === "") end++;
      const start = end;
      const columns = new Map(db.header.slice(1).map((h) => [h.toLowerCase(), h]));
      const written: Record<string, string> = {};
      for (let m: RegExpExecArray | null; end < lines.length && (m = /^([^:]+):\s(.*)$/.exec(lines[end])) && columns.has(m[1].trim().toLowerCase()); end++) {
        written[columns.get(m[1].trim().toLowerCase())!] = m[2];
      }
      const rows = db.rows.get(title) ?? [];
      if (end > start) {
        props = Object.fromEntries(Object.entries(written).map(([h, v]) => [h, propertyValue(h, v)]));
        while (end < lines.length && lines[end].trim() === "") end++;
        text = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
      } else if (rows.length === 1) {
        props = Object.fromEntries(db.header.slice(1).map((h, i) => [h, propertyValue(h, rows[0][i + 1] ?? "")]));
      }
    }

    const body = text.replace(MARKDOWN_LINK, (whole, bang: string, label: string, target: string) => {
      const notionId = NOTION_URL_ID.exec(target)?.[1]?.toLowerCase();
      if (notionId && pageById.has(notionId)) return wikiLink(pageById.get(notionId)!, label);
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return whole;
      const resolved = resolvePath(dir, target.split("#")[0]).toLowerCase();
      const note = pageByPath.get(resolved) ?? indexByCsv.get(resolved);
      if (note) return wikiLink(note, label);
      const file = fileByPath.get(resolved);
      if (file) return `${bang}[${label}](${file})`;
      return whole;
    });
    result.notes.push({ path, content: withProperties(body, props) });
  }
  result.notes.push(...indexNotes);
  return result;
}
