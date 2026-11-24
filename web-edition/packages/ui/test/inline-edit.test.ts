import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  inlineEditExtension,
  inlineEditState,
  openInlineEditEffect,
  setInlineDiffEffect,
  acceptInlineEditCommand,
  rejectInlineEditCommand,
  computeLineDiff,
  openInlineEdit,
} from "../src/editor/inline-edit-extension";

describe("CodeMirror 6 Inline Edit Extension (Claudian Style)", () => {
  it("computes line-level diff between original and replacement text", () => {
    const original = "Line 1\nLine 2 old\nLine 3";
    const replacement = "Line 1\nLine 2 new\nLine 3";
    const diff = computeLineDiff(original, replacement);

    expect(diff).toEqual([
      { type: "equal", text: "Line 1" },
      { type: "delete", text: "Line 2 old" },
      { type: "insert", text: "Line 2 new" },
      { type: "equal", text: "Line 3" },
    ]);
  });

  it("initializes with idle state", () => {
    const state = EditorState.create({
      doc: "Hello world\nThis is a test note.",
      extensions: [inlineEditExtension()],
    });

    const edit = state.field(inlineEditState);
    expect(edit.status).toBe("idle");
  });

  it("opens inline edit prompt on selection", () => {
    let state = EditorState.create({
      doc: "Hello world\nThis is a test note.",
      selection: { anchor: 0, head: 11 }, // "Hello world"
      extensions: [inlineEditExtension()],
    });

    state = state.update({
      effects: openInlineEditEffect.of({ from: 0, to: 11, originalText: "Hello world" }),
    }).state;

    const edit = state.field(inlineEditState);
    expect(edit.status).toBe("prompting");
    expect(edit.from).toBe(0);
    expect(edit.to).toBe(11);
    expect(edit.originalText).toBe("Hello world");
  });

  it("transitions to diff preview state when AI provides replacement", () => {
    let state = EditorState.create({
      doc: "Hello world\nThis is a test note.",
      extensions: [inlineEditExtension()],
    });

    state = state.update({
      effects: [
        openInlineEditEffect.of({ from: 0, to: 11, originalText: "Hello world" }),
        setInlineDiffEffect.of({ replacementText: "Greetings earthlings" }),
      ],
    }).state;

    const edit = state.field(inlineEditState);
    expect(edit.status).toBe("diff");
    expect(edit.replacementText).toBe("Greetings earthlings");
    expect(edit.diffLines?.length).toBeGreaterThan(0);
  });

  it("accepts inline edit by replacing the document range", () => {
    let state = EditorState.create({
      doc: "Hello world\nThis is a test note.",
      extensions: [inlineEditExtension()],
    });

    state = state.update({
      effects: [
        openInlineEditEffect.of({ from: 0, to: 11, originalText: "Hello world" }),
        setInlineDiffEffect.of({ replacementText: "Greetings earthlings" }),
      ],
    }).state;

    // Simulate accept command
    const tr = acceptInlineEditCommand(state);
    expect(tr).not.toBeNull();
    const nextState = state.update(tr!).state;

    expect(nextState.doc.toString()).toBe("Greetings earthlings\nThis is a test note.");
    expect(nextState.field(inlineEditState).status).toBe("idle");
  });

  it("rejects inline edit and leaves document untouched", () => {
    let state = EditorState.create({
      doc: "Hello world\nThis is a test note.",
      extensions: [inlineEditExtension()],
    });

    state = state.update({
      effects: [
        openInlineEditEffect.of({ from: 0, to: 11, originalText: "Hello world" }),
        setInlineDiffEffect.of({ replacementText: "Greetings earthlings" }),
      ],
    }).state;

    // Simulate reject command
    const tr = rejectInlineEditCommand(state);
    expect(tr).not.toBeNull();
    const nextState = state.update(tr!).state;

    expect(nextState.doc.toString()).toBe("Hello world\nThis is a test note.");
    expect(nextState.field(inlineEditState).status).toBe("idle");
  });

  it("openInlineEdit expands to current line when selection is empty", () => {
    const container = document.createElement("div");
    const state = EditorState.create({
      doc: "Line 1\nLine 2 target\nLine 3",
      selection: { anchor: 10, head: 10 }, // Inside "Line 2 target"
      extensions: [inlineEditExtension()],
    });
    const view = new EditorView({ state, parent: container });

    openInlineEdit(view);

    const edit = view.state.field(inlineEditState);
    expect(edit.status).toBe("prompting");
    expect(edit.originalText).toBe("Line 2 target");
    expect(edit.from).toBe(7);
    expect(edit.to).toBe(20);
    view.destroy();
  });
});
