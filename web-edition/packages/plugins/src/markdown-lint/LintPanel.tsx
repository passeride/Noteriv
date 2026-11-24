import { useEffect, useMemo, useState } from "react";
import type { PluginApi } from "@noteriv/plugin-api";
import { lintMarkdown, type LintWarning } from "@noteriv/core/markdown-lint";
import { listMarkdown, noteTitle } from "../shared/vault";

export interface LintLabels {
  errors: (n: number) => string;
  warnings: (n: number) => string;
  infos: (n: number) => string;
  ok: string;
  none: string;
  noNote: string;
  groupErrors: string;
  groupWarnings: string;
  groupInfos: string;
  line: (n: number) => string;
}

export function groupWarnings(warnings: LintWarning[]) {
  return {
    errors: warnings.filter((w) => w.type === "error"),
    warns: warnings.filter((w) => w.type === "warning"),
    infos: warnings.filter((w) => w.type === "info"),
  };
}

const ICON: Record<LintWarning["type"], string> = { error: "❌", warning: "⚠️", info: "ℹ️" };

/**
 * Lint results for the open note (styles: `.lint-*` in the shared app.css). Re-lints 600 ms after the last edit;
 * note names for broken-[[link]] checks come from the vault, without extensions on both platforms.
 */
export function LintPanel({ api, labels }: { api: PluginApi; labels: LintLabels }) {
  const [content, setContent] = useState<string | null>(() => api.editor.getContent());
  const [names, setNames] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<LintWarning[]>([]);

  useEffect(() => {
    const loadNames = () =>
      void listMarkdown(api.vault)
        .then((paths) => setNames(paths.map(noteTitle)))
        .catch(() => undefined);
    const onChange = (text?: unknown) => setContent(typeof text === "string" ? text : api.editor.getContent());
    const onOpen = () => setContent(api.editor.getContent());
    loadNames();
    api.events.on("editor-change", onChange);
    api.events.on("file-open", onOpen);
    api.events.on("vault-change", loadNames);
    return () => {
      api.events.off("editor-change", onChange);
      api.events.off("file-open", onOpen);
      api.events.off("vault-change", loadNames);
    };
  }, [api]);

  useEffect(() => {
    if (content === null) return setWarnings([]);
    const t = setTimeout(() => setWarnings(lintMarkdown(content, "", names)), 600);
    return () => clearTimeout(t);
  }, [content, names]);

  const grouped = useMemo(() => groupWarnings(warnings), [warnings]);

  if (content === null) return <div className="lint-empty">{labels.noNote}</div>;

  const group = (title: string, items: LintWarning[]) =>
    items.length > 0 && (
      <div className="lint-group">
        <div className="lint-group-header">{title}</div>
        {items.map((w, i) => (
          <button
            key={`${w.rule}-${w.line}-${i}`}
            className={`lint-item lint-item-${w.type}`}
            // Lint lines are 1-based, the editor API is 0-based.
            onClick={() => api.editor.setCursor({ line: w.line - 1, ch: Math.max(0, w.column - 1) })}
            title={`${w.rule} (${labels.line(w.line)})`}
          >
            <span className="lint-icon">{ICON[w.type]}</span>
            <span className="lint-msg">{w.message}</span>
            <span className="lint-line">L{w.line}</span>
          </button>
        ))}
      </div>
    );

  return (
    <div data-lint-panel="">
      <div className="lint-counts" style={{ padding: "8px 12px" }}>
        {grouped.errors.length > 0 && <span className="lint-count-error">{labels.errors(grouped.errors.length)}</span>}
        {grouped.warns.length > 0 && <span className="lint-count-warn">{labels.warnings(grouped.warns.length)}</span>}
        {grouped.infos.length > 0 && <span className="lint-count-info">{labels.infos(grouped.infos.length)}</span>}
        {warnings.length === 0 && <span className="lint-count-ok">{labels.ok}</span>}
      </div>
      <div className="lint-list">
        {warnings.length === 0 ? (
          <div className="lint-empty">{labels.none}</div>
        ) : (
          <>
            {group(labels.groupErrors, grouped.errors)}
            {group(labels.groupWarnings, grouped.warns)}
            {group(labels.groupInfos, grouped.infos)}
          </>
        )}
      </div>
    </div>
  );
}
