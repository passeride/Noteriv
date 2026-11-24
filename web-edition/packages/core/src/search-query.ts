/**
 * Search with operators (the vault search box): words (all must match), "exact phrases", OR, -negation, (groups),
 * /regex/, file:, path:, content:, tag:, line:(…), match-case:, ignore-case:, [property], [property:value],
 * [property:null]. Case-insensitive unless match-case:. A plain word matches the note's text or its file name.
 */

import { frontmatterBlock, readProperties, type PropertyValue } from "./properties";

type Field = "any" | "content" | "file" | "path" | "tag";

export type SearchNode =
  | { kind: "and"; items: SearchNode[] }
  | { kind: "or"; items: SearchNode[] }
  | { kind: "not"; item: SearchNode }
  | { kind: "line"; item: SearchNode }
  | { kind: "prop"; name: string; value: string | null | undefined }
  | { kind: "term"; field: Field; text: string | null; regex: { source: string; flags: string } | null; caseSensitive: boolean };

type Term = Extract<SearchNode, { kind: "term" }>;

export interface SearchableNote {
  /** Vault-relative path with extension. */
  path: string;
  content: string;
}

const OPS = new Set(["file", "path", "content", "tag", "line", "match-case", "ignore-case"]);

class ParseError extends Error {}

/** The query as a tree, or what is wrong with it (`quote`, `regex`, `paren`, `bracket`, `operator`). */
export function parseSearch(input: string): { query: SearchNode } | { error: string } {
  let i = 0;
  const s = input;
  const fail = (what: string): never => {
    throw new ParseError(what);
  };
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };

  const readQuoted = (): string => {
    i++; // opening quote
    let out = "";
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\" && s[i + 1] === '"') i++;
      out += s[i++];
    }
    if (i >= s.length) fail("quote");
    i++;
    return out;
  };

  /**
   * A /regex/ starting at `i`, or null when the slash does not open one (`/usr/bin` is a path: the closing slash must
   * be followed by flags and then a space, a parenthesis or the end). A `/` inside `[...]` does not close it.
   */
  const tryRegex = (): { source: string; flags: string } | null => {
    let j = i + 1;
    let source = "";
    let inClass = false;
    while (j < s.length && (s[j] !== "/" || inClass)) {
      if (s[j] === "\\" && j + 1 < s.length) source += s[j++];
      else if (s[j] === "[") inClass = true;
      else if (s[j] === "]") inClass = false;
      source += s[j++];
    }
    if (j >= s.length) return null;
    j++;
    let flags = "";
    while (j < s.length && /[gimsuy]/.test(s[j])) flags += s[j++];
    if (j < s.length && !/[\s)]/.test(s[j])) return null;
    i = j;
    try {
      new RegExp(source, flags.replace("g", ""));
    } catch {
      fail("regex");
    }
    return { source, flags: flags.replace(/[gi]/g, "") };
  };
  const readRegex = (): { source: string; flags: string } => {
    const re = tryRegex();
    if (!re) fail("regex");
    return re!;
  };

  const readWord = (): string => {
    let out = "";
    while (i < s.length && !/[\s()]/.test(s[i])) out += s[i++];
    return out;
  };

  const term = (field: Field, text: string | null, regex: Term["regex"] = null): Term => ({ kind: "term", field, text, regex, caseSensitive: false });

  /** A value after an operator or alone: "phrase", /regex/ or a word. */
  const value = (field: Field): Term => {
    if (s[i] === '"') return term(field, readQuoted());
    if (s[i] === "/") {
      const re = tryRegex();
      if (re) return term(field, null, re);
    }
    const w = readWord();
    if (!w) fail("operator");
    return term(field, w);
  };

  const withCase = (node: SearchNode, caseSensitive: boolean): SearchNode => {
    if (node.kind === "term") return { ...node, caseSensitive };
    if (node.kind === "and" || node.kind === "or") return { ...node, items: node.items.map((n) => withCase(n, caseSensitive)) };
    if (node.kind === "not" || node.kind === "line") return { ...node, item: withCase(node.item, caseSensitive) };
    return node;
  };

  function primary(): SearchNode {
    ws();
    const c = s[i];
    if (c === "(") {
      i++;
      const inner = expr();
      ws();
      if (s[i] !== ")") fail("paren");
      i++;
      return inner;
    }
    if (c === '"') return term("any", readQuoted());
    if (c === "/") {
      const re = tryRegex();
      if (re) return term("any", null, re);
      return term("any", readWord()); // a path such as /usr/bin, searched as text
    }
    if (c === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) fail("bracket");
      const body = s.slice(i + 1, end);
      i = end + 1;
      const colon = body.indexOf(":");
      const name = (colon < 0 ? body : body.slice(0, colon)).trim();
      if (!name) fail("bracket");
      if (colon < 0) return { kind: "prop", name, value: undefined };
      const raw = body.slice(colon + 1).trim().replace(/^"(.*)"$/, "$1");
      return { kind: "prop", name, value: raw === "null" ? null : raw };
    }
    const start = i;
    const op = /^([a-z-]+):/.exec(s.slice(i));
    if (op && OPS.has(op[1])) {
      i += op[0].length;
      const name = op[1];
      if (name === "line") return { kind: "line", item: s[i] === "(" ? primary() : value("content") };
      if (name === "match-case" || name === "ignore-case") return withCase(s[i] === "(" ? primary() : value("any"), name === "match-case");
      return value(name as Field);
    }
    i = start;
    const w = readWord();
    if (!w) fail("paren");
    return term("any", w);
  }

  function unary(): SearchNode {
    ws();
    if (s[i] === "-" && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      i++;
      return { kind: "not", item: primary() };
    }
    return primary();
  }

  function and(): SearchNode {
    const items: SearchNode[] = [];
    for (;;) {
      ws();
      if (i >= s.length || s[i] === ")" || /^OR(\s|$)/.test(s.slice(i))) break;
      items.push(unary());
    }
    // Nothing between ORs or parentheses (`a OR`, `()`) would match every note: report it instead.
    if (items.length === 0) fail("operator");
    return items.length === 1 ? items[0] : { kind: "and", items };
  }

  function expr(): SearchNode {
    const items = [and()];
    for (;;) {
      ws();
      if (!/^OR(\s|$)/.test(s.slice(i))) break;
      i += 2;
      items.push(and());
    }
    return items.length === 1 ? items[0] : { kind: "or", items };
  }

  try {
    const query = expr();
    ws();
    if (i < s.length) fail("paren");
    return { query };
  } catch (e) {
    if (e instanceof ParseError) return { error: e.message };
    throw e;
  }
}

/** A query of plain words only: the backend's ranked full-text search answers it. */
export function isPlainQuery(input: string): boolean {
  const words = input.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => w !== "OR" && !w.startsWith("-") && !/["()/[\]:]/.test(w));
}

interface Context {
  name: string;
  path: string;
  content: string;
  tags: string[];
  properties: Map<string, PropertyValue>;
}

function context(note: SearchableNote): Context {
  const { properties } = readProperties(note.content);
  const props = new Map(properties.filter((p) => !p.complex).map((p) => [p.key.toLowerCase(), p.value]));
  const tags = new Set<string>();
  const fm = props.get("tags");
  for (const t of Array.isArray(fm) ? fm : typeof fm === "string" ? fm.split(",") : []) if (t.trim()) tags.add(t.trim().replace(/^#/, "").toLowerCase());
  for (const m of note.content.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.add(m[1].toLowerCase());
  return { name: note.path.slice(note.path.lastIndexOf("/") + 1), path: note.path, content: note.content, tags: [...tags], properties: props };
}

/** Each term's RegExp, built once (a search tests it against every line of every note). */
const compiled = new WeakMap<Term, RegExp>();

function regexOf(t: Term): RegExp {
  let re = compiled.get(t);
  if (!re) {
    re = t.regex
      ? new RegExp(t.regex.source, t.regex.flags + (t.caseSensitive ? "" : "i"))
      : new RegExp((t.text ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u" + (t.caseSensitive ? "" : "i"));
    compiled.set(t, re);
  }
  return re;
}

function test(t: Term, haystack: string): boolean {
  return regexOf(t).test(haystack);
}

function evaluate(node: SearchNode, ctx: Context): boolean {
  switch (node.kind) {
    case "and":
      return node.items.every((n) => evaluate(n, ctx));
    case "or":
      return node.items.some((n) => evaluate(n, ctx));
    case "not":
      return !evaluate(node.item, ctx);
    case "line":
      return ctx.content.split("\n").some((line) => evaluate(node.item, { ...ctx, content: line, name: "" }));
    case "prop": {
      const v = ctx.properties.get(node.name.toLowerCase());
      if (!ctx.properties.has(node.name.toLowerCase())) return false;
      if (node.value === undefined) return true;
      if (node.value === null) return v === null || v === "" || (Array.isArray(v) && v.length === 0);
      const wanted = node.value.toLowerCase();
      return (Array.isArray(v) ? v : [String(v ?? "")]).some((x) => x.toLowerCase() === wanted);
    }
    case "term":
      switch (node.field) {
        case "any":
          return test(node, ctx.content) || (ctx.name !== "" && test(node, ctx.name.replace(/\.md$/i, "")));
        case "content":
          return test(node, ctx.content);
        case "file":
          return test(node, ctx.name);
        case "path":
          return test(node, ctx.path);
        case "tag": {
          if (node.regex) return ctx.tags.some((tag) => test(node, tag));
          const tag = (node.text ?? "").replace(/^#/, "").toLowerCase();
          return ctx.tags.includes(tag);
        }
      }
  }
}

/** Terms that, matching a line, mark it as a result line (positive text terms, not under a negation). */
function lineTerms(node: SearchNode, negated = false): Term[] {
  switch (node.kind) {
    case "and":
    case "or":
      return node.items.flatMap((n) => lineTerms(n, negated));
    case "not":
      return lineTerms(node.item, !negated);
    case "line":
      return lineTerms(node.item, negated);
    case "term":
      return !negated && (node.field === "any" || node.field === "content") ? [node] : [];
    default:
      return [];
  }
}

/** Whether the note matches, and its lines that contain what was searched for (at most 5, 1-based). */
export function matchNote(query: SearchNode, note: SearchableNote): { matches: boolean; lines: { line: number; text: string }[] } {
  const ctx = context(note);
  if (!evaluate(query, ctx)) return { matches: false, lines: [] };
  const terms = lineTerms(query);
  const lines: { line: number; text: string }[] = [];
  if (terms.length > 0) {
    note.content.split("\n").forEach((text, i) => {
      if (lines.length < 5 && terms.some((t) => test(t, text))) lines.push({ line: i + 1, text: text.trim().slice(0, 200) });
    });
  }
  return { matches: true, lines };
}

/**
 * Text of which every matching note contains at least one (any case): the server can pick candidates with it. Null when
 * nothing narrows the search (only file names, paths, regexes or negations): then every note is a candidate.
 */
export function prefilterTerms(node: SearchNode): string[] | null {
  switch (node.kind) {
    case "term":
      // A plain word may match only the file name: the server checks names as well as text. Very long text is not
      // sent (the server takes terms up to 255 characters).
      if (node.regex || node.field === "file" || node.field === "path" || !node.text || node.text.length > 200) return null;
      return [node.field === "tag" ? node.text.replace(/^#/, "") : node.text];
    case "prop":
      return [node.name];
    case "line":
      return prefilterTerms(node.item);
    case "not":
      return null;
    case "and": {
      // Any one requirement is enough; the one with the fewest alternatives narrows most.
      const options = node.items.map(prefilterTerms).filter((t): t is string[] => t !== null);
      return options.sort((a, b) => a.length - b.length || b[0].length - a[0].length)[0] ?? null;
    }
    case "or": {
      const all = node.items.map(prefilterTerms);
      return all.every((t) => t !== null) ? [...new Set(all.flat() as string[])] : null;
    }
  }
}

/**
 * What "replace" changes: the one text or regex searched for in the notes' text. Other parts may only filter which notes
 * (file:, path:, tag:, properties, negations); a query with two things to match, or an OR, has no single target.
 */
export function replaceTarget(node: SearchNode): Term | null {
  const isTarget = (n: SearchNode): n is Term => n.kind === "term" && (n.field === "any" || n.field === "content");
  // A regex that matches the empty text (/x*/, /^/) would change every note: never a target.
  const usable = (t: Term) => !t.regex || !new RegExp(t.regex.source, t.regex.flags).test("");
  if (isTarget(node)) return usable(node) ? node : null;
  if (node.kind !== "and") return null;
  const targets = node.items.filter(isTarget);
  // Everything else only picks notes: file:, path:, tag:, properties, negations.
  const isFilter = (n: SearchNode) => n.kind === "prop" || n.kind === "not" || (n.kind === "term" && n.field !== "any" && n.field !== "content");
  const filtersOnly = node.items.every((n) => isTarget(n) || isFilter(n));
  return targets.length === 1 && filtersOnly && usable(targets[0]) ? targets[0] : null;
}

/** `$&`, `$1`…`$99`, `$<name>` and `$$` of a regex replacement, for one match. */
function expand(replacement: string, match: string, groups: (string | undefined)[], named: Record<string, string | undefined> | undefined): string {
  return replacement.replace(/\$(\$|&|<([^>]+)>|\d{1,2})/g, (all, what: string, name?: string) => {
    if (what === "$") return "$";
    if (what === "&") return match;
    if (name !== undefined) return named?.[name] ?? "";
    const n = Number(what);
    return n >= 1 && n <= groups.length ? groups[n - 1] ?? "" : all;
  });
}

/**
 * `text` with every match of `target` replaced, in the note's body only (front matter is left alone; edit properties
 * there). A word or phrase is replaced as whole words (`cat` does not touch `category`) and literally; a regex keeps
 * `$1`-style groups. Empty matches are never replaced.
 */
export function replaceInText(text: string, target: Term, replacement: string): string {
  const head = frontmatterBlock(text);
  const body = text.slice(head.length);
  const ci = target.caseSensitive ? "" : "i";
  let re: RegExp;
  if (target.regex) {
    re = new RegExp(target.regex.source, target.regex.flags + "g" + ci);
  } else {
    const t = target.text ?? "";
    if (!t) return text;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const word = /[\p{L}\p{N}_]/u;
    const before = word.test(t[0]) ? "(?<![\\p{L}\\p{N}_])" : "";
    const after = word.test(t[t.length - 1]) ? "(?![\\p{L}\\p{N}_])" : "";
    re = new RegExp(before + escaped + after, "gu" + ci);
  }
  const next = body.replace(re, (...args: unknown[]) => {
    const match = args[0] as string;
    if (match === "") return match;
    const hasNamed = typeof args[args.length - 1] === "object";
    const named = hasNamed ? (args[args.length - 1] as Record<string, string | undefined>) : undefined;
    const groups = args.slice(1, hasNamed ? -3 : -2) as (string | undefined)[];
    return target.regex ? expand(replacement, match, groups, named) : replacement;
  });
  return head + next;
}
