import { useState, useEffect, useMemo, useCallback } from "react";
import type { NoteCommit, VaultApi } from "@noteriv/plugin-api";
import { diffStrings, type DiffLine } from "@noteriv/core/note-diff";
import type { HistoryLabels } from "./labels";

interface GitHistoryProps {
  vault: VaultApi;
  path: string;
  currentContent: string;
  onRestore: (content: string) => void;
  onClose: () => void;
  labels: HistoryLabels;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Git versions of one note: commit list and slider, line diff from the chosen version to now, restore. */
export function GitHistory({ vault, path, currentContent, onRestore, onClose, labels }: GitHistoryProps) {
  const [history, setHistory] = useState<NoteCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    vault
      .gitLog(path)
      .catch(() => [])
      .then((entries) => {
        if (cancelled) return;
        setHistory(entries);
        setSelectedIdx(0);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vault, path]);

  useEffect(() => {
    const entry = history[selectedIdx];
    if (!entry) return;
    let cancelled = false;
    setLoadingContent(true);
    vault
      .readAtCommit(path, entry.hash)
      .catch(() => null)
      .then((content) => {
        if (cancelled) return;
        setSelectedContent(content);
        setLoadingContent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedIdx, history, vault, path]);

  const diffLines = useMemo<DiffLine[]>(
    () => (selectedContent === null ? [] : diffStrings(selectedContent, currentContent)),
    [selectedContent, currentContent]
  );

  const handleRestore = useCallback(() => {
    if (selectedContent !== null) onRestore(selectedContent);
  }, [selectedContent, onRestore]);

  const selectedEntry = history[selectedIdx] || null;
  const addCount = diffLines.filter((d) => d.type === "add").length;
  const removeCount = diffLines.filter((d) => d.type === "remove").length;

  return (
    <div className="nh-overlay" onClick={onClose}>
      <div className="nh-modal" onClick={(e) => e.stopPropagation()} data-note-history="git">
        <div className="nh-header">
          <div className="nh-header-left">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M8 4v4l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span className="nh-title">{labels.gitTitle}</span>
            <span className="nh-file-name">{path.split("/").pop()?.replace(/\.(md|markdown)$/i, "") || ""}</span>
          </div>
          <button onClick={onClose} className="nh-close" title={labels.close} aria-label={labels.close}>
            <svg width="14" height="14" viewBox="0 0 12 12">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="nh-loading">
            <div className="nh-spinner" />
            <span>{labels.loadingHistory}</span>
          </div>
        ) : history.length === 0 ? (
          <div className="nh-empty">
            <span>{labels.gitEmpty}</span>
            <span className="nh-empty-hint">{labels.gitEmptyHint}</span>
          </div>
        ) : (
          <>
            <div className="nh-slider-wrap">
              <span className="nh-slider-label">{labels.oldest}</span>
              <input
                type="range"
                className="nh-slider"
                min={0}
                max={history.length - 1}
                value={history.length - 1 - selectedIdx}
                onChange={(e) => setSelectedIdx(history.length - 1 - parseInt(e.target.value, 10))}
              />
              <span className="nh-slider-label">{labels.latest}</span>
            </div>

            <div className="nh-body">
              <div className="nh-timeline">
                <div className="nh-timeline-header">{labels.commits}</div>
                <div className="nh-timeline-list">
                  {history.map((entry, idx) => (
                    <button
                      key={entry.hash}
                      className={`nh-commit${idx === selectedIdx ? " nh-commit-active" : ""}`}
                      onClick={() => setSelectedIdx(idx)}
                    >
                      <div className="nh-commit-dot" />
                      <div className="nh-commit-info">
                        <span className="nh-commit-msg">{entry.message || labels.noMessage}</span>
                        <span className="nh-commit-meta">
                          <span className="nh-commit-hash">{entry.hash.slice(0, 7)}</span>
                          <span className="nh-commit-date">{formatDate(entry.date)}</span>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="nh-diff">
                <div className="nh-diff-header">
                  <div className="nh-diff-info">
                    {selectedEntry && (
                      <>
                        <span className="nh-diff-title">{labels.changesFrom(selectedEntry.hash.slice(0, 7))}</span>
                        <span className="nh-diff-stats">
                          <span className="nh-stat-add">+{addCount}</span>
                          <span className="nh-stat-remove">-{removeCount}</span>
                        </span>
                      </>
                    )}
                  </div>
                  <button className="nh-restore-btn" onClick={handleRestore} disabled={selectedContent === null} title={labels.restoreHint}>
                    {labels.restore}
                  </button>
                </div>

                <div className="nh-diff-content">
                  {loadingContent ? (
                    <div className="nh-loading">
                      <div className="nh-spinner" />
                      <span>{labels.loadingVersion}</span>
                    </div>
                  ) : (
                    diffLines.map((dl, i) => (
                      <div key={i} className={`nh-diff-line nh-diff-${dl.type}`}>
                        <span className="nh-diff-prefix">{dl.type === "add" ? "+" : dl.type === "remove" ? "-" : " "}</span>
                        <span className="nh-diff-text">{dl.text || " "}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
