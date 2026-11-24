"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { generatePublishHTML } from "@noteriv/core/publish";
import { webApi, type VaultIndex } from "@/lib/webApi";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

interface PublishPreviewProps {
  vaultId: string;
  index: VaultIndex | null;
  content: string;
  title: string;
  currentNoteId: string | null;
  onClose: () => void;
}

/**
 * Ported from desktop/src/components/PublishPreview.tsx (Phase D10 — static
 * HTML export, distinct from the PDF export shipped in Phase 6). Desktop's
 * multi-note picker read from the filesystem via electronAPI; here it reads
 * from the already-loaded vault `index` + webApi.notes.get, matching the
 * N+1-fetch pattern established since Phase 2/6. The save-dialog +
 * electronAPI.writeFile flow has no web equivalent — "Save as HTML" instead
 * triggers a normal browser download via a Blob + <a download> anchor.
 */
export default function PublishPreview({ vaultId, index, content, title, currentNoteId, onClose }: PublishPreviewProps) {
  useLocale();
  const [html, setHtml] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Multi-note selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergedContent, setMergedContent] = useState(content);
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const allNotes = (index?.notes ?? []).filter((n) => n.id !== currentNoteId);

  // Rebuild merged content when selection changes
  useEffect(() => {
    let cancelled = false;
    async function merge() {
      if (selectedIds.length === 0) {
        setMergedContent(content);
        return;
      }
      let combined = content;
      for (const id of selectedIds) {
        const note = await webApi.notes.get(vaultId, id);
        if (note?.content) {
          combined += `\n\n---\n\n# ${note.name.replace(/\.(md|markdown)$/i, "")}\n\n${note.content}`;
        }
      }
      if (!cancelled) setMergedContent(combined);
    }
    merge();
    return () => {
      cancelled = true;
    };
  }, [content, selectedIds, vaultId]);

  // Generate HTML from merged content
  useEffect(() => {
    const publishTitle = selectedIds.length > 0 ? `${title} + ${selectedIds.length} more` : title;
    setHtml(generatePublishHTML(mergedContent, publishTitle));
  }, [mergedContent, title, selectedIds.length]);

  // Update iframe
  useEffect(() => {
    if (iframeRef.current && html && tab === "preview") {
      iframeRef.current.srcdoc = html;
    }
  }, [html, tab]);

  const toggleNote = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]));
  }, []);

  const handleSave = () => {
    if (!html) return;
    const filename = `${title.replace(/[^a-zA-Z0-9-_ ]/g, "")}.html`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(filename);
    setTimeout(() => setSaved(null), 3000);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(html);
    setSaved("clipboard");
    setTimeout(() => setSaved(null), 2000);
  };

  const filteredNotes = allNotes.filter((n) => n.path.toLowerCase().includes(search.toLowerCase()));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-primary)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          width: "90vw",
          height: "85vh",
          maxWidth: 1100,
          maxHeight: 750,
          display: "flex",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar — note picker */}
        <div
          style={{
            width: showPicker ? 260 : 0,
            overflow: "hidden",
            borderRight: showPicker ? "1px solid var(--border)" : "none",
            display: "flex",
            flexDirection: "column",
            transition: "width 0.15s ease",
            flexShrink: 0,
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
              {t("publish.addNotes")}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("publish.search")}
              style={{
                width: "100%",
                background: "var(--bg-tertiary, #313244)",
                border: "1px solid var(--bg-hover)",
                borderRadius: 4,
                padding: "4px 8px",
                color: "var(--text-primary)",
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
            {filteredNotes.map((n) => {
              const name = n.path.replace(/\.(md|markdown)$/i, "");
              const isSelected = selectedIds.includes(n.id);
              return (
                <button
                  key={n.id}
                  onClick={() => toggleNote(n.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    textAlign: "left",
                    padding: "4px 8px",
                    border: "none",
                    borderRadius: 4,
                    background: isSelected ? "var(--bg-hover)" : "transparent",
                    color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      flexShrink: 0,
                      border: isSelected ? "none" : "1.5px solid var(--text-muted)",
                      background: isSelected ? "var(--accent)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--bg-primary)",
                      fontSize: 9,
                    }}
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                </button>
              );
            })}
          </div>
          {selectedIds.length > 0 && (
            <div style={{ padding: "6px 12px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-secondary)" }}>
              {t("publish.added", { count: selectedIds.length })}
              <button
                onClick={() => setSelectedIds([])}
                style={{ marginLeft: 8, border: "none", background: "transparent", color: "var(--red)", fontSize: 11, cursor: "pointer" }}
              >
                {t("publish.clear")}
              </button>
            </div>
          )}
        </div>

        {/* Main area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 16px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setShowPicker((s) => !s)}
                title={t("publish.addMore")}
                style={{ ...btnStyle, background: showPicker ? "var(--bg-hover)" : undefined, fontWeight: 600 }}
              >
                {t("publish.plusNotes")}
              </button>
              <div style={{ display: "flex", background: "var(--bg-tertiary, #313244)", borderRadius: 4, padding: 1 }}>
                <button
                  onClick={() => setTab("preview")}
                  style={{
                    ...tabBtnStyle,
                    background: tab === "preview" ? "var(--bg-hover)" : "transparent",
                    color: tab === "preview" ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {t("publish.preview")}
                </button>
                <button
                  onClick={() => setTab("code")}
                  style={{
                    ...tabBtnStyle,
                    background: tab === "code" ? "var(--bg-hover)" : "transparent",
                    color: tab === "code" ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  HTML
                </button>
              </div>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                {title}
                {selectedIds.length > 0 ? ` + ${selectedIds.length}` : ""}.html
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleCopy} style={btnStyle}>
                {saved === "clipboard" ? t("publish.copied") : t("publish.copyHtml")}
              </button>
              <button
                onClick={handleSave}
                style={{ ...btnStyle, background: "var(--accent)", color: "var(--bg-primary)", fontWeight: 600, border: "none" }}
              >
                {t("publish.saveHtml")}
              </button>
              <button onClick={onClose} style={btnStyle}>
                &times;
              </button>
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: "hidden", background: "var(--bg-secondary)" }}>
            {tab === "preview" ? (
              <iframe ref={iframeRef} sandbox="allow-same-origin" style={{ width: "100%", height: "100%", border: "none" }} />
            ) : (
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  height: "100%",
                  resize: "none",
                  background: "var(--bg-primary)",
                  color: "var(--text-secondary)",
                  border: "none",
                  padding: 16,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: "none",
                  lineHeight: 1.6,
                }}
              />
            )}
          </div>

          {/* Saved confirmation */}
          {saved && saved !== "clipboard" && (
            <div style={{ padding: "6px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--green)", flexShrink: 0 }}>
              {t("publish.downloaded", { file: saved })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 12px",
  border: "1px solid var(--bg-hover)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: 12,
  cursor: "pointer",
};

const tabBtnStyle: React.CSSProperties = {
  padding: "3px 10px",
  border: "none",
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
