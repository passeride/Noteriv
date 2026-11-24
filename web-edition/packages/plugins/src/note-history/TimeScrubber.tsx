import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { MarkdownApi, VaultApi } from "@noteriv/plugin-api";
import type { HistoryLabels } from "./labels";

interface TimeScrubberProps {
  vault: VaultApi;
  markdown: MarkdownApi;
  path: string;
  currentContent: string;
  onRestore: (content: string) => void;
  onClose: () => void;
  labels: HistoryLabels;
}

interface Frame {
  timestamp: number;
  /** null: the live "now" frame. */
  snapshotId: string | null;
}

function formatWhen(ts: number, ago: HistoryLabels["ago"]): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 10) return ago.justNow;
  if (sec < 60) return ago.seconds(sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return ago.minutes(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return ago.hours(hr);
  const day = Math.floor(hr / 24);
  if (day < 7) return ago.days(day);
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatFull(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Snapshot timeline of one note, oldest to now: step, play, preview read-only, restore. */
export function TimeScrubber({ vault, markdown, path, currentContent, onRestore, onClose, labels }: TimeScrubberProps) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [idx, setIdx] = useState(0);
  const [preview, setPreview] = useState<string>(currentContent);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const loadSeq = useRef(0);
  const previewEl = useRef<HTMLDivElement>(null);

  // Content is captured when the scrubber opens (`currentContent` does not change while it is open).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    vault
      .snapshots(path)
      .catch(() => [])
      .then((snaps) => {
        if (cancelled) return;
        const all: Frame[] = [
          ...[...snaps].reverse().map((s) => ({ timestamp: s.timestamp, snapshotId: s.id })),
          { timestamp: Date.now(), snapshotId: null },
        ];
        setFrames(all);
        setIdx(all.length - 1);
        setPreview(currentContent);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vault, path, currentContent]);

  // Escape is the host's (it closes the view); the arrows and Space are ours.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(frames.length - 1, i + 1));
      else if (e.key === " ") setPlaying((p) => !p);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [frames.length]);

  useEffect(() => {
    const frame = frames[idx];
    if (!frame) return;
    if (frame.snapshotId === null) {
      setPreview(currentContent);
      return;
    }
    const seq = ++loadSeq.current;
    vault
      .readSnapshot(path, frame.snapshotId)
      .catch(() => null)
      .then((content) => {
        if (seq === loadSeq.current) setPreview(content ?? "");
      });
  }, [idx, frames, currentContent, vault, path]);

  useEffect(() => {
    if (!playing) return;
    if (idx >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx((i) => Math.min(frames.length - 1, i + 1)), 450);
    return () => clearTimeout(t);
  }, [playing, idx, frames.length]);

  const showPreview = !loading && frames.length > 1;
  useEffect(() => {
    const el = previewEl.current;
    if (!showPreview || !el) return;
    // Each render gets its own element: the host may still be tearing down the previous one.
    const slot = document.createElement("div");
    el.appendChild(slot);
    const cleanup = markdown.renderReadOnly(preview, slot);
    return () => {
      cleanup();
      setTimeout(() => slot.remove(), 0);
    };
  }, [preview, showPreview, markdown]);

  const current = frames[idx];
  const isLive = current?.snapshotId === null;

  const handleRestore = useCallback(() => {
    if (!current || isLive) return;
    onRestore(preview);
  }, [current, isLive, preview, onRestore]);

  const sliderMax = Math.max(0, frames.length - 1);
  const ticks = useMemo(
    () => (frames.length <= 1 ? [] : frames.map((f, i) => ({ left: (i / (frames.length - 1)) * 100, isLive: f.snapshotId === null }))),
    [frames]
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)]" data-note-history="scrubber">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3 min-w-0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[var(--accent)] shrink-0">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 4v4l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{labels.scrubberTitle}</div>
            <div className="text-[11px] text-[var(--text-muted)] truncate">{path.split("/").pop()}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          title={`${labels.close} (Esc)`}
          aria-label={labels.close}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">{labels.loadingSnapshots}</div>
        ) : frames.length <= 1 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
            <div className="text-sm text-[var(--text-primary)]">{labels.scrubberEmpty}</div>
            <div className="text-xs text-[var(--text-muted)] max-w-md">{labels.scrubberEmptyHint}</div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-8 py-6" ref={previewEl} data-scrubber-preview />
        )}
      </div>

      {frames.length > 1 && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] px-5 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (idx >= frames.length - 1) setIdx(0);
                setPlaying((p) => !p);
              }}
              className="p-2 rounded-full bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-90 shrink-0"
              title={playing ? labels.pause : labels.play}
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="4" y="3" width="3" height="10" />
                  <rect x="9" y="3" width="3" height="10" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 3v10l9-5z" />
                </svg>
              )}
            </button>

            <div className="shrink-0 min-w-[140px]">
              <div className="text-xs font-medium text-[var(--text-primary)]">
                {isLive ? labels.now : formatWhen(current?.timestamp ?? 0, labels.ago)}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] truncate">{current ? formatFull(current.timestamp) : ""}</div>
            </div>

            <div className="flex-1 relative h-8 flex items-center">
              <div className="absolute inset-x-0 h-1 bg-[var(--border)] rounded-full" />
              <div
                className="absolute h-1 bg-[var(--accent)] rounded-full"
                style={{ width: `${sliderMax === 0 ? 0 : (idx / sliderMax) * 100}%` }}
              />
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className={`absolute w-0.5 h-2 rounded-full ${
                    t.isLive ? "bg-[var(--green)]" : i === idx ? "bg-[var(--accent)]" : "bg-[var(--text-muted)] opacity-40"
                  }`}
                  style={{ left: `calc(${t.left}% - 1px)` }}
                />
              ))}
              <input
                type="range"
                min={0}
                max={sliderMax}
                value={idx}
                onChange={(e) => {
                  setPlaying(false);
                  setIdx(parseInt(e.target.value, 10));
                }}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
              />
              <div
                className="absolute w-3 h-3 rounded-full bg-[var(--accent)] border-2 border-[var(--bg-secondary)] pointer-events-none shadow"
                style={{ left: `calc(${sliderMax === 0 ? 0 : (idx / sliderMax) * 100}% - 6px)` }}
              />
            </div>

            <div className="shrink-0 text-[11px] text-[var(--text-muted)] tabular-nums">
              {idx + 1} / {frames.length}
            </div>

            <button
              onClick={handleRestore}
              disabled={isLive}
              className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
              title={isLive ? labels.isCurrent : labels.restore}
              data-scrubber-restore
            >
              {labels.restore}
            </button>
          </div>

          <div className="mt-2 text-[10px] text-[var(--text-muted)] text-center">{labels.keysHint}</div>
        </div>
      )}
    </div>
  );
}
