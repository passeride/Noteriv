import { useEffect, useMemo, useState } from "react";
import type { PluginApi } from "@noteriv/plugin-api";
import { folderOf, listMarkdown, noteTitle } from "../shared/vault";
import { mergeNotes, sectionPath, splitByHeadings } from "./compose";

export interface ComposerLabels {
  title: string;
  merge: string;
  split: string;
  noNote: string;
  searchMerge: string;
  selected: (n: number) => string;
  noNotes: string;
  addHeadings: string;
  deleteAfter: string;
  splitBy: string;
  noHeadings: (level: string) => string;
  exists: string;
  cancel: string;
  merging: string;
  mergeN: (n: number) => string;
  splitting: string;
  splitN: (n: number) => string;
  skipped: (n: number) => string;
}

type Mode = "merge" | "split";

/**
 * Merge other notes into the open one, or split the open note into one note per H1/H2 section next to it. A section
 * whose file already exists is skipped, never overwritten (desktop used to overwrite it before 2.3).
 */
export function NoteComposer({ api, labels }: { api: PluginApi; labels: ComposerLabels }) {
  const current = api.app.currentFile;
  const [content] = useState(() => api.editor.getContent() ?? "");
  const [mode, setMode] = useState<Mode>("merge");
  const [paths, setPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [addHeadings, setAddHeadings] = useState(true);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [level, setLevel] = useState<1 | 2>(2);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<Set<string>>(new Set());

  useEffect(() => {
    void listMarkdown(api.vault).then((all) => setPaths(all.filter((p) => p !== current).sort()));
  }, [api, current]);

  const sections = useMemo(() => (mode === "split" ? splitByHeadings(content, level) : []), [mode, content, level]);
  const folder = current ? folderOf(current) : "";

  useEffect(() => {
    if (mode !== "split") return;
    const targets = sections.map((s) => sectionPath(folder, s.title));
    void Promise.all(targets.map((p) => api.vault.exists(p))).then((flags) =>
      setTaken(new Set(targets.filter((_, i) => flags[i] || targets[i] === current)))
    );
  }, [api, mode, sections, folder, current]);

  const filtered = query.trim() ? paths.filter((p) => p.toLowerCase().includes(query.toLowerCase())) : paths;
  const toggle = (p: string) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  async function merge() {
    if (!selected.length || !current) return;
    setBusy(true);
    try {
      const contents = [];
      for (const p of selected) contents.push({ name: p.split("/").pop() ?? p, content: (await api.vault.read(p)) ?? "" });
      const latest = api.editor.getContent() ?? content;
      api.editor.setContent(latest.trimEnd() + "\n\n" + mergeNotes(contents, addHeadings));
      if (deleteAfter) for (const p of selected) await api.vault.delete(p);
      api.workspace.closeView();
    } finally {
      setBusy(false);
    }
  }

  async function split() {
    if (!current || sections.length <= 1) return;
    setBusy(true);
    try {
      let first: string | null = null;
      let skipped = 0;
      for (const section of sections) {
        const path = sectionPath(folder, section.title);
        if (path === current || (await api.vault.exists(path))) {
          skipped++;
          continue;
        }
        await api.vault.write(path, section.content + "\n");
        first ??= path;
      }
      if (skipped) api.ui.showNotice(labels.skipped(skipped));
      api.workspace.closeView();
      if (first) await api.workspace.openFile(first);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nc-modal" data-note-composer="">
      <div className="nc-header">
        <div className="nc-header-left">
          <h2 className="nc-title">{labels.title}</h2>
          <div className="nc-mode-toggle">
            <button className={`nc-mode-btn${mode === "merge" ? " nc-mode-active" : ""}`} onClick={() => setMode("merge")}>
              {labels.merge}
            </button>
            <button className={`nc-mode-btn${mode === "split" ? " nc-mode-active" : ""}`} onClick={() => setMode("split")}>
              {labels.split}
            </button>
          </div>
        </div>
        <button onClick={() => api.workspace.closeView()} className="nc-close-btn" aria-label={labels.cancel}>
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="nc-current-file">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span>{current ? noteTitle(current) : labels.noNote}</span>
      </div>

      <div className="nc-body">
        {mode === "merge" ? (
          <div className="nc-merge">
            <div className="nc-search-wrap">
              <svg width="14" height="14" viewBox="0 0 14 14" className="nc-search-icon">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={labels.searchMerge} className="nc-search-input" autoFocus />
              {selected.length > 0 && <span className="nc-selected-count">{labels.selected(selected.length)}</span>}
            </div>
            <div className="nc-file-list">
              {filtered.map((p) => {
                const on = selected.includes(p);
                return (
                  <button key={p} className={`nc-file-item${on ? " nc-file-selected" : ""}`} onClick={() => toggle(p)}>
                    <span className="nc-file-check">
                      {on && (
                        <svg width="12" height="12" viewBox="0 0 12 12">
                          <path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      )}
                    </span>
                    <span className="nc-file-name">{noteTitle(p)}</span>
                    <span className="nc-file-path">{p}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && <div className="nc-empty">{labels.noNotes}</div>}
            </div>
            <div className="nc-options">
              <label className="nc-option">
                <input type="checkbox" checked={addHeadings} onChange={(e) => setAddHeadings(e.target.checked)} />
                <span>{labels.addHeadings}</span>
              </label>
              <label className="nc-option">
                <input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} />
                <span className="nc-option-danger">{labels.deleteAfter}</span>
              </label>
            </div>
          </div>
        ) : (
          <div className="nc-split">
            <div className="nc-split-controls">
              <span className="nc-split-label">{labels.splitBy}</span>
              <div className="nc-split-level-toggle">
                {([1, 2] as const).map((l) => (
                  <button key={l} className={`nc-split-level-btn${level === l ? " nc-split-level-active" : ""}`} onClick={() => setLevel(l)}>
                    Heading H{l}
                  </button>
                ))}
              </div>
            </div>
            <div className="nc-split-preview">
              {sections.length <= 1 ? (
                <div className="nc-empty">{labels.noHeadings(`H${level}`)}</div>
              ) : (
                sections.map((section, i) => {
                  const path = sectionPath(folder, section.title);
                  return (
                    <div key={i} className="nc-split-section">
                      <div className="nc-split-section-header">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" />
                          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                        <span className="nc-split-section-title">{path.split("/").pop()}</span>
                        {taken.has(path) && <span className="nc-option-danger"> · {labels.exists}</span>}
                      </div>
                      <div className="nc-split-section-preview">
                        {section.content.slice(0, 200)}
                        {section.content.length > 200 ? "…" : ""}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div className="nc-footer">
        <button onClick={() => api.workspace.closeView()} className="nc-cancel-btn">
          {labels.cancel}
        </button>
        {mode === "merge" ? (
          <button onClick={() => void merge()} disabled={!selected.length || busy || !current} className="nc-action-btn">
            {busy ? labels.merging : labels.mergeN(selected.length)}
          </button>
        ) : (
          <button onClick={() => void split()} disabled={sections.length <= 1 || busy || !current} className="nc-action-btn">
            {busy ? labels.splitting : labels.splitN(sections.length - taken.size)}
          </button>
        )}
      </div>
    </div>
  );
}
