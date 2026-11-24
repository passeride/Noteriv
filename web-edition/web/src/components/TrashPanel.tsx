"use client";

import { useState, useEffect, useCallback } from "react";
import { useEscapeClose } from "@noteriv/ui/hooks";
import { webApi, type ApiTrashedItem } from "@/lib/webApi";
import { formatDate as formatIntl, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

interface TrashPanelProps {
  vaultId: string;
  onClose: () => void;
  onRestored?: () => void;
}

interface Row extends ApiTrashedItem {
  kind: "note" | "folder";
}

const TRASH_RETENTION_DAYS = 30;

export default function TrashPanel({ vaultId, onClose, onRestored }: TrashPanelProps) {
  useLocale();
  useEscapeClose(onClose);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const trash = await webApi.trash.list(vaultId);
    const combined: Row[] = [
      ...trash.folders.map((f) => ({ ...f, kind: "folder" as const })),
      ...trash.notes.map((n) => ({ ...n, kind: "note" as const })),
    ].sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
    setRows(combined);
    setLoading(false);
  }, [vaultId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRestore = useCallback(
    async (row: Row) => {
      if (row.kind === "note") await webApi.trash.restoreNote(vaultId, row.id);
      else await webApi.trash.restoreFolder(vaultId, row.id);
      await refresh();
      onRestored?.();
    },
    [vaultId, refresh, onRestored]
  );

  const handlePermanentDelete = useCallback(
    async (row: Row) => {
      if (row.kind === "note") await webApi.trash.deleteNote(vaultId, row.id);
      else await webApi.trash.deleteFolder(vaultId, row.id);
      await refresh();
    },
    [vaultId, refresh]
  );

  const handleEmptyTrash = useCallback(async () => {
    await webApi.trash.empty(vaultId);
    await refresh();
  }, [vaultId, refresh]);

  const filtered = rows.filter((row) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return row.name.toLowerCase().includes(q) || row.path.toLowerCase().includes(q);
  });

  const getDaysRemaining = (deletedAt: string): number => {
    const deleted = new Date(deletedAt).getTime();
    const expiry = deleted + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000)));
  };

  const formatDate = (iso: string): string => {
    try {
      return formatIntl(new Date(iso), {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="trash-overlay" onClick={onClose}>
      <div className="trash-panel" onClick={(e) => e.stopPropagation()}>
        <div className="trash-header">
          <div className="trash-header-left">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 4h10M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M8 7v5M10 7v5M4 4l.5 9a1 1 0 001 1h5a1 1 0 001-1L12 4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <h2>{t("trash.title")}</h2>
            <span className="trash-count">
              {t("trash.count", { count: rows.length })}
            </span>
          </div>
          <div className="trash-header-right">
            {rows.length > 0 && (
              <button className="trash-empty-btn" onClick={handleEmptyTrash}>
                {t("trash.empty")}
              </button>
            )}
            <button className="trash-close-btn" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="trash-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("trash.filter")}
            className="trash-search-input"
            autoFocus
          />
        </div>

        <div className="trash-list">
          {loading ? (
            <div className="trash-empty-state">{t("trash.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="trash-empty-state">{rows.length === 0 ? t("trash.isEmpty") : t("trash.noMatches")}</div>
          ) : (
            filtered.map((row) => (
              <div key={`${row.kind}:${row.id}`} className="trash-item">
                <div className="trash-item-info">
                  <div className="trash-item-name">
                    {row.kind === "folder" ? "📁 " : ""}
                    {row.name}
                  </div>
                  <div className="trash-item-meta">
                    <span className="trash-item-path">{row.path}</span>
                    <span className="trash-item-date">{formatDate(row.deletedAt)}</span>
                    <span className="trash-item-days">{t("trash.remaining", { count: getDaysRemaining(row.deletedAt) })}</span>
                  </div>
                </div>
                <div className="trash-item-actions">
                  <button className="trash-action-btn trash-restore-btn" onClick={() => handleRestore(row)} title={t("trash.restore")}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8a6 6 0 0110.5-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      <path d="M12 2v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14 8a6 6 0 01-10.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button className="trash-action-btn trash-delete-btn" onClick={() => handlePermanentDelete(row)} title={t("trash.deleteForever")}>
                    <svg width="14" height="14" viewBox="0 0 14 14">
                      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="trash-footer">{t("trash.footer", { days: TRASH_RETENTION_DAYS })}</div>
      </div>
    </div>
  );
}
