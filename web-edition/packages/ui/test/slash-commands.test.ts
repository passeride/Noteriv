import { afterEach, describe, expect, it } from "vitest";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { slashCompletions } from "../src/editor/slash-commands";
import { setLocale } from "../src/i18n";

const views: EditorView[] = [];
afterEach(async () => {
  views.splice(0).forEach((v) => v.destroy());
  await setLocale("en");
});

/** An editor on `doc` with the cursor at the last `|`. */
function editor(doc: string) {
  const pos = doc.lastIndexOf("|");
  const text = doc.slice(0, pos) + doc.slice(pos + 1);
  const state = EditorState.create({ doc: text, selection: { anchor: pos }, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = new EditorView({ state, parent: document.body.appendChild(document.createElement("div")) });
  views.push(view);
  return view;
}

const menu = (view: EditorView) => slashCompletions(new CompletionContext(view.state, view.state.selection.main.head, false));
const labels = (view: EditorView) => menu(view)?.options.map((o) => o.label) ?? null;

/** Picks the menu item named `label`; returns the text with `|` at the cursor. */
function pick(view: EditorView, label: string) {
  const result = menu(view)!;
  const option = result.options.find((o) => o.label === label)!;
  (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(view, option, result.from, view.state.selection.main.head);
  const text = view.state.doc.toString();
  const { anchor, head } = view.state.selection.main;
  return anchor === head ? text.slice(0, anchor) + "|" + text.slice(anchor) : text.slice(0, anchor) + "[" + text.slice(anchor, head) + "]" + text.slice(head);
}

describe("slash commands", () => {
  it("opens at the start of a line or after a space, not inside a word, a path, code or front matter", () => {
    expect(labels(editor("/|"))?.[0]).toBe("Heading 1");
    expect(labels(editor("and /|"))).not.toBeNull();
    expect(labels(editor("and/|"))).toBeNull();
    expect(labels(editor("see /usr/|"))).toBeNull();
    expect(labels(editor("```\n/|\n```"))).toBeNull();
    expect(labels(editor("text `/|`"))).toBeNull();
    expect(labels(editor("---\ntitle: /|\n---\nbody"))).toBeNull();
    expect(labels(editor("---\ntitle: x\n---\n/|"))).not.toBeNull();
  });

  it("stays closed inside math, where / divides, and opens again after it", () => {
    expect(labels(editor("$a /|"))).toBeNull();
    expect(labels(editor("x $\\frac{1}{2} /|$ y"))).toBeNull();
    expect(labels(editor("$$\na /|\n$$"))).toBeNull();
    expect(labels(editor("$$ a /|"))).toBeNull();
    expect(labels(editor("$a$ and /|"))).not.toBeNull();
    expect(labels(editor("$$a$$ /|"))).not.toBeNull();
    expect(labels(editor("$$\na\n$$\n/|"))).not.toBeNull();
    expect(labels(editor("costs \\$5 /|"))).not.toBeNull();
    expect(labels(editor("\\\\$x /|"))).toBeNull();
    expect(labels(editor("from $ to /|"))).not.toBeNull();
  });

  it("filters by name and by English keywords, and closes when nothing matches", () => {
    expect(labels(editor("/tab|"))).toEqual(["Table"]);
    expect(labels(editor("/todo|"))).toEqual(["Task"]);
    expect(labels(editor("/h2|"))?.[0]).toBe("Heading 2");
    expect(labels(editor("/zzz|"))).toBeNull();
  });

  it("finds Vietnamese names typed without accents, and English keywords still work", async () => {
    await setLocale("vi");
    expect(labels(editor("/tieu|"))?.slice(0, 3)).toEqual(["Tiêu đề 1", "Tiêu đề 2", "Tiêu đề 3"]);
    expect(labels(editor("/bang|"))).toContain("Bảng");
    expect(labels(editor("/table|"))).toContain("Bảng");
  });

  it("turns the line into a heading, list or task, replacing the markup it had", () => {
    expect(pick(editor("Plan /h|"), "Heading 1")).toBe("# Plan|");
    expect(pick(editor("## Plan /h|"), "Heading 3")).toBe("### Plan|");
    expect(pick(editor("- Milk /task|"), "Task")).toBe("- [ ] Milk|");
    expect(pick(editor("  /num|"), "Numbered list")).toBe("  1. |");
    expect(pick(editor("/callout|"), "Callout")).toBe("> [!note] |");
    expect(pick(editor("foo /h1| bar"), "Heading 1")).toBe("# foo| bar");
    // A line that is only a marker: the marker is replaced, not kept as text.
    expect(pick(editor("- /task|"), "Task")).toBe("- [ ] |");
    expect(pick(editor("## /h1|"), "Heading 1")).toBe("# |");
    expect(pick(editor("1. /bullet|"), "Bulleted list")).toBe("- |");
    expect(pick(editor("- [ ] /h1|"), "Heading 1")).toBe("# |");
    expect(pick(editor("> /h1|"), "Heading 1")).toBe("> # |");
    // A quote keeps its `>` around other markup.
    expect(pick(editor("> quoted /h1|"), "Heading 1")).toBe("> # quoted|");
  });

  it("puts blocks on their own lines, apart from the text around them, and inserts inline markup in place", () => {
    expect(pick(editor("/code|"), "Code block")).toBe("```\n|\n```");
    expect(pick(editor("Before /math|"), "Math block")).toBe("Before\n\n$$\n|\n$$");
    // A rule right under a paragraph would make it a heading; a table would run on into the next line.
    expect(pick(editor("Para\n/hr|"), "Divider")).toBe("Para\n\n---\n|");
    expect(pick(editor("/table|\nNext"), "Table")).toBe("| | |  |\n| --- | --- |\n|  |  |\n\nNext");
    expect(pick(editor("- item\n  /code|"), "Code block")).toBe("- item\n\n  ```\n  |\n  ```");
    expect(pick(editor("a /bold|"), "Bold")).toBe("a **|**");
    expect(pick(editor("/link|"), "Link")).toBe("[|](url)");
    expect(pick(editor("/date|"), "Today's date")).toMatch(/^\d{4}-\d{2}-\d{2}\|$/);
  });

  it("adds the next footnote and its definition at the end of the note", () => {
    expect(pick(editor("One[^1] and /foot|\n\n[^1]: first"), "Footnote")).toBe("One[^1] and [^2]\n\n[^1]: first\n\n[^2]: |");
  });

  it("stays out of a note name after [[, and offers only inline items in a table", () => {
    expect(labels(editor("[[Q3 /|"))).toBeNull();
    const inTable = labels(editor("| a | b |\n| - | - |\n| c /|"));
    expect(inTable).toContain("Bold");
    expect(inTable).not.toContain("Heading 1");
    expect(inTable).not.toContain("Table");
  });

  it("recomputes the list as you type, so Enter right after a key picks from the current one", () => {
    const view = editor("/h|");
    const first = menu(view)!;
    view.dispatch({ changes: { from: 2, insert: "2" }, selection: { anchor: 3 } });
    const next = first.update!(first, first.from, 3, new CompletionContext(view.state, 3, false));
    expect(next?.options[0].label).toBe("Heading 2");
  });

  it("finds a Vietnamese name typed without its spaces", async () => {
    await setLocale("vi");
    expect(labels(editor("/tieude2|"))?.[0]).toBe("Tiêu đề 2");
  });
});
