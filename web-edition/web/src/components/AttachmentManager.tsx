"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { webApi, isEmailUnverified, type ApiAttachment } from "@/lib/webApi";
import { planLimitText, UPGRADE_MAILTO } from "@/lib/plan";
import { getAttachmentType, formatFileSize, markdownLinkForAttachment, type AttachmentType } from "@/lib/attachment-utils";
import "@/styles/attachments.css";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

interface AttachmentManagerProps {
  vaultId: string;
  onInsert: (markdownLink: string) => void;
  onClose: () => void;
  /**
   * Opens an attachment in a core plugin's viewer (the PDF viewer…) when one handles it; returns false otherwise, and
   * the click inserts a link as for any other file. The host shows the viewer above this dialog.
   */
  onView?: (attachment: ApiAttachment) => boolean;
  /** A viewer opened from here is on screen: Escape is its own, not this dialog's. */
  viewerOpen?: boolean;
}

type FilterType = "all" | AttachmentType;
type SortField = "name" | "date";

/**
 * Web port of desktop/src/components/AttachmentManager.tsx. Desktop reads
 * files straight off the vault's attachments/ folder via electronAPI; this
 * version talks to the server's object-storage-backed attachments endpoint
 * (web/server/src/lib/attachments.ts, Garage/S3-compatible, see that file's
 * comment for why it isn't MinIO) — metadata + a hard per-vault quota come
 * back together from GET /vaults/:id/attachments.
 */
export default function AttachmentManager({ vaultId, onInsert, onClose, onView, viewerOpen = false }: AttachmentManagerProps) {
  useLocale();
  const [attachments, setAttachments] = useState<ApiAttachment[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  // The vault owner's whole-account limit; null = no limit.
  const [quotaBytes, setQuotaBytes] = useState<number | null>(null);
  // Set when the last upload hit the plan's storage limit: the message then offers the contact link.
  const [overPlan, setOverPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortField>("name");
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await webApi.attachments.list(vaultId);
      setAttachments(res.attachments);
      setUsedBytes(res.usedBytes);
      setQuotaBytes(res.quotaBytes);
    } catch {
      setAttachments([]);
    }
    setLoading(false);
  }, [vaultId]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setImporting(true);
      setError(null);
      setOverPlan(false);
      try {
        for (const file of files) {
          await webApi.attachments.upload(vaultId, file);
        }
        await load();
      } catch (err) {
        const apiErr = err as { body?: { message?: string } };
        const overLimit = planLimitText(err);
        setOverPlan(!!overLimit);
        setError(
          overLimit ?? (isEmailUnverified(err) ? t("web.account.verifyFirst") : (apiErr?.body?.message ?? t("web.attachments.uploadFailed")))
        );
      }
      setImporting(false);
    },
    [vaultId, load]
  );

  const filtered = attachments
    .filter((a) => filter === "all" || getAttachmentType(a.filename) === filter)
    .sort((a, b) => {
      if (sortBy === "name") return a.filename.localeCompare(b.filename);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const imageItems = filtered.filter((a) => getAttachmentType(a.filename) === "image");
  const nonImageItems = filtered.filter((a) => getAttachmentType(a.filename) !== "image");

  const counts = attachments.reduce((acc, a) => {
    const t = getAttachmentType(a.filename);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const handleInsert = useCallback(
    (a: ApiAttachment) => {
      const url = webApi.attachments.downloadUrl(vaultId, a.id);
      onInsert(markdownLinkForAttachment(a.filename, getAttachmentType(a.filename), url));
      onClose();
    },
    [vaultId, onInsert, onClose]
  );

  const handleDeleteClick = useCallback(
    async (e: React.MouseEvent, a: ApiAttachment) => {
      e.stopPropagation();
      if (confirmingDeleteId !== a.id) {
        setConfirmingDeleteId(a.id);
        return;
      }
      setConfirmingDeleteId(null);
      await webApi.attachments.remove(vaultId, a.id);
      setAttachments((prev) => prev.filter((x) => x.id !== a.id));
      setUsedBytes((prev) => Math.max(0, prev - a.size));
    },
    [vaultId, confirmingDeleteId]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;
      uploadFiles(Array.from(e.dataTransfer.files));
    },
    [uploadFiles]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // While a viewer opened from here is on screen, its own Escape handler closes just the viewer: this one must
      // not also close the whole dialog on the same keypress.
      if (e.key === "Escape" && !viewerOpen) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, viewerOpen]);

  const usedPct = quotaBytes ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;

  return (
    <>
    <div className="am-overlay" onClick={onClose}>
      <div className="am-modal" onClick={(e) => e.stopPropagation()}>
        <div className="am-header">
          <span className="am-title">{t("attachments.title")}</span>
          <button className="am-close-btn" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "4px 14px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            <span>
              {quotaBytes === null
                ? t("web.attachments.usedNoLimit", { used: formatFileSize(usedBytes) })
                : t("web.attachments.used", { used: formatFileSize(usedBytes), quota: formatFileSize(quotaBytes) })}
            </span>
            {usedPct > 85 && <span style={{ color: "var(--error, #e06c75)" }}>{t("web.attachments.nearlyFull")}</span>}
          </div>
          <div style={{ height: 4, borderRadius: 2, background: "var(--bg-tertiary)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${usedPct}%`,
                background: usedPct > 85 ? "var(--error, #e06c75)" : "var(--accent)",
                transition: "width 0.2s",
              }}
            />
          </div>
          {error && (
            <div style={{ color: "var(--error, #e06c75)", fontSize: 11, marginTop: 4 }}>
              {error}
              {overPlan && (
                <>
                  {" "}
                  <a href={UPGRADE_MAILTO} style={{ color: "var(--accent)" }}>
                    {t("web.plan.needMore")}
                  </a>
                </>
              )}
            </div>
          )}
        </div>

        <div className="am-toolbar">
          <button className={`am-filter-btn${filter === "all" ? " am-filter-btn-active" : ""}`} onClick={() => setFilter("all")}>
            {t("attachments.filter.all", { count: attachments.length })}
          </button>
          {(counts.image ?? 0) > 0 && (
            <button className={`am-filter-btn${filter === "image" ? " am-filter-btn-active" : ""}`} onClick={() => setFilter("image")}>
              {t("attachments.filter.image", { count: counts.image ?? 0 })}
            </button>
          )}
          {(counts.audio ?? 0) > 0 && (
            <button className={`am-filter-btn${filter === "audio" ? " am-filter-btn-active" : ""}`} onClick={() => setFilter("audio")}>
              {t("attachments.filter.audio", { count: counts.audio ?? 0 })}
            </button>
          )}
          {(counts.video ?? 0) > 0 && (
            <button className={`am-filter-btn${filter === "video" ? " am-filter-btn-active" : ""}`} onClick={() => setFilter("video")}>
              {t("attachments.filter.video", { count: counts.video ?? 0 })}
            </button>
          )}
          {(counts.pdf ?? 0) > 0 && (
            <button className={`am-filter-btn${filter === "pdf" ? " am-filter-btn-active" : ""}`} onClick={() => setFilter("pdf")}>
              {t("attachments.filter.pdf", { count: counts.pdf ?? 0 })}
            </button>
          )}
          {(counts.other ?? 0) > 0 && (
            <button className={`am-filter-btn${filter === "other" ? " am-filter-btn-active" : ""}`} onClick={() => setFilter("other")}>
              {t("attachments.filter.other", { count: counts.other ?? 0 })}
            </button>
          )}
          <div className="am-toolbar-spacer" />
          <button className="am-sort-btn" onClick={() => setSortBy((s) => (s === "name" ? "date" : "name"))}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 3H10M3 6H9M4 9H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {sortBy === "name" ? t("attachments.sortName") : t("attachments.sortDate")}
          </button>
        </div>

        <div className="am-content" onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
          {loading ? (
            <div className="am-loading">{t("attachments.loading")}</div>
          ) : (
            <>
              <div className={`am-dropzone${isDragging ? " am-dropzone-active" : ""}`} onClick={() => fileInputRef.current?.click()}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="am-dropzone-icon">
                  <path d="M12 16V8M12 8L9 11M12 8L15 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 16.7V17.8C20 18.9 19.1 19.8 18 19.8H6C4.9 19.8 4 18.9 4 17.8V16.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="am-dropzone-text">
                  {importing ? t("attachments.importing") : isDragging ? t("attachments.dropHere") : t("attachments.dragHint.web")}
                </span>
                <span className="am-dropzone-hint">{t("web.attachments.maxSize")}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files) uploadFiles(Array.from(e.target.files));
                    e.target.value = "";
                  }}
                />
              </div>

              {filtered.length === 0 && !isDragging ? (
                <div className="am-empty">
                  <span className="am-empty-title">{filter === "all" ? t("attachments.empty") : t("attachments.noneOfType", { type: filter })}</span>
                  <span className="am-empty-desc">{t("attachments.emptyHint.web")}</span>
                </div>
              ) : (
                <>
                  {imageItems.length > 0 && (filter === "all" || filter === "image") && (
                    <div className="am-grid">
                      {imageItems.map((a) => (
                        <div key={a.id} className="am-grid-item" onClick={() => handleInsert(a)} title={t("attachments.clickInsert", { name: a.filename })}>
                          <button className="am-delete-btn" onClick={(e) => handleDeleteClick(e, a)} title={confirmingDeleteId === a.id ? t("web.attachments.deleteConfirm") : t("attachments.delete")}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 2L10 10M10 2L2 10" stroke={confirmingDeleteId === a.id ? "var(--error, #e06c75)" : "currentColor"} strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                          </button>
                          <div className="am-grid-thumb-wrap">
                            <img className="am-grid-thumb" src={webApi.attachments.downloadUrl(vaultId, a.id)} alt={a.filename} loading="lazy" />
                          </div>
                          <span className="am-grid-name">{a.filename}</span>
                          <span className="am-grid-size">{formatFileSize(a.size)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {nonImageItems.length > 0 && (
                    <div className="am-list">
                      {nonImageItems.map((a) => {
                        const type = getAttachmentType(a.filename);
                        const isPdf = type === "pdf" && !!onView;
                        return (
                          <div
                            key={a.id}
                            className="am-list-item"
                            onClick={() => {
                              if (!onView?.(a)) handleInsert(a);
                            }}
                            title={isPdf ? t("web.attachments.clickView", { name: a.filename }) : t("attachments.clickInsert", { name: a.filename })}
                          >
                            <div className="am-list-info">
                              <span className="am-list-name">{a.filename}</span>
                              <div className="am-list-meta">
                                <span className="am-list-type-badge">{type}</span>
                                <span>{formatFileSize(a.size)}</span>
                              </div>
                            </div>
                            <button className="am-delete-btn" onClick={(e) => handleDeleteClick(e, a)} title={confirmingDeleteId === a.id ? t("web.attachments.deleteConfirm") : t("attachments.delete")}>
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 2L10 10M10 2L2 10" stroke={confirmingDeleteId === a.id ? "var(--error, #e06c75)" : "currentColor"} strokeWidth="1.3" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="am-footer">
          <span className="am-footer-count">
            {t("attachments.count", { count: filtered.length })}{filter !== "all" ? ` (${filter})` : ""}
          </span>
          <div className="am-footer-hint">
            <span><span className="am-footer-key">Click</span> {filter === "pdf" ? t("web.attachments.footerView") : t("attachments.footerInsert")}</span>
            <span><span className="am-footer-key">Esc</span> {t("attachments.footerClose")}</span>
          </div>
        </div>
      </div>
    </div>

    </>
  );
}
