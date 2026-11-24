import { useEffect, useMemo, useState } from "react";
import type { PluginApi } from "@noteriv/plugin-api";
import { listFootnotes, type FootnotePlace } from "@noteriv/core/footnotes";

export interface FootnotesLabels {
  noNote: string;
  none: string;
  count: (n: number) => string;
  inline: string;
  noDefinition: string;
  unused: string;
  /** Tooltip of the button that jumps to a reference. */
  goToRef: (n: number) => string;
}

/** Definition text shown in the list at most; the rest is in the note. */
const TEXT_CHARS = 160;

/**
 * The footnotes of the open note (styles: `.fn-*` in the shared app.css). Clicking one goes to its definition (or its
 * reference, when it has none); the small buttons go to each place the note refers to it.
 */
export function FootnotesPanel({ api, labels }: { api: PluginApi; labels: FootnotesLabels }) {
  const [content, setContent] = useState<string | null>(() => api.editor.getContent());

  useEffect(() => {
    const onChange = (text?: unknown) => setContent(typeof text === "string" ? text : api.editor.getContent());
    const onOpen = () => setContent(api.editor.getContent());
    api.events.on("editor-change", onChange);
    api.events.on("file-open", onOpen);
    return () => {
      api.events.off("editor-change", onChange);
      api.events.off("file-open", onOpen);
    };
  }, [api]);

  const notes = useMemo(() => (content === null ? [] : listFootnotes(content)), [content]);
  const go = (place: FootnotePlace) => api.editor.setCursor({ line: place.line, ch: place.ch });

  if (content === null) return <div className="fn-empty">{labels.noNote}</div>;
  if (notes.length === 0) return <div className="fn-empty">{labels.none}</div>;

  return (
    <div className="fn-panel">
      <div className="fn-count">{labels.count(notes.length)}</div>
      <ol className="fn-list">
        {notes.map((f) => {
          const text = f.text ?? "";
          const place = f.definition ?? f.refs[0];
          return (
            <li key={`${f.id ?? "inline"}-${place.line}-${place.ch}`} className="fn-item">
              <button type="button" className="fn-main" onClick={() => go(place)}>
                <span className="fn-label">{f.id ?? labels.inline}</span>
                <span className="fn-text">
                  {f.text === null ? (
                    <em className="fn-warn">{labels.noDefinition}</em>
                  ) : text.length > TEXT_CHARS ? (
                    `${text.slice(0, TEXT_CHARS)}…`
                  ) : (
                    text
                  )}
                </span>
              </button>
              {f.id !== null && (
                <div className="fn-refs">
                  {f.refs.length === 0 ? (
                    <em className="fn-warn">{labels.unused}</em>
                  ) : (
                    f.refs.map((r, n) => (
                      <button key={`${r.line}-${r.ch}`} type="button" className="fn-ref" title={labels.goToRef(n + 1)} aria-label={labels.goToRef(n + 1)} onClick={() => go(r)}>
                        ↑{f.refs.length > 1 ? n + 1 : ""}
                      </button>
                    ))
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
