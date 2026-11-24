"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { NoteRef } from "@noteriv/core/vault-adapter";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";

export interface QuickOpenLabels {
  placeholder: string;
  empty: string;
}

const defaultLabels = (): QuickOpenLabels => ({ placeholder: t("panels.quickOpen.placeholder"), empty: t("panels.quickOpen.empty") });

export interface QuickOpenProps {
  /** Lists what can be opened. The host decides: the web app lists notes, the desktop app every file. */
  load: () => Promise<NoteRef[]>;
  onSelect: (id: string) => void;
  onClose: () => void;
  labels?: Partial<QuickOpenLabels>;
}

export default function QuickOpen({ load, onSelect, onClose, labels }: QuickOpenProps) {
  useLocale();
  const text = { ...defaultLabels(), ...labels };
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteRef[]>([]);
  const [filtered, setFiltered] = useState<NoteRef[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load all notes on mount
  useEffect(() => {
    let cancelled = false;
    load().then((entries) => {
      if (!cancelled) setNotes(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Filter notes as query changes
  useEffect(() => {
    if (!query.trim()) {
      setFiltered(notes.slice(0, 50));
      setSelectedIdx(0);
      return;
    }
    const lower = query.toLowerCase();
    const matches = notes
      .filter((n) => n.name.toLowerCase().includes(lower) || n.path.toLowerCase().includes(lower))
      .slice(0, 50);
    setFiltered(matches);
    setSelectedIdx(0);
  }, [query, notes]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIdx] as HTMLElement;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIdx]) {
          onSelect(filtered[selectedIdx].id);
          onClose();
        }
      }
    },
    [filtered, selectedIdx, onSelect, onClose]
  );

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <svg width="14" height="14" viewBox="0 0 14 14" className="palette-icon">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={text.placeholder}
            className="palette-input"
          />
        </div>

        <div className="palette-list" ref={listRef}>
          {filtered.map((n, i) => (
            <button
              key={n.id}
              className={`palette-item ${i === selectedIdx ? "palette-item-active" : ""}`}
              onClick={() => { onSelect(n.id); onClose(); }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="palette-item-name">{n.name}</span>
              <span className="palette-item-path">{n.path.replace(/\.(md|markdown)$/i, "")}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="palette-empty">{text.empty}</div>}
        </div>
      </div>
    </div>
  );
}
