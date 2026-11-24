"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteRef, NoteSearchHit, VaultAdapter } from "@noteriv/core/vault-adapter";
import {
  isPlainQuery,
  matchNote,
  parseSearch,
  prefilterTerms,
  replaceInText,
  replaceTarget,
  type SearchNode,
} from "@noteriv/core/search-query";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import { adapterNoteEditor, mapLimited, type NoteEditor } from "./note-edit";

export interface VaultSearchLabels {
  placeholder: string;
  noResults: string;
  /** Shown under `noResults`: what to try instead. */
  noResultsHint: string;
  hint: string;
}

const defaultLabels = (): VaultSearchLabels => ({
  placeholder: t("panels.vaultSearch.placeholder"),
  noResults: t("panels.vaultSearch.noResults"),
  noResultsHint: t("panels.vaultSearch.noResultsHint"),
  hint: t("panels.vaultSearch.hint"),
});

export interface VaultSearchProps {
  adapter: VaultAdapter;
  /** Opens the note, at `line` (1-based) when the result is a matching line. */
  onOpen: (ref: NoteRef, line?: number) => void;
  onClose: () => void;
  labels?: Partial<VaultSearchLabels>;
  /** Wait after the last keystroke before searching (ms). */
  debounceMs?: number;
  /** How "Replace" changes notes (through their open tabs). Default: straight through the adapter. */
  editNote?: NoteEditor;
}

interface Row {
  ref: NoteRef;
  line?: number;
  text: string;
}

/** One row per matching line (or per note when the backend gives no lines). */
function toRows(hits: NoteSearchHit[]): Row[] {
  const rows: Row[] = [];
  for (const h of hits) {
    if (h.matches && h.matches.length > 0) {
      for (const m of h.matches) rows.push({ ref: h.ref, line: m.line, text: m.text });
    } else {
      rows.push({ ref: h.ref, text: h.snippet.replace(/<\/?b>/g, "") });
    }
  }
  return rows;
}

/** Notes worth evaluating a query on: those containing a word every match needs, else every note. */
async function candidates(adapter: VaultAdapter, query: SearchNode): Promise<{ ref: NoteRef; content: string }[]> {
  const terms = prefilterTerms(query);
  const found = terms && adapter.notesContaining ? await adapter.notesContaining(terms) : null;
  if (found) return found;
  const read = await mapLimited(await adapter.listNotes(), 8, async (ref) => ({ ref, content: await adapter.readNote(ref.id) }));
  return read.filter((n): n is { ref: NoteRef; content: string } => n.content !== null);
}

/** A query with operators, evaluated here (the backend only knows plain words). */
/** Result rows shown at most (a broad query over a large vault would otherwise list thousands of lines). */
const MAX_ROWS = 500;

async function advancedSearch(adapter: VaultAdapter, query: SearchNode): Promise<{ rows: Row[]; notes: { ref: NoteRef; content: string }[] }> {
  const rows: Row[] = [];
  const notes: { ref: NoteRef; content: string }[] = [];
  for (const { ref, content } of await candidates(adapter, query)) {
    const m = matchNote(query, { path: ref.path, content });
    if (!m.matches) continue;
    notes.push({ ref, content });
    if (m.lines.length === 0) rows.push({ ref, text: ref.path });
    else for (const l of m.lines) rows.push({ ref, line: l.line, text: l.text });
  }
  rows.sort((a, b) => a.ref.path.localeCompare(b.ref.path) || (a.line ?? 0) - (b.line ?? 0));
  return { rows: rows.slice(0, MAX_ROWS), notes };
}

/**
 * Search across the vault as you type, results listed by matching line; Enter or a click opens the note at that line.
 * Plain words go to the adapter's ranked search (Postgres full-text on the web, a file scan on desktop); a query with
 * operators (OR, -, "…", /regex/, file:, path:, tag:, line:, [property]…) is evaluated here. "Replace" changes the
 * searched text in every matching note.
 */
export default function VaultSearch({ adapter, onOpen, onClose, labels, debounceMs = 250, editNote }: VaultSearchProps) {
  useLocale();
  const text = { ...defaultLabels(), ...labels };
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState("");
  /** After the first click of Replace: the notes it would change. */
  const [confirm, setConfirm] = useState<{ count: number; notes: NoteRef[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [rerun, setRerun] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const edit = useMemo(() => editNote ?? adapterNoteEditor(adapter), [editNote, adapter]);

  const parsed = useMemo(() => (query.trim() ? parseSearch(query.trim()) : null), [query]);
  const target = parsed && "query" in parsed ? replaceTarget(parsed.query) : null;
  const noteCount = useMemo(() => new Set(rows.map((r) => r.ref.id)).size, [rows]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A new query drops the last replace notice; the search run again after a replace keeps it.
  useEffect(() => setNotice(""), [query]);

  useEffect(() => {
    setConfirm(null);
    const q = query.trim();
    if (!q) {
      setRows([]);
      setSelected(0);
      setSearching(false);
      setError(null);
      return;
    }
    if (parsed && "error" in parsed) {
      seq.current++; // a search still on its way must not fill the list
      setRows([]);
      setSearching(false);
      setError(parsed.error);
      return;
    }
    setError(null);
    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const next = isPlainQuery(q) || !parsed || !("query" in parsed) ? toRows(await adapter.search(q)) : (await advancedSearch(adapter, parsed.query)).rows;
        if (mine !== seq.current) return; // a newer query is on its way
        setRows(next);
        setSelected(0);
      } catch {
        if (mine === seq.current) setRows([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, parsed, adapter, debounceMs, rerun]);

  useEffect(() => {
    const item = listRef.current?.children[selected] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const open = useCallback(
    (row: Row) => {
      onOpen(row.ref, row.line);
      onClose();
    },
    [onOpen, onClose]
  );

  /** Replaces the searched text in every note listed (checked again on each note's current text). */
  /**
   * First click: counts the notes the replacement would really change (every matching note, not only the rows shown,
   * which may be the backend's ranked top results) and asks again. Second click: replaces, checking each note's
   * current text again.
   */
  async function replaceAll() {
    if (!target || !parsed || !("query" in parsed) || busy) return;
    const query = parsed.query;
    setBusy(true);
    setNotice("");
    try {
      if (confirm === null) {
        const { notes } = await advancedSearch(adapter, query);
        const affected = notes.filter((n) => replaceInText(n.content, target, replacement) !== n.content).map((n) => n.ref);
        setConfirm({ count: affected.length, notes: affected });
        return;
      }
      const notes = confirm.notes;
      setConfirm(null);
      let changed = 0;
      let failed = 0;
      for (const ref of notes) {
        let wanted = false;
        try {
          const ok = await edit(ref.id, (body) => {
            if (!matchNote(query, { path: ref.path, content: body }).matches) return null;
            const next = replaceInText(body, target, replacement);
            if (next === body) return null;
            wanted = true;
            return next;
          });
          if (ok) changed++;
          else if (wanted) failed++; // changed elsewhere meanwhile: not written
        } catch {
          failed++;
        }
      }
      setNotice(failed > 0 ? t("panels.vaultSearch.replacedSome", { count: changed, failed }) : t("panels.vaultSearch.replaced", { count: changed }));
      setRerun((n) => n + 1);
    } catch {
      setNotice(t("panels.vaultSearch.replaceFailed"));
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[selected]) open(rows[selected]);
    }
  };

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter((w) => w && !w.includes(":") && w !== "or" && !w.startsWith("-")), [query]);
  const highlight = (line: string) => {
    const lower = line.toLowerCase();
    const term = terms.map((w) => w.replace(/^"|"$/g, "")).find((w) => w && lower.includes(w));
    if (!term) return line;
    const i = lower.indexOf(term);
    return (
      <>
        {line.slice(0, i)}
        <mark className="search-highlight">{line.slice(i, i + term.length)}</mark>
        {line.slice(i + term.length)}
      </>
    );
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette palette-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={text.placeholder}>
        <div className="palette-input-wrap">
          <svg width="14" height="14" viewBox="0 0 14 14" className="palette-icon" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={text.placeholder}
            className="palette-input"
          />
          {searching && <span className="palette-spinner" />}
          <button
            type="button"
            className={`search-replace-toggle ${replacing ? "search-replace-toggle-on" : ""}`}
            onClick={() => setReplacing((r) => !r)}
            title={t("panels.vaultSearch.replaceToggle")}
            aria-pressed={replacing}
          >
            {t("panels.vaultSearch.replace")}
          </button>
        </div>
        {replacing && (
          <div className="search-replace-row">
            <input
              type="text"
              value={replacement}
              onChange={(e) => {
                setReplacement(e.target.value);
                setConfirm(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
              }}
              placeholder={t("panels.vaultSearch.replacePlaceholder")}
              className="search-replace-input"
              aria-label={t("panels.vaultSearch.replacePlaceholder")}
            />
            <button
              type="button"
              className={`search-replace-btn ${confirm ? "search-replace-btn-confirm" : ""}`}
              disabled={!target || noteCount === 0 || searching || busy}
              onClick={() => void replaceAll()}
              title={target ? undefined : t("panels.vaultSearch.replaceNoTarget")}
            >
              {confirm ? t("panels.vaultSearch.replaceConfirm", { count: confirm.count }) : t("panels.vaultSearch.replaceAll")}
            </button>
          </div>
        )}
        {replacing && !target && query.trim() && <div className="search-replace-note">{t("panels.vaultSearch.replaceNoTarget")}</div>}
        {notice && (
          <div className="search-replace-note" role="status">
            {notice}
          </div>
        )}
        <div className="palette-list palette-list-tall" ref={listRef} role="listbox">
          {rows.map((r, i) => (
            <button
              key={`${r.ref.id}:${r.line ?? i}`}
              role="option"
              aria-selected={i === selected}
              className={`palette-item palette-search-item ${i === selected ? "palette-item-active" : ""}`}
              onClick={() => open(r)}
              onMouseEnter={() => setSelected(i)}
            >
              <div className="search-result-top">
                <span className="search-result-file">{r.ref.name.replace(/\.(md|markdown)$/i, "")}</span>
                {r.line !== undefined && <span className="search-result-line">:{r.line}</span>}
              </div>
              <div className="search-result-text">{highlight(r.text)}</div>
            </button>
          ))}
          {error && <div className="palette-empty">{t("panels.vaultSearch.invalid", { what: t(`panels.vaultSearch.errors.${error}`) })}</div>}
          {!error && !searching && query.trim() && rows.length === 0 && (
            <div className="palette-empty">
              {text.noResults}
              <div style={{ fontSize: "0.85em", opacity: 0.75, marginTop: 4 }}>{text.noResultsHint}</div>
            </div>
          )}
          {!query.trim() && <div className="palette-empty">{text.hint}</div>}
        </div>
      </div>
    </div>
  );
}
