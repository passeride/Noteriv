import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PluginApi } from "@noteriv/plugin-api";
import { noteTitle } from "../shared/vault";
import { TEMPLATES_FOLDER, freeNotePath, getTemplateVariables, processTemplate } from "./engine";

export type TemplateMode = "create" | "insert";

export interface PickerLabels {
  search: string;
  emptyTitle: string;
  emptyFolder: (folder: string) => string;
  emptyVariables: string;
  noMatch: string;
  preview: string;
  previewEmpty: string;
  enter: Record<TemplateMode, string>;
  close: string;
  move: string;
  count: (n: number) => string;
  noNote: string;
}

interface Entry {
  path: string;
  name: string;
}

/**
 * Template picker (the `tpl-*` styles of the shared app.css). `create` makes a new note at the vault root named after
 * the template; `insert` puts the template at the cursor of the open note.
 */
export function TemplatePicker({ api, mode, labels }: { api: PluginApi; mode: TemplateMode; labels: PickerLabels }) {
  const [templates, setTemplates] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [raw, setRaw] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Notes directly in Templates/ (not its subfolders), like both apps did; no folder means an empty list.
    api.vault
      .list(TEMPLATES_FOLDER)
      .then((entries) => {
        const found = entries.filter((e) => !e.isDir).map((e) => ({ path: e.path, name: noteTitle(e.path) }));
        if (!cancelled) setTemplates(found.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => !cancelled && setTemplates([]));
    input.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (templates ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [templates, query]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    const entry = filtered[selected];
    setRaw(null);
    if (!entry) return;
    let cancelled = false;
    void api.vault.read(entry.path).then((content) => !cancelled && setRaw(content));
    return () => {
      cancelled = true;
    };
  }, [api, filtered, selected]);

  useEffect(() => {
    (list.current?.children[selected] as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const titleFor = (entry: Entry) => (mode === "insert" && api.app.currentFile ? noteTitle(api.app.currentFile) : entry.name);

  async function choose(entry: Entry, content: string | null) {
    const text = content ?? (await api.vault.read(entry.path)) ?? "";
    if (mode === "insert") {
      if (api.editor.getContent() === null) {
        api.ui.showNotice(labels.noNote);
        return;
      }
      api.editor.insertAtCursor(processTemplate(text, getTemplateVariables(titleFor(entry))));
      api.workspace.closeView();
      return;
    }
    const path = await freeNotePath(entry.name, (p) => api.vault.exists(p));
    await api.vault.write(path, processTemplate(text, getTemplateVariables(noteTitle(path))));
    api.workspace.closeView();
    await api.workspace.openFile(path);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[selected];
      if (entry) void choose(entry, raw);
    }
  }

  const current = filtered[selected];
  const preview = current && raw !== null ? processTemplate(raw, getTemplateVariables(titleFor(current))) : null;

  return (
    <div className="tpl-modal" data-templates-picker={mode}>
      <div className="tpl-input-wrap">
        <svg width="14" height="14" viewBox="0 0 14 14" className="tpl-icon">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={labels.search}
          className="tpl-input"
        />
      </div>

      {templates !== null && templates.length === 0 ? (
        <div className="tpl-empty">
          <span className="tpl-empty-title">{labels.emptyTitle}</span>
          <span className="tpl-empty-desc">{labels.emptyFolder(TEMPLATES_FOLDER)}</span>
          <span className="tpl-empty-desc">{labels.emptyVariables}</span>
        </div>
      ) : (
        <>
          <div className="tpl-body">
            <div className="tpl-list" ref={list}>
              {filtered.map((t, i) => (
                <button
                  key={t.path}
                  className={`tpl-item${i === selected ? " tpl-item-active" : ""}`}
                  onClick={() => void choose(t, i === selected ? raw : null)}
                  onMouseEnter={() => setSelected(i)}
                >
                  <span className="tpl-item-name">{t.name}</span>
                </button>
              ))}
              {templates !== null && filtered.length === 0 && (
                <div className="tpl-empty" style={{ padding: "24px 12px" }}>
                  <span className="tpl-empty-desc">{labels.noMatch}</span>
                </div>
              )}
            </div>
            <div className="tpl-preview">
              {preview !== null ? (
                <>
                  <div className="tpl-preview-label">{labels.preview}</div>
                  <div className="tpl-preview-content">{preview}</div>
                </>
              ) : (
                <div className="tpl-preview-empty">{labels.previewEmpty}</div>
              )}
            </div>
          </div>
          <div className="tpl-footer">
            <div className="tpl-footer-hint">
              <span>
                <span className="tpl-footer-key">Enter</span> {labels.enter[mode]}
              </span>
              <span>
                <span className="tpl-footer-key">Esc</span> {labels.close}
              </span>
              <span>
                <span className="tpl-footer-key">↑↓</span> {labels.move}
              </span>
            </div>
            <div className="tpl-footer-hint">{labels.count(filtered.length)}</div>
          </div>
        </>
      )}
    </div>
  );
}
