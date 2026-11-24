import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";

export interface EditorPrefs {
  spellCheck: boolean;
  tabSize: number;
}

/**
 * Per-user editor preferences that can change while a document is open (spell check,
 * tab size). Living in a Compartment lets the Settings modal reconfigure open editors
 * in place instead of rebuilding them (which would lose cursor and scroll position).
 */
export const prefsCompartment = new Compartment();

/** With no prefs the editor keeps CodeMirror's own defaults (what the desktop app has always run with). */
export function prefsExtension(prefs?: EditorPrefs) {
  if (!prefs) return [];
  return [
    EditorState.tabSize.of(prefs.tabSize),
    indentUnit.of(" ".repeat(prefs.tabSize)),
    EditorView.contentAttributes.of({ spellcheck: prefs.spellCheck ? "true" : "false" }),
  ];
}
