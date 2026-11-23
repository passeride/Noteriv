"use client";

import LauncherTabs, { type LauncherMode } from "./LauncherTabs";

import { useState, useEffect, useMemo, useRef } from "react";
import { loadVaultIndex } from "@/lib/vault-index";
import { isExcludedPath } from "@/lib/file-list";
import { excludedPatterns } from "@/lib/vault-prefs";
import { highlightPieces, type SearchLine } from "@/lib/vault-search";

interface QuickOpenFile {
  filePath: string;
  fileName: string;
  relativePath: string;
}

type ContentMatch = QuickOpenFile & { line: SearchLine };

interface QuickOpenProps {
  vaultPath: string;
  revision: string;
  onSelect: (filePath: string, line?: number) => void;
  onClose: () => void;
  onModeChange?: (mode: LauncherMode) => void;
}

let fileCache: { vault: string; revision: string; list: Promise<QuickOpenFile[]> } | undefined;

function listFiles(vaultPath: string, revision: string) {
  if (fileCache?.vault === vaultPath && fileCache.revision === revision) return fileCache.list;
  const list = window.electronAPI.listAllFiles(vaultPath).catch(error => {
    if (fileCache?.list === list) fileCache = undefined;
    throw error;
  });
  fileCache = { vault: vaultPath, revision, list };
  return list;
}

export default function QuickOpen({ vaultPath, revision, onSelect, onClose, onModeChange }: QuickOpenProps) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<QuickOpenFile[]>();
  const [aliases, setAliases] = useState<Map<string, string[]>>(new Map());
  const [content, setContent] = useState<{ term: string; revision: string; rows: ContentMatch[]; error: boolean }>();
  const [fileError, setFileError] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const term = query.trim();
  const excluded = JSON.stringify(excludedPatterns());

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    let active = true;
    const exclude = JSON.parse(excluded) as string[];
    void listFiles(vaultPath, revision).then(
      list => { if (active) { setFiles(list.filter(f => !isExcludedPath(f.relativePath, exclude))); setFileError(false); } },
      () => { if (active) setFileError(true); },
    );
    void loadVaultIndex(vaultPath).then(index => {
      if (active) setAliases(new Map(index.filter(n => n.aliases.length).map(n => [n.filePath, n.aliases])));
    });
    return () => { active = false; };
  }, [vaultPath, revision, excluded]);

  useEffect(() => {
    if (!term || !window.electronAPI) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const result = await window.electronAPI.searchVault(vaultPath, term, {
          quick: true,
          exclude: JSON.parse(excluded) as string[],
        });
        if (!active) return;
        const rows: ContentMatch[] = [];
        for (const file of result.files) {
          for (const line of file.lines) {
            rows.push({
              filePath: file.filePath, fileName: file.name.replace(/\.(md|markdown)$/i, ""),
              relativePath: file.relativePath, line,
            });
            if (rows.length >= 80) break;
          }
          if (rows.length >= 80) break;
        }
        setContent({ term, revision, rows, error: !!result.error });
      } catch {
        if (active) setContent({ term, revision, rows: [], error: true });
      }
    }, 110);
    return () => { active = false; clearTimeout(timer); };
  }, [term, vaultPath, revision, excluded]);

  const fileMatches = useMemo(() => {
    const lower = term.toLowerCase();
    return (files ?? []).flatMap<{ file: QuickOpenFile; rank: number; alias?: string }>(file => {
      const name = file.fileName.toLowerCase();
      const path = file.relativePath.toLowerCase();
      const alias = (aliases.get(file.filePath) ?? []).find(item => lower && item.toLowerCase().includes(lower));
      if (name.startsWith(lower)) return [{ file, rank: 3 }];
      if (name.includes(lower) || path.includes(lower)) return [{ file, rank: 2 }];
      return alias ? [{ file, rank: 1, alias }] : [];
    }).sort((a, b) => b.rank - a.rank).slice(0, 30);
  }, [files, term, aliases]);

  const activeContent = content?.term === term && content.revision === revision ? content : undefined;
  const rows = [
    ...fileMatches.map(match => ({ ...match, kind: "file" as const })),
    ...(term ? activeContent?.rows ?? [] : []).map(file => ({ file, kind: "content" as const })),
  ];
  const searchAvailable = typeof window !== "undefined" && !!window.electronAPI;
  const searching = searchAvailable && (!!term && !activeContent || !files && !fileError);
  const selected = Math.max(0, Math.min(selectedIdx, rows.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function choose(index: number) {
    const row = rows[index];
    if (!row) return;
    onSelect(row.file.filePath, row.kind === "content" ? row.file.line.line : undefined);
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
    if (event.key === "Enter") { event.preventDefault(); choose(selected); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIdx(Math.max(0, Math.min(rows.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1))));
    }
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Find files and contents" className="palette" onClick={event => event.stopPropagation()}>
        <div className="palette-input-wrap">
          <svg width="14" height="14" viewBox="0 0 14 14" className="palette-icon" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input ref={inputRef} value={query} className="palette-input" onKeyDown={handleKeyDown}
            aria-label="Search file names and contents" placeholder="Search file names and contents"
            onChange={event => { setQuery(event.target.value); setSelectedIdx(0); }} />
          {searching && <span className="palette-spinner" title="Searching the vault" />}
        </div>
        {onModeChange && <LauncherTabs mode="files" onChange={onModeChange} />}
        <div className="palette-list" ref={listRef}>
          {rows.map((row, index) => (
            <button key={row.kind === "file" ? "f:" + row.file.filePath : `c:${row.file.filePath}:${row.file.line.line}`}
              data-row={index}
              aria-label={(row.kind === "file" ? "File name match: " : "Content match in ") + row.file.fileName}
              className={`palette-item qo-row ${index === selected ? "palette-item-active" : ""}`}
              onClick={() => choose(index)} onMouseEnter={() => setSelectedIdx(index)}>
              <svg className="qo-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                {row.kind === "file" ? <path d="M3 1.7h6l4 4v8.6H3zM9 1.7v4h4" />
                  : <path d="M2 3.5h12M2 7h9M2 10.5h12M2 14h7" />}
              </svg>
              <span className="qo-details">
                <span className="palette-item-name">{row.file.fileName}</span>
                <span className="qo-path">
                  {row.kind === "file" && row.alias ? `also called ${row.alias} · ` : ""}
                  {row.file.relativePath}
                </span>
                {row.kind === "content" && (
                  <span className="qo-line">L{row.file.line.line} · {highlightPieces(row.file.line.text, row.file.line.ranges).map((piece, i) =>
                    piece.match ? <mark key={i} className="search-highlight">{piece.text}</mark> : <span key={i}>{piece.text}</span>
                  )}</span>
                )}
              </span>
            </button>
          ))}
          {(fileError || activeContent?.error) && <div className="palette-empty">Search could not be completed</div>}
          {!rows.length && !searching && !fileError && !activeContent?.error && <div className="palette-empty">No matches found</div>}
        </div>
      </div>
    </div>
  );
}
