"use client";

import { useEffect, useRef, useCallback } from "react";
import type { VaultAdapter } from "@noteriv/core/vault-adapter";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { wikilinkAutocompletion, type WikilinkLabel } from "./wikilink-completion";
import { prefsCompartment, prefsExtension, type EditorPrefs } from "./editor-prefs";
import { inlineEditExtension } from "./inline-edit-extension";

const sourceHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: "var(--accent)", fontWeight: "bold", fontSize: "1.2em" },
  { tag: tags.heading2, color: "var(--mauve)", fontWeight: "bold", fontSize: "1.1em" },
  { tag: tags.heading3, color: "var(--green)", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, color: "var(--mauve)", fontFamily: "monospace" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--accent)", opacity: "0.7" },
  { tag: tags.quote, color: "var(--text-secondary)" },
  { tag: tags.meta, color: "var(--text-muted)" },
]);

const sourceTheme = EditorView.theme({
  "&": { height: "100%", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "var(--editor-font-size, 15px)" },
  ".cm-scroller": {
    fontFamily: "var(--editor-font, 'JetBrains Mono', 'Fira Code', monospace)",
    lineHeight: "var(--editor-line-height, 1.7)",
    padding: "1rem",
    overflow: "auto",
  },
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor": { borderLeftColor: "var(--accent) !important", borderLeftWidth: "2px !important" },
  ".cm-activeLine": { background: "color-mix(in srgb, var(--bg-tertiary) 30%, transparent) !important" },
  ".cm-selectionBackground": { background: "color-mix(in srgb, var(--accent) 20%, transparent) !important" },
  "&.cm-focused .cm-selectionBackground": { background: "color-mix(in srgb, var(--accent) 30%, transparent) !important" },
  ".cm-gutters": { background: "transparent !important", border: "none !important", color: "var(--text-muted)" },
  ".cm-activeLineGutter": { background: "transparent !important", color: "var(--text-secondary)" },
});

export interface SourceEditorProps {
  content: string;
  onChange: (value: string) => void;
  onViewReady?: (view: EditorView) => void;
  /** Vault whose notes `[[` completes against. Without it completion stays off. */
  adapter?: VaultAdapter | null;
  /** How `[[` suggestions are named; see WikilinkLabel. */
  wikilinkLabel?: WikilinkLabel;
  className?: string;
  /** Spell check and tab size, applied live. Unset keeps CodeMirror's defaults. */
  prefs?: EditorPrefs;
}

export default function SourceEditor({ content, onChange, onViewReady, adapter = null, wikilinkLabel = "name", className = "", prefs }: SourceEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const createEditor = useCallback(() => {
    if (!editorRef.current) return;
    if (viewRef.current) viewRef.current.destroy();

    const state = EditorState.create({
      doc: content,
      extensions: [
        prefsCompartment.of(prefsExtension(prefsRef.current)),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        closeBrackets(),
        history(),
        wikilinkAutocompletion(() => adapterRef.current, wikilinkLabel),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(sourceHighlight),
        sourceTheme,
        search({ top: true }),
        keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.lineWrapping,
        inlineEditExtension(),
      ],
    });

    viewRef.current = new EditorView({ state, parent: editorRef.current });
    onViewReady?.(viewRef.current);
  }, []);

  useEffect(() => {
    createEditor();
    return () => { viewRef.current?.destroy(); };
  }, [createEditor]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: prefsCompartment.reconfigure(prefsExtension(prefs)) });
  }, [prefs?.spellCheck, prefs?.tabSize]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewRef.current) return;
    const current = viewRef.current.state.doc.toString();
    if (current !== content) {
      viewRef.current.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  return <div ref={editorRef} className={`h-full overflow-hidden ${className}`} />;
}
