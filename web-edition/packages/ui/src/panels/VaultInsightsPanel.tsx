import React, { useEffect, useState, useMemo } from "react";
import type { VaultAdapter, NoteRef, VaultGraphAnalysis, SmartLinkSuggestion } from "@noteriv/core";
import { analyzeVaultGraph, suggestSmartLinks } from "@noteriv/core";

export interface VaultInsightsPanelProps {
  adapter: VaultAdapter;
  notes: NoteRef[];
  activeNotePath?: string | null;
  activeNoteContent?: string | null;
  onOpenNote?: (path: string) => void;
  onAskAi?: (prompt: string) => void;
}

export const VaultInsightsPanel: React.FC<VaultInsightsPanelProps> = ({
  adapter,
  notes,
  activeNotePath,
  activeNoteContent,
  onOpenNote,
  onAskAi,
}) => {
  const [contentsMap, setContentsMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadAllContents() {
      if (notes.length === 0) return;
      setLoading(true);
      const map = new Map<string, string>();
      // Load up to 200 notes for fast graph analysis
      const batch = notes.slice(0, 200);
      await Promise.all(
        batch.map(async (n) => {
          try {
            const text = await adapter.readNote(n.id);
            if (text && !cancelled) {
              map.set(n.id, text);
            }
          } catch {}
        })
      );
      if (!cancelled) {
        setContentsMap(map);
        setLoading(false);
      }
    }
    loadAllContents();
    return () => {
      cancelled = true;
    };
  }, [adapter, notes]);

  const analysis: VaultGraphAnalysis = useMemo(() => {
    return analyzeVaultGraph(notes, contentsMap, 5);
  }, [notes, contentsMap]);

  const suggestions: SmartLinkSuggestion[] = useMemo(() => {
    if (!activeNotePath || !activeNoteContent) return [];
    return suggestSmartLinks(activeNotePath, activeNoteContent, notes, contentsMap, 6);
  }, [activeNotePath, activeNoteContent, notes, contentsMap]);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs text-[var(--text-primary)]">
      {/* Knowledge Health Overview Cards */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
            📊 Sức khỏe Tri thức Vault
          </span>
          {loading && <span className="text-[10px] text-[var(--text-muted)] animate-pulse">Đang phân tích...</span>}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex flex-col">
            <span className="text-[10px] text-[var(--text-secondary)]">Tổng ghi chú</span>
            <span className="text-base font-bold text-[var(--text-primary)] mt-0.5">{analysis.totalNotes}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex flex-col">
            <span className="text-[10px] text-[var(--text-secondary)]">Liên kết 2 chiều</span>
            <span className="text-base font-bold text-emerald-400 mt-0.5">{analysis.totalEdges}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex flex-col">
            <span className="text-[10px] text-[var(--text-secondary)]">Độ kết nối</span>
            <span className="text-base font-bold text-blue-400 mt-0.5">{analysis.connectivityRatio}%</span>
          </div>
        </div>
      </div>

      {/* Smart Link Suggestions for Active Note */}
      <div className="space-y-2">
        <div className="font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
          <span>💡 Gợi ý liên kết thông minh</span>
          {activeNotePath && (
            <span className="text-[10px] font-normal text-[var(--text-muted)] truncate">
              ({activeNotePath.split("/").pop()})
            </span>
          )}
        </div>

        {!activeNotePath ? (
          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
            Hãy mở một ghi chú để AI tự động quét và đề xuất các liên kết tiềm năng.
          </div>
        ) : suggestions.length === 0 ? (
          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
            Chưa phát hiện liên kết tiềm năng mới nào cho ghi chú hiện tại.
          </div>
        ) : (
          <div className="space-y-1.5">
            {suggestions.map((s) => (
              <div
                key={s.targetNote.id}
                className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--interactive-accent, #3b82f6)] transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenNote?.(s.targetNote.path)}
                    className="font-semibold text-xs text-[var(--interactive-accent, #3b82f6)] hover:underline truncate text-left"
                  >
                    📄 [[{s.targetTitle}]]
                  </button>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-modifier-hover)] text-[var(--text-secondary)] shrink-0">
                    {s.reason === "unlinked-mention" ? "Đề cập trực tiếp" : `Cùng thẻ ${s.matchedTerm}`}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{s.description}</p>
                {onAskAi && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskAi(
                        `Hãy phân tích mối liên hệ giữa ghi chú đang mở và [[${s.targetTitle}]], đồng thời gợi ý đoạn văn kết nối 2 bài viết này.`
                      )
                    }
                    className="text-[11px] font-medium text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    <span>✨ Nhờ AI tổng hợp điểm chung</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hub Notes (Knowledge Centers) */}
      <div className="space-y-2">
        <div className="font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
          🌟 Trung tâm tri thức (Hub Notes)
        </div>
        {analysis.hubNotes.length === 0 ? (
          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
            Chưa có ghi chú nào được liên kết. Hãy dùng cú pháp [[Tên ghi chú]] để kết nối mạng lưới.
          </div>
        ) : (
          <div className="space-y-1">
            {analysis.hubNotes.map(({ note, connections }) => (
              <button
                key={note.id}
                type="button"
                onClick={() => onOpenNote?.(note.path)}
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-modifier-hover)] border border-[var(--border-subtle)] flex items-center justify-between text-left"
              >
                <span className="truncate font-medium">📄 {note.name.replace(/\.md$/i, "")}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold shrink-0">
                  {connections} liên kết
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Orphan Notes (Knowledge Gaps) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
            ⚠️ Ghi chú cô lập ({analysis.orphanNotes.length})
          </span>
          {analysis.orphanNotes.length > 0 && onAskAi && (
            <button
              type="button"
              onClick={() =>
                onAskAi(
                  `Vault của tôi hiện có ${analysis.orphanNotes.length} ghi chú cô lập chưa được liên kết: ${analysis.orphanNotes
                    .slice(0, 10)
                    .map((n) => `[[${n.name.replace(/\.md$/i, "")}]]`)
                    .join(", ")}. Hãy gợi ý cách phân nhóm và liên kết chúng vào mạng lưới kiến thức chung.`
                )
              }
              className="text-[10px] font-medium text-[var(--interactive-accent, #3b82f6)] hover:underline"
            >
              ✨ Nhờ AI gợi ý kết nối
            </button>
          )}
        </div>
        {analysis.orphanNotes.length === 0 ? (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
            Tuyệt vời! Toàn bộ ghi chú trong Vault đều đã được kết nối.
          </div>
        ) : (
          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
            {analysis.orphanNotes.slice(0, 15).map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => onOpenNote?.(note.path)}
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-modifier-hover)] border border-[var(--border-subtle)] flex items-center justify-between text-left"
              >
                <span className="truncate text-[var(--text-secondary)]">📄 {note.path}</span>
                <span className="text-[10px] text-amber-400 shrink-0">0 link</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VaultInsightsPanel;
