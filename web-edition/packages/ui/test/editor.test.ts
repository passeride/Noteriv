import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MemoryVaultAdapter } from "@noteriv/core/memory-vault-adapter";
import { runFormattingAction } from "../src/editor/FormattingToolbar";
import { prefsExtension } from "../src/editor/editor-prefs";
import { wikilinkCompletions } from "../src/editor/wikilink-completion";

function complete(source: ReturnType<typeof wikilinkCompletions>, doc: string) {
  const state = EditorState.create({ doc });
  return source(new CompletionContext(state, doc.length, true));
}

describe("wikilink completion", () => {
  const adapter = new MemoryVaultAdapter({
    "Chess/Endgames.md": "",
    "Chess/Openings.md": "",
    "Journal.md": "",
  });

  it("offers nothing outside [[ and nothing without an adapter", async () => {
    const source = wikilinkCompletions(() => adapter, "name");
    expect(await complete(source, "plain text")).toBeNull();
    expect(await complete(wikilinkCompletions(() => null, "name"), "see [[")).toBeNull();
  });

  it("names suggestions by file name or by vault-relative path", async () => {
    const byName = await complete(wikilinkCompletions(() => adapter, "name"), "see [[");
    expect(byName?.options.map((o) => o.label).sort()).toEqual(["Endgames", "Journal", "Openings"]);

    const byPath = await complete(wikilinkCompletions(() => adapter, "path"), "see [[");
    expect(byPath?.options.map((o) => o.label).sort()).toEqual(["Chess/Endgames", "Chess/Openings", "Journal"]);
  });

  it("filters by what is typed after [[ (case-insensitive) and starts the replacement after the brackets", async () => {
    const result = await complete(wikilinkCompletions(() => adapter, "name"), "see [[open");
    expect(result?.options.map((o) => o.label)).toEqual(["Openings"]);
    expect(result?.from).toBe("see [[".length);
  });
});

describe("editor prefs", () => {
  it("adds nothing when unset, and tab size, indent unit and spellcheck attribute when set", () => {
    expect(prefsExtension()).toEqual([]);
    expect(prefsExtension({ spellCheck: true, tabSize: 2 })).toHaveLength(3);
  });
});

describe("formatting actions", () => {
  function run(doc: string, from: number, to: number, action: Parameters<typeof runFormattingAction>[1]) {
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: from, head: to } }),
      parent: document.body,
    });
    runFormattingAction(view, action);
    const out = view.state.doc.toString();
    view.destroy();
    return out;
  }

  it("wraps the selection for bold, italic, strikethrough and code", () => {
    expect(run("a word b", 2, 6, "toggleBold")).toBe("a **word** b");
    expect(run("a word b", 2, 6, "toggleItalic")).toBe("a *word* b");
    expect(run("a word b", 2, 6, "toggleStrikethrough")).toBe("a ~~word~~ b");
    expect(run("a word b", 2, 6, "toggleCode")).toBe("a `word` b");
  });

  it("does nothing without an editor", () => {
    expect(() => runFormattingAction(null, "toggleBold")).not.toThrow();
  });
});
