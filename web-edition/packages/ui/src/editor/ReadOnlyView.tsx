"use client";

import { useEffect, useRef, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import {
  liveMarkdownPlugin,
  markdownRenderTheme,
  mdHighlightStyle,
  editorTheme,
  renderAllLines,
  mathExtension,
} from "../markdown";
import { linkClickHandler } from "./link-click";

export interface ReadOnlyViewProps {
  content: string;
  onChange?: (content: string) => void;
  className?: string;
  /** Fires when a `[[wiki-link]]` is clicked; the app opens (or creates) the note it names. */
  onWikilinkOpen?: (target: string) => void;
}

export default function ReadOnlyView({ content, onChange, className = "", onWikilinkOpen }: ReadOnlyViewProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onWikilinkOpenRef = useRef(onWikilinkOpen);
  onWikilinkOpenRef.current = onWikilinkOpen;

  const createEditor = useCallback(() => {
    if (!editorRef.current) return;
    if (viewRef.current) viewRef.current.destroy();

    const extensions = [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(mdHighlightStyle),
      editorTheme,
      markdownRenderTheme,
      liveMarkdownPlugin,
      mathExtension(),

      renderAllLines.of(true),
      linkClickHandler(() => onWikilinkOpenRef.current),
      EditorView.lineWrapping,
      EditorView.editable.of(false),
      EditorView.theme({
        ".cm-cursor": { display: "none !important" },
        ".cm-activeLine": { background: "transparent !important" },
        ".cm-content": { cursor: "text" },
      }),
    ];

    // Allow dispatches (for checkbox toggling) but forward changes via onChange.
    // Do NOT use EditorState.readOnly so widgets can still dispatch changes.
    if (onChangeRef.current) {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        })
      );
    } else {
      extensions.push(EditorState.readOnly.of(true));
    }

    const state = EditorState.create({ doc: content, extensions });

    viewRef.current = new EditorView({ state, parent: editorRef.current });
  }, []);

  useEffect(() => {
    createEditor();
    return () => { viewRef.current?.destroy(); };
  }, [createEditor]);

  useEffect(() => {
    if (!viewRef.current) return;
    const current = viewRef.current.state.doc.toString();
    if (current !== content) {
      viewRef.current.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [content]);

  return <div ref={editorRef} className={`h-full overflow-hidden ${className}`} />;
}
