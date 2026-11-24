/**
 * Note properties: the YAML front matter at the top of a note (`---` … `---`), read and edited one property at a time.
 *
 * Only the subset notes use is understood: scalars (text, numbers, booleans, dates, quoted or not), inline lists
 * (`[a, b]`) and block lists (`- a` lines under the key). Anything else (nested maps, multi-line strings) is reported
 * as `complex` and never rewritten. Editing one property rewrites only that property's lines; the rest of the block,
 * comments included, stays exactly as written.
 */

export type PropertyType = "text" | "list" | "number" | "checkbox" | "date" | "datetime" | "tags";
export const PROPERTY_TYPES: PropertyType[] = ["text", "list", "number", "checkbox", "date", "datetime", "tags"];

export type PropertyValue = string | number | boolean | string[] | null;

export interface Property {
  key: string;
  /** Parsed value; null for an empty property and for a complex one. */
  value: PropertyValue;
  /** YAML this editor does not edit (nested map, multi-line text): shown read-only, kept as written. */
  complex: boolean;
}

type Segment = { kind: "entry"; key: string; lines: string[] } | { kind: "other"; lines: string[] };

interface Parsed {
  eol: string;
  lines: string[];
  /** Index of the closing `---` line, or -1 when the note has no front matter. */
  close: number;
  segments: Segment[];
  /** Opens with `---` but never closes: not edited at all (a new block in front would make two). */
  unclosed: boolean;
}

const KEY_LINE = /^([^\s#\-][^:]*?):(?:\s+(.*?))?\s*$/;
const LIST_ITEM = /^\s*-(?:\s+(.*?))?\s*$/;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;

function parse(content: string): Parsed {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const none: Parsed = { eol, lines, close: -1, segments: [], unclosed: false };
  if (lines[0]?.replace(/^﻿/, "") !== "---") return none;
  const close = lines.findIndex((l, i) => i > 0 && (l === "---" || l === "..."));
  if (close < 0) return { ...none, unclosed: true };
  const segments: Segment[] = [];
  const body = lines.slice(1, close);
  const continues = (line: string) => /^\s/.test(line) || LIST_ITEM.test(line);
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const key = KEY_LINE.exec(line);
    const last = segments[segments.length - 1];
    if (key) {
      segments.push({ kind: "entry", key: key[1].trim(), lines: [line] });
    } else if (last?.kind === "entry" && line.trim() !== "" && continues(line)) {
      last.lines.push(line);
    } else if (last?.kind === "entry" && line.trim() === "") {
      // A blank line inside a list or a multi-line value belongs to it when the value goes on after it.
      let next = i + 1;
      while (next < body.length && body[next].trim() === "") next++;
      if (next < body.length && continues(body[next]) && !KEY_LINE.test(body[next])) last.lines.push(line);
      else segments.push({ kind: "other", lines: [line] });
    } else if (last?.kind === "other") {
      last.lines.push(line);
    } else {
      segments.push({ kind: "other", lines: [line] });
    }
  }
  return { eol, lines, close, segments, unclosed: false };
}

/** Property names this editor writes as plain YAML keys (no `:`, `#`, brackets, or a leading YAML indicator). */
export function isValidPropertyKey(key: string): boolean {
  const k = key.trim();
  return k !== "" && k === key && !/[:#[\]{},]/.test(k) && !/^[-?!&*|>'"%@`]/.test(k);
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** Items of an inline list body (`a, "b, c", d`), split on commas outside quotes. */
function splitInline(body: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else current += ch;
  }
  items.push(current);
  return items.map((i) => unquote(i.trim())).filter((i) => i !== "");
}

function scalar(raw: string): PropertyValue {
  const quoted = /^(".*"|'.*')$/.test(raw);
  if (quoted) return unquote(raw);
  // An unquoted ` #` starts a comment.
  const text = raw.replace(/\s+#.*$/, "");
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^(null|~)$/i.test(text) || text === "") return null;
  // A number only when writing it back gives the same text: `01234`, `1.10` or a huge id stay text.
  if (NUMBER.test(text) && String(Number(text)) === text) return Number(text);
  return text;
}

function readEntry(entry: Extract<Segment, { kind: "entry" }>): Property {
  const inline = KEY_LINE.exec(entry.lines[0])?.[2] ?? "";
  const rest = entry.lines.slice(1);
  const complex = (): Property => ({ key: entry.key, value: null, complex: true });
  if (inline) {
    if (rest.length > 0 || /^[|>{]/.test(inline)) return complex();
    // `[[Note]]` unquoted is YAML for a nested list: not something to edit as a flat list.
    if (inline.startsWith("[[")) return complex();
    const list = inline.replace(/\]\s+#.*$/, "]");
    if (list.startsWith("[") && list.endsWith("]")) return { key: entry.key, value: splitInline(list.slice(1, -1)), complex: false };
    return { key: entry.key, value: scalar(inline), complex: false };
  }
  if (rest.length === 0) return { key: entry.key, value: null, complex: false };
  const items: string[] = [];
  for (const line of rest) {
    if (line.trim() === "") continue;
    const m = LIST_ITEM.exec(line);
    if (!m) return complex();
    const item = m[1] ?? "";
    if (/^[^"'].*:(\s|$)/.test(item)) return complex(); // a map inside the list
    // A comment after an item, or a nested list, is not something to rewrite as plain text.
    if (/^[^"'].*\s#/.test(item) || item.startsWith("[")) return complex();
    if (item) items.push(unquote(item));
  }
  return { key: entry.key, value: items, complex: false };
}

/** The note's properties in order, and whether it has a front matter block at all. */
export function readProperties(content: string): { properties: Property[]; hasBlock: boolean; unclosed: boolean } {
  const p = parse(content);
  const seen = new Set<string>();
  return {
    hasBlock: p.close >= 0,
    unclosed: p.unclosed,
    properties: p.segments
      .filter((s): s is Extract<Segment, { kind: "entry" }> => s.kind === "entry")
      .map((s) => {
        // A key written twice: edits go to the first; the others are shown read-only.
        const duplicate = seen.has(s.key);
        seen.add(s.key);
        return duplicate ? { key: s.key, value: null, complex: true } : readEntry(s);
      }),
  };
}

/** A string written so YAML reads it back as the same text. */
function quote(s: string): string {
  const risky =
    /^\s|\s$/.test(s) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /: |\s#|:$/.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    NUMBER.test(s) ||
    /[\r\n]/.test(s);
  return risky ? JSON.stringify(s) : s;
}

function entryLines(key: string, value: PropertyValue): string[] {
  if (value === null || value === "") return [`${key}:`];
  if (Array.isArray(value)) return value.length === 0 ? [`${key}: []`] : [`${key}:`, ...value.map((v) => `  - ${quote(v)}`)];
  if (typeof value === "string") return [`${key}: ${quote(value)}`];
  return [`${key}: ${String(value)}`];
}

function rebuild(p: Parsed, segments: Segment[]): string {
  const block = segments.flatMap((s) => s.lines);
  return [p.lines[0], ...block, ...p.lines.slice(p.close)].join(p.eol);
}

/** `content` with property `key` set to `value` (added at the end of the block, or in a new block, if missing). */
export function writeProperty(content: string, key: string, value: PropertyValue): string {
  const p = parse(content);
  if (p.unclosed || !isValidPropertyKey(key)) return content;
  const lines = entryLines(key, value);
  if (p.close < 0) {
    const bom = content.startsWith("﻿") ? "﻿" : "";
    return `${bom}---${p.eol}${lines.join(p.eol)}${p.eol}---${p.eol}${content.slice(bom.length)}`;
  }
  const index = p.segments.findIndex((s) => s.kind === "entry" && s.key === key);
  const segments = [...p.segments];
  if (index >= 0) segments[index] = { kind: "entry", key, lines };
  else segments.push({ kind: "entry", key, lines });
  return rebuild(p, segments);
}

/** `content` without property `key` (all its lines). */
export function deleteProperty(content: string, key: string): string {
  const p = parse(content);
  const index = p.segments.findIndex((s) => s.kind === "entry" && s.key === key);
  if (p.close < 0 || index < 0) return content;
  return rebuild(p, p.segments.filter((_, i) => i !== index));
}

/**
 * `value` (of type `from`) as type `to`, only when nothing is lost: converting back gives the same value
 * (`"a, b"` ⇄ `[a, b]`, `3` ⇄ `"3"`). Null when the conversion would change or drop anything.
 */
export function convertLossless(from: PropertyType, to: PropertyType, value: PropertyValue): PropertyValue | null {
  if (value === null) return null;
  const asInput = (v: PropertyValue): string | string[] | boolean =>
    Array.isArray(v) ? v : typeof v === "boolean" ? v : v === null ? "" : String(v);
  const converted = coerceValue(to, asInput(value));
  if (converted === null) return null;
  const back = coerceValue(from, asInput(converted));
  return JSON.stringify(back) === JSON.stringify(value) ? converted : null;
}

/** `content` with property `oldKey` named `newKey`, value lines kept; unchanged when `newKey` already exists. */
export function renamePropertyKey(content: string, oldKey: string, newKey: string): string {
  const p = parse(content);
  const index = p.segments.findIndex((s) => s.kind === "entry" && s.key === oldKey);
  if (index < 0 || !isValidPropertyKey(newKey) || p.segments.some((s) => s.kind === "entry" && s.key === newKey)) return content;
  const entry = p.segments[index];
  const first = entry.lines[0];
  const segments = [...p.segments];
  segments[index] = { kind: "entry", key: newKey, lines: [newKey + first.slice(first.indexOf(":")), ...entry.lines.slice(1)] };
  return rebuild(p, segments);
}

/** The front matter block as written (delimiters included), or "" when the note has none. */
export function frontmatterBlock(content: string): string {
  const p = parse(content);
  return p.close < 0 ? "" : p.lines.slice(0, p.close + 1).join(p.eol);
}

/** Types set for property names across a vault (`propertyTypes` in the vault settings). */
export type PropertyTypes = Record<string, PropertyType>;

/** A property's type: `tags` is always tags; else the vault's type for the name, else what the value looks like. */
export function propertyTypeOf(key: string, value: PropertyValue, types: PropertyTypes): PropertyType {
  if (key === "tags") return "tags";
  const set = types[key];
  return set && set !== "tags" ? set : inferPropertyType(key, value);
}

export interface VaultProperty {
  key: string;
  /** Notes that have it. */
  count: number;
  type: PropertyType;
}

/**
 * Every property name used in the vault, with how many notes have it and its type (the vault's, else the type most
 * of its values look like), most used first. `notes` are note texts or just their front matter.
 */
export function collectVaultProperties(notes: string[], types: PropertyTypes): VaultProperty[] {
  const seen = new Map<string, { count: number; inferred: Map<PropertyType, number> }>();
  for (const text of notes) {
    for (const p of readProperties(text).properties) {
      const entry = seen.get(p.key) ?? { count: 0, inferred: new Map() };
      entry.count++;
      if (!p.complex && p.value !== null) {
        const t = inferPropertyType(p.key, p.value);
        entry.inferred.set(t, (entry.inferred.get(t) ?? 0) + 1);
      }
      seen.set(p.key, entry);
    }
  }
  return Array.from(seen, ([key, { count, inferred }]) => {
    const common = [...inferred].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "text";
    return { key, count, type: key === "tags" ? "tags" : types[key] ?? common };
  }).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** The type a value looks like (used when a property name has no type set for the vault). */
export function inferPropertyType(key: string, value: PropertyValue): PropertyType {
  if (key === "tags") return "tags";
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string" && DATE.test(value)) return "date";
  if (typeof value === "string" && DATETIME.test(value)) return "datetime";
  return "text";
}

/** Input from an editor control, as the value a property of `type` stores. */
export function coerceValue(type: PropertyType, input: string | string[] | boolean): PropertyValue {
  const list = (v: string | string[] | boolean) =>
    (Array.isArray(v) ? v : String(v).split(",")).map((s) => s.trim()).filter(Boolean);
  switch (type) {
    case "list":
      return list(input);
    case "tags":
      return list(input).map((s) => s.replace(/^#/, ""));
    case "number": {
      const text = Array.isArray(input) ? input[0] ?? "" : String(input).trim();
      if (text === "") return null;
      const n = Number(text);
      return Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return input === true || String(input).toLowerCase() === "true";
    default:
      return Array.isArray(input) ? input.join(", ") : typeof input === "boolean" ? String(input) : input;
  }
}
