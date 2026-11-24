/**
 * Views over note properties: the ```view block. Its text is YAML-like settings (read with the properties parser):
 *
 *   from: Projects            # folders and/or #tags (any of them); empty: the whole vault
 *   where: status != done     # one condition, or a list of them (all must hold)
 *   layout: table             # table | cards | list | kanban
 *   columns: [file, status, due]
 *   sort: due asc             # one, or a list; asc by default
 *   group: status             # required for kanban
 *   limit: 50
 *
 * Conditions are `<field> <op> <value>` with = != > >= < <= contains !contains, or `<field> exists` / `!exists`.
 * Fields are property names plus file.name, file.path, file.folder, file.created, file.modified (`file` is the name).
 *
 * The same settings can also be a file of their own: `Name.view` on desktop, or a note whose front matter has
 * `view: true` on web (the settings follow the front matter).
 */

import { frontmatterBlock, readProperties, type PropertyValue } from "./properties";

export type ViewLayout = "table" | "cards" | "list" | "kanban";
export const VIEW_LAYOUTS: ViewLayout[] = ["table", "cards", "list", "kanban"];

export type ConditionOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "!contains" | "exists" | "!exists";

export interface Condition {
  field: string;
  op: ConditionOp;
  value: PropertyValue;
}

export interface ViewSpec {
  from: string[];
  where: Condition[];
  layout: ViewLayout;
  columns: string[];
  sort: { field: string; desc: boolean }[];
  group: string | null;
  limit: number | null;
}

export interface ViewNote {
  /** Vault-relative path with extension. */
  path: string;
  properties: Record<string, PropertyValue>;
  /** Milliseconds since epoch; 0 when unknown. */
  created: number;
  modified: number;
}

export interface ViewResult {
  /** One group (key null) when the view is not grouped; groups in value order, notes without the value last. */
  groups: { key: string | null; rows: ViewNote[] }[];
  /** Notes shown (after the limit). */
  total: number;
}

// Field names may be any letters (`trạng_thái`), digits, `_`, `.`, `-` and spaces.
const CONDITION = /^\s*([\p{L}\p{N}_.\- ]+?)\s+(=|!=|>=|<=|>|<|!contains|contains)\s+(.+?)\s*$/u;
const EXISTS = /^\s*([\p{L}\p{N}_.\- ]+?)\s+(!?exists)\s*$/u;

function asList(v: PropertyValue): string[] {
  if (v === null) return [];
  return Array.isArray(v) ? v : [String(v)];
}

function literal(raw: string): PropertyValue {
  const t = raw.trim();
  if (/^(".*"|'.*')$/.test(t)) return t.slice(1, -1);
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

/** The view's settings, or which setting is wrong (`layout`, `where`, `group`, `limit`). */
export function parseViewSpec(text: string): { spec: ViewSpec; error?: undefined } | { error: string; spec?: undefined } {
  const props = Object.fromEntries(readProperties(`---\n${text.replace(/\r\n/g, "\n").trim()}\n---\n`).properties.map((p) => [p.key, p.value]));
  const layout = String(props.layout ?? "table").trim().toLowerCase() as ViewLayout;
  if (!VIEW_LAYOUTS.includes(layout)) return { error: "layout" };

  const where: Condition[] = [];
  for (const c of asList(props.where ?? null)) {
    const exists = EXISTS.exec(c);
    if (exists) {
      where.push({ field: exists[1].trim(), op: exists[2] as ConditionOp, value: null });
      continue;
    }
    const m = CONDITION.exec(c);
    if (!m || /[<>=!]/.test(m[3].charAt(0))) return { error: "where" };
    where.push({ field: m[1].trim(), op: m[2] as ConditionOp, value: literal(m[3]) });
  }

  const sort = asList(props.sort ?? null).map((s) => {
    const parts = s.trim().split(/\s+/);
    const desc = /^desc$/i.test(parts[parts.length - 1]);
    const field = (/^(asc|desc)$/i.test(parts[parts.length - 1]) ? parts.slice(0, -1) : parts).join(" ").replace(/^-/, "");
    return { field, desc: desc || s.trim().startsWith("-") };
  });

  const group = props.group != null && String(props.group).trim() ? String(props.group).trim() : null;
  if (layout === "kanban" && !group) return { error: "group" };
  const limit = props.limit == null ? null : Number(props.limit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) return { error: "limit" };
  const columns = asList(props.columns ?? null).map((c) => c.trim()).filter(Boolean);

  return {
    spec: {
      from: asList(props.from ?? null).map((f) => f.trim()).filter(Boolean),
      where,
      layout,
      columns: columns.length > 0 ? columns : ["file"],
      sort,
      group,
      limit,
    },
  };
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

/** A field of a note: a property, or one of the `file.*` fields. */
export function fieldValue(note: ViewNote, field: string): PropertyValue {
  switch (field) {
    case "file":
    case "file.name":
      return nameOf(note.path);
    case "file.path":
      return note.path;
    case "file.folder":
      return note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : "";
    case "file.created":
      return note.created ? new Date(note.created).toISOString().slice(0, 16).replace("T", " ") : null;
    case "file.modified":
      return note.modified ? new Date(note.modified).toISOString().slice(0, 16).replace("T", " ") : null;
    default:
      return note.properties[field] ?? null;
  }
}

/** Text for a cell: lists joined with commas, empty for a missing value. */
export function formatCell(note: ViewNote, field: string): string {
  return asList(fieldValue(note, field)).join(", ");
}

/** No value: missing, empty text or an empty list. */
const missing = (v: PropertyValue) => v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Order of two values: numbers as numbers, everything else as text (ISO dates sort right); missing last. */
function compare(a: PropertyValue, b: PropertyValue): number {
  if (missing(a)) return missing(b) ? 0 : 1;
  if (missing(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return asList(a).join(", ").localeCompare(asList(b).join(", "), undefined, { numeric: true, sensitivity: "base" });
}

function holds(note: ViewNote, c: Condition): boolean {
  const v = fieldValue(note, c.field);
  const present = !missing(v);
  if (c.op === "exists") return present;
  if (c.op === "!exists") return !present;
  if (c.op === "contains" || c.op === "!contains") {
    const needle = String(c.value).toLowerCase().replace(/^#/, "");
    // A list item matches itself or, for nested tags, its children (`project` matches `project/a`).
    const found = Array.isArray(v)
      ? v.some((i) => i.toLowerCase() === needle || i.toLowerCase().startsWith(`${needle}/`))
      : String(v ?? "").toLowerCase().includes(needle);
    return c.op === "contains" ? found : !found;
  }
  if (c.op === "=" || c.op === "!=") {
    // A note without the field never equals a value (`priority = 0` does not pick notes with no priority).
    const equal =
      present &&
      (Array.isArray(v)
        ? v.some((i) => i.toLowerCase() === String(c.value).toLowerCase())
        : typeof v === "number" || typeof c.value === "number"
          ? Number(v) === Number(c.value)
          : String(v).toLowerCase() === String(c.value ?? "").toLowerCase());
    return c.op === "=" ? equal : !equal;
  }
  if (!present) return false;
  const order = compare(v, c.value);
  return c.op === ">" ? order > 0 : c.op === ">=" ? order >= 0 : c.op === "<" ? order < 0 : order <= 0;
}

function inSource(note: ViewNote, from: string[]): boolean {
  if (from.length === 0) return true;
  return from.some((f) => {
    if (f.startsWith("#")) {
      const tag = f.slice(1).toLowerCase();
      return asList(note.properties.tags ?? null).some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`));
    }
    const folder = f.replace(/^\/+|\/+$/g, "").toLowerCase();
    return folder === "" || note.path.toLowerCase().startsWith(`${folder}/`);
  });
}

/** The notes a view shows, filtered, sorted, limited and grouped. */
export function runView(spec: ViewSpec, notes: ViewNote[]): ViewResult {
  let rows = notes.filter((n) => inSource(n, spec.from) && spec.where.every((c) => holds(n, c)));
  rows.sort((a, b) => {
    for (const s of spec.sort) {
      const va = fieldValue(a, s.field);
      const vb = fieldValue(b, s.field);
      const d = compare(va, vb);
      // Descending reverses values only: notes without one stay last.
      if (d !== 0) return s.desc && !missing(va) && !missing(vb) ? -d : d;
    }
    return a.path.localeCompare(b.path);
  });
  if (spec.limit !== null) rows = rows.slice(0, spec.limit);
  if (!spec.group) return { groups: [{ key: null, rows }], total: rows.length };

  const groups = new Map<string | null, ViewNote[]>();
  for (const n of rows) {
    const key = asList(fieldValue(n, spec.group))[0] ?? null;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  return { groups: keys.map((key) => ({ key, rows: groups.get(key)! })), total: rows.length };
}

/** Extension of a view file on desktop. */
export const VIEW_FILE_EXT = ".view";

/** Settings of a new view file. */
export const VIEW_FILE_TEMPLATE = "from: \nwhere: \nlayout: table\ncolumns: [file, status, tags]\nsort: file.name\n";

/** How far into a note a `view: true` line is looked for before parsing the front matter (match runs on every render). */
const MARKER_SCAN = 4096;
const MARKER_LINE = /^view:\s*true\b/im;

/** Whether a note's front matter marks it as a view file (`view: true`, the web form). */
export function isViewNote(content: string): boolean {
  // Cheap checks first: most notes have no front matter, or no such line near the top.
  if (!/^﻿?---\r?\n/.test(content) || !MARKER_LINE.test(content.slice(0, MARKER_SCAN))) return false;
  return readProperties(frontmatterBlock(content)).properties.some((p) => p.key === "view" && p.value === true);
}

/** Whether a file is a view file: `.view` (desktop) or a note marked `view: true` (web). */
export function isViewFile(file: { path: string; content: string }): boolean {
  return file.path.toLowerCase().endsWith(VIEW_FILE_EXT) || isViewNote(file.content);
}

/**
 * A view file's front matter with the line break after it, and its settings text. A `.view` file has none, but one
 * given front matter anyway keeps it apart from the settings too.
 */
function splitViewFile(content: string): { head: string; settings: string } {
  const block = frontmatterBlock(content);
  if (!block) return { head: "", settings: content };
  const rest = content.slice(block.length);
  const eol = /^\r?\n/.exec(rest)?.[0] ?? "";
  return { head: block + eol, settings: rest.slice(eol.length) };
}

/** The settings text of a view file, as a ```view block would hold it. */
export function viewFileSettings(content: string): string {
  return splitViewFile(content).settings;
}

/** Settings lines `key: …` (top level). The last one counts, as when the settings are read. */
const settingLine = (key: string) => new RegExp(`^${key}:.*$`, "gm");

/**
 * A view file with its `layout` setting changed (added when missing); everything else is kept. Kanban needs a `group`:
 * when there is none, the first column that is a property is used (else `status`).
 */
export function setViewLayout(content: string, layout: ViewLayout): string {
  const { head, settings } = splitViewFile(content);
  const eol = settings.includes("\r\n") ? "\r\n" : "\n";
  const add = (text: string, line: string) => text + (text === "" || text.endsWith("\n") ? "" : eol) + line + eol;
  let next = settingLine("layout").test(settings) ? settings.replace(settingLine("layout"), `layout: ${layout}`) : add(settings, `layout: ${layout}`);
  if (layout === "kanban") {
    const group = readProperties(`---\n${next.replace(/\r\n/g, "\n")}\n---\n`).properties.find((p) => p.key === "group")?.value;
    if (group == null || String(group).trim() === "") {
      const parsed = parseViewSpec(next.replace(settingLine("layout"), "layout: table"));
      const column = parsed.spec?.columns.find((c) => c !== "file" && !c.startsWith("file.")) ?? "status";
      next = settingLine("group").test(next) ? next.replace(settingLine("group"), `group: ${column}`) : add(next, `group: ${column}`);
    }
  }
  return head + next;
}
