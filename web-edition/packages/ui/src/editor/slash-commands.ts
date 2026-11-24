import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  pickedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { t } from "../i18n";

/**
 * `/` commands: typing `/` at the start of a line or after a space opens a menu that turns the line into a heading,
 * list, quote… or inserts a block (code, table, math…) or inline markup. The text typed after `/` filters the menu by
 * the item's name in the current language and by English keywords, so `/h1` and `/todo` work in every language.
 */

/** Applies an item: replaces the `/…` text at from..to. `done` adds what every change of the menu carries. */
type Run = (view: EditorView, from: number, to: number, done: (spec: TransactionSpec) => TransactionSpec) => void;

interface SlashItem {
  id: string;
  /** Extra words it is found by, besides its name. */
  keywords: string;
  /** What it writes, shown beside the name. */
  hint: string;
  /** line: changes the line's markup; block: lines of its own; inline: in place. Tables take inline items only. */
  kind: "line" | "block" | "inline";
  run: Run;
}

/** Leading block markup a line can already have: a heading, list item, task, numbered item or quote (with callout). */
const LINE_PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?(?:\[![^\]]*\][+-]?\s*)?)?/;

/** The line with the `/…` text taken out (and the space before it, when that would leave two), and where it was. */
function withoutCommand(view: EditorView, from: number, to: number) {
  const line = view.state.doc.lineAt(from);
  let start = from - line.from;
  const after = line.text.slice(to - line.from);
  const before = line.text.slice(0, start);
  // Only a space after real text: the one after a marker (`- /task`) belongs to the marker.
  const hasText = before.length > LINE_PREFIX.exec(before)![0].length;
  if (hasText && before.endsWith(" ") && (after === "" || after.startsWith(" "))) start--;
  return { line, text: line.text.slice(0, start) + after, at: start };
}

/** Gives the line the block markup `prefix` instead of the one it had; a quote's `>` stays for non-quote markup. */
const linePrefix =
  (prefix: string): Run =>
  (view, from, to, done) => {
    const { line, text, at } = withoutCommand(view, from, to);
    const m = LINE_PREFIX.exec(text)!;
    const indent = m[1];
    const old = m[2] ?? "";
    const keep = old.startsWith(">") && !prefix.startsWith(">") ? old : "";
    const lead = indent + keep + prefix;
    const next = lead + text.slice(indent.length + old.length);
    const cursor = Math.max(lead.length, at - indent.length - old.length + lead.length);
    view.dispatch(done({ changes: { from: line.from, to: line.to, insert: next }, selection: { anchor: line.from + cursor } }));
  };

/**
 * Puts `lines` on lines of their own, indented like the line, with an empty line before and after when the text next
 * to them would otherwise run into them (a `---` under a paragraph makes it a heading; a table runs on to the next
 * line). `caret` is the line and column the cursor goes to within the block.
 */
const block =
  (lines: string[], caret: [number, number]): Run =>
  (view, from, to, done) => {
    const doc = view.state.doc;
    const { line, text } = withoutCommand(view, from, to);
    const indent = /^\s*/.exec(line.text)![0];
    const kept = text.trimEnd();
    const body = lines.map((l) => indent + l);
    const prevBlank = kept.trim() === "" ? line.number === 1 || doc.line(line.number - 1).text.trim() === "" : false;
    const head = kept.trim() !== "" ? [kept, ""] : prevBlank ? [] : [""];
    const nextBlank = line.number === doc.lines || doc.line(line.number + 1).text.trim() === "";
    // A block that ends with an empty line (the divider: the cursor goes below it) needs no other.
    const tail = nextBlank || lines[lines.length - 1] === "" ? [] : [""];
    const out = [...head, ...body, ...tail];
    const caretLine = head.length + caret[0];
    const offset = out.slice(0, caretLine).reduce((n, l) => n + l.length + 1, 0) + indent.length + caret[1];
    view.dispatch(done({ changes: { from: line.from, to: line.to, insert: out.join("\n") }, selection: { anchor: line.from + offset } }));
  };

/** Replaces the `/…` text with `before` + `after`, the cursor between them. */
const inline =
  (before: string, after = ""): Run =>
  (view, from, to, done) => {
    view.dispatch(done({ changes: { from, to, insert: before + after }, selection: { anchor: from + before.length } }));
  };

/** Inserts text, then opens the next menu (note names after `[[`). */
const insertAndComplete =
  (text: string): Run =>
  (view, from, to, done) => {
    view.dispatch(done({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } }));
    startCompletion(view);
  };

const pad = (n: number) => String(n).padStart(2, "0");

/** A footnote reference at the cursor and its definition at the end of the note, where the cursor goes. */
const footnote: Run = (view, from, to, done) => {
  const doc = view.state.doc.toString();
  let n = 1;
  for (const m of doc.matchAll(/\[\^(\d+)\]/g)) n = Math.max(n, Number(m[1]) + 1);
  const ref = `[^${n}]`;
  const end = doc.length;
  const def = `${doc.endsWith("\n") ? "" : "\n"}\n[^${n}]: `;
  view.dispatch(
    done({
      changes: [
        { from, to, insert: ref },
        { from: end, insert: def },
      ],
      selection: { anchor: end - (to - from) + ref.length + def.length },
    })
  );
};

const ITEMS: SlashItem[] = [
  { id: "h1", keywords: "heading title h1 #", hint: "#", kind: "line", run: linePrefix("# ") },
  { id: "h2", keywords: "heading subtitle h2 ##", hint: "##", kind: "line", run: linePrefix("## ") },
  { id: "h3", keywords: "heading h3 ###", hint: "###", kind: "line", run: linePrefix("### ") },
  { id: "bullet", keywords: "bullet list unordered ul -", hint: "-", kind: "line", run: linePrefix("- ") },
  { id: "numbered", keywords: "numbered list ordered ol 1.", hint: "1.", kind: "line", run: linePrefix("1. ") },
  { id: "task", keywords: "task todo checkbox check [ ]", hint: "- [ ]", kind: "line", run: linePrefix("- [ ] ") },
  { id: "quote", keywords: "quote blockquote >", hint: ">", kind: "line", run: linePrefix("> ") },
  { id: "callout", keywords: "callout note admonition info tip warning", hint: "> [!note]", kind: "line", run: linePrefix("> [!note] ") },
  { id: "code", keywords: "code block fenced ```", hint: "```", kind: "block", run: block(["```", "", "```"], [1, 0]) },
  { id: "math", keywords: "math latex equation formula $$", hint: "$$", kind: "block", run: block(["$$", "", "$$"], [1, 0]) },
  { id: "table", keywords: "table grid", hint: "| |", kind: "block", run: block(["|  |  |", "| --- | --- |", "|  |  |"], [0, 2]) },
  { id: "divider", keywords: "divider rule horizontal line hr ---", hint: "---", kind: "block", run: block(["---", ""], [1, 0]) },
  { id: "bold", keywords: "bold strong b", hint: "**", kind: "inline", run: inline("**", "**") },
  { id: "italic", keywords: "italic emphasis em i", hint: "*", kind: "inline", run: inline("*", "*") },
  { id: "strike", keywords: "strikethrough strike del", hint: "~~", kind: "inline", run: inline("~~", "~~") },
  { id: "highlight", keywords: "highlight mark", hint: "==", kind: "inline", run: inline("==", "==") },
  { id: "inlineCode", keywords: "inline code `", hint: "`", kind: "inline", run: inline("`", "`") },
  { id: "link", keywords: "link url href", hint: "[](…)", kind: "inline", run: inline("[", "](url)") },
  { id: "wikilink", keywords: "wiki link note internal [[", hint: "[[", kind: "inline", run: insertAndComplete("[[") },
  { id: "embed", keywords: "embed transclude note ![[", hint: "![[", kind: "inline", run: insertAndComplete("![[") },
  { id: "footnote", keywords: "footnote note reference [^", hint: "[^1]", kind: "inline", run: footnote },
  {
    id: "date",
    keywords: "date today",
    hint: "YYYY-MM-DD",
    kind: "inline",
    run: (view, from, to, done) => {
      const d = new Date();
      inline(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)(view, from, to, done);
    },
  },
  {
    id: "time",
    keywords: "time now clock",
    hint: "HH:MM",
    kind: "inline",
    run: (view, from, to, done) => {
      const d = new Date();
      inline(`${pad(d.getHours())}:${pad(d.getMinutes())}`)(view, from, to, done);
    },
  },
];

/** Lower case, without accents: `Tiêu đề` is found by `tieu de`. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();

/** Front matter is looked for this far down: a note starting with a `---` rule and no closing one is not scanned whole. */
const FRONT_MATTER_LINES = 200;

/** Where `/` is just text: code, comments, HTML, front matter. Also says whether the cursor is in a table. */
function context(state: EditorState, pos: number): "text" | "table" | "off" {
  let table = false;
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|CodeText|Comment|CommentBlock|HTMLBlock|HTMLTag)$/.test(node.name)) return "off";
    if (node.name === "Table") table = true;
  }
  const doc = state.doc;
  if (doc.lines >= 2 && doc.line(1).text.replace(/^﻿/, "") === "---") {
    for (let i = 2; i <= Math.min(doc.lines, FRONT_MATTER_LINES); i++) {
      const line = doc.line(i);
      if (line.text === "---" || line.text === "...") {
        if (pos <= line.to) return "off";
        break;
      }
    }
  }
  return table ? "table" : "text";
}

/**
 * Whether `pos` is inside math: between `$$` lines (as the math preview finds them), or after a `$` on the line
 * that opens inline math (followed by a non-space, not escaped) and has not been closed yet. A `/` there is a
 * division sign. A lone `$5` before the cursor counts as open math too; the menu just does not show.
 */
function inMath(state: EditorState, pos: number): boolean {
  const doc = state.doc;
  const here = doc.lineAt(pos);
  let block = false;
  for (let i = 1; i < here.number; i++) if (doc.line(i).text.trim() === "$$") block = !block;
  if (block) return true;
  // Escaped dollars (`\$`) are blanked, then closed `$$…$$` and `$…$` pairs dropped: what is left opens math.
  const open = here.text
    .slice(0, pos - here.from)
    // `\\` is a backslash, so in `\\$` the dollar is not escaped.
    .replace(/\\[\\$]/g, "  ")
    .replace(/\$\$.*?\$\$/g, "")
    .replace(/\$(?=[^\s$])[^$]*\$/g, "");
  return /\$\$|\$(?=\S)/.test(open);
}

/** The names shown for each item, in the current language. */
const nameOf = (id: string) => t(`editor.slash.${id}`);

/** The completion source (exported for tests; the editor adds it next to `[[` completion). */
export function slashCompletions(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  const match = /(?:^|\s)\/([\p{L}\p{M}\p{N}]*)$/u.exec(before);
  // Inside `[[…` the `/` belongs to a note name: the note menu is open there.
  if (!match || /\[\[[^\]]*$/.test(before)) return null;
  const where = context(ctx.state, ctx.pos);
  if (where === "off" || inMath(ctx.state, ctx.pos)) return null;
  const query = fold(match[1]);
  const scored = ITEMS.filter((item) => where === "text" || item.kind === "inline")
    .map((item, index) => {
      const name = fold(nameOf(item.id));
      const words = `${name} ${item.keywords} ${item.id.toLowerCase()}`.split(/\s+/);
      // Names and words that start with the query first, then ones that contain it.
      const rank = !query
        ? 0
        : name.startsWith(query) || name.replace(/\s+/g, "").startsWith(query)
          ? 0
          : words.some((w) => w.startsWith(query))
            ? 1
            : name.includes(query)
              ? 2
              : -1;
      return { item, index, rank };
    })
    .filter((s) => s.rank >= 0);
  if (scored.length === 0) return null;
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const options: Completion[] = scored.map(({ item }) => ({
    label: nameOf(item.id),
    detail: item.hint,
    type: "keyword",
    apply: (view: EditorView, completion: Completion, from: number, to: number) =>
      item.run(view, from, to, (spec) => ({ ...spec, scrollIntoView: true, userEvent: "input.complete", annotations: pickedCompletion.of(completion) })),
  }));
  return {
    from: ctx.pos - match[1].length - 1,
    options,
    filter: false,
    // Each key typed while the menu is open recomputes it at once, so Enter right after typing picks from the current list.
    update: (_current, _from, _to, next) => slashCompletions(next),
  };
}
