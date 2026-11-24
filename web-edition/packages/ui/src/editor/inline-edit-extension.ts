import { StateField, StateEffect, type Extension, type EditorState, type TransactionSpec } from "@codemirror/state";
import { keymap, type Command, type EditorView } from "@codemirror/view";

export interface DiffLine {
  type: "insert" | "delete" | "equal";
  text: string;
}

export interface InlineEditValue {
  status: "idle" | "prompting" | "diff";
  from: number;
  to: number;
  originalText: string;
  replacementText?: string;
  diffLines?: DiffLine[];
}

export const openInlineEditEffect = StateEffect.define<{
  from: number;
  to: number;
  originalText: string;
}>();

export const setInlineDiffEffect = StateEffect.define<{
  replacementText: string;
}>();

export const closeInlineEditEffect = StateEffect.define<void>();

/**
 * Simple line-by-line diff algorithm for editor preview.
 */
export function computeLineDiff(original: string, replacement: string): DiffLine[] {
  const origLines = original.split("\n");
  const replLines = replacement.split("\n");

  const diff: DiffLine[] = [];
  const max = Math.max(origLines.length, replLines.length);

  let i = 0;
  let j = 0;

  while (i < origLines.length && j < replLines.length) {
    if (origLines[i] === replLines[j]) {
      diff.push({ type: "equal", text: origLines[i] });
      i++;
      j++;
    } else {
      diff.push({ type: "delete", text: origLines[i] });
      diff.push({ type: "insert", text: replLines[j] });
      i++;
      j++;
    }
  }

  while (i < origLines.length) {
    diff.push({ type: "delete", text: origLines[i++] });
  }
  while (j < replLines.length) {
    diff.push({ type: "insert", text: replLines[j++] });
  }

  return diff;
}

const initialValue: InlineEditValue = {
  status: "idle",
  from: 0,
  to: 0,
  originalText: "",
};

export const inlineEditState = StateField.define<InlineEditValue>({
  create() {
    return initialValue;
  },
  update(value, tr) {
    let current = value;
    for (const e of tr.effects) {
      if (e.is(openInlineEditEffect)) {
        current = {
          status: "prompting",
          from: e.value.from,
          to: e.value.to,
          originalText: e.value.originalText,
        };
      } else if (e.is(setInlineDiffEffect)) {
        current = {
          ...current,
          status: "diff",
          replacementText: e.value.replacementText,
          diffLines: computeLineDiff(current.originalText, e.value.replacementText),
        };
      } else if (e.is(closeInlineEditEffect)) {
        current = initialValue;
      }
    }
    return current;
  },
});

/**
 * Accept inline diff: replaces [from..to] with replacementText and resets state.
 */
export function acceptInlineEditCommand(state: EditorState): TransactionSpec | null {
  const current = state.field(inlineEditState);
  if (current.status !== "diff" || current.replacementText === undefined) return null;

  return {
    changes: { from: current.from, to: current.to, insert: current.replacementText },
    effects: closeInlineEditEffect.of(),
  };
}

/**
 * Reject inline diff: resets state without altering document.
 */
export function rejectInlineEditCommand(state: EditorState): TransactionSpec | null {
  const current = state.field(inlineEditState);
  if (current.status === "idle") return null;

  return {
    effects: closeInlineEditEffect.of(),
  };
}

/**
 * Programmatically triggers inline edit on the current selection or current line.
 */
export function openInlineEdit(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  let selFrom = from;
  let selTo = to;
  let text = view.state.sliceDoc(from, to);

  // If no text selected, expand to current line
  if (selFrom === selTo) {
    const line = view.state.doc.lineAt(selFrom);
    selFrom = line.from;
    selTo = line.to;
    text = line.text;
  }

  view.dispatch({
    selection: { anchor: selFrom, head: selTo },
    effects: openInlineEditEffect.of({ from: selFrom, to: selTo, originalText: text }),
  });
}

export function inlineEditExtension(): Extension {
  return [
    inlineEditState,
    keymap.of([
      {
        key: "Mod-k",
        run: (view) => {
          openInlineEdit(view);
          return true;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          const tr = rejectInlineEditCommand(view.state);
          if (tr) {
            view.dispatch(tr);
            return true;
          }
          return false;
        },
      },
      {
        key: "Mod-Enter",
        run: (view) => {
          const tr = acceptInlineEditCommand(view.state);
          if (tr) {
            view.dispatch(tr);
            return true;
          }
          return false;
        },
      },
    ]),
  ];
}
