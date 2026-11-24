"use client";

import { useState, useCallback, useEffect } from "react";
import { useEscapeClose } from "@noteriv/ui/hooks";
import type { CSSSnippet } from "@/lib/css-snippets";
import {
  toggleSnippet,
  createSnippet,
  deleteSnippet,
  updateSnippetContent,
  CommunitySnippetEntry,
  fetchSnippetManifest,
  fetchCommunitySnippetContent,
  installCommunitySnippet,
} from "@/lib/css-snippets";
import "@/styles/css-snippets.css";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

type Tab = "installed" | "community";

interface CSSSnippetsProps {
  vaultId: string;
  snippets: CSSSnippet[];
  onSnippetsChange: (snippets: CSSSnippet[]) => void;
  onClose: () => void;
}

export default function CSSSnippets({
  vaultId,
  snippets,
  onSnippetsChange,
  onClose,
}: CSSSnippetsProps) {
  useLocale();
  const [activeTab, setActiveTab] = useState<Tab>("installed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Escape closes the dialog, except while a snippet is open in the editor (unsaved CSS would be lost).
  useEscapeClose(onClose, !editingId);

  // Community state
  const [communityEntries, setCommunityEntries] = useState<CommunitySnippetEntry[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState("");
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [communityFilter, setCommunityFilter] = useState("all");

  const loadCommunity = async () => {
    setCommunityLoading(true);
    setCommunityError("");
    const manifest = await fetchSnippetManifest();
    if (!manifest) {
      setCommunityError(t("snippets.loadFailed"));
      setCommunityLoading(false);
      return;
    }
    setCommunityEntries(manifest.snippets);
    setCommunityLoaded(true);
    setCommunityLoading(false);
  };

  // Load community when tab first activated
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeTab === "community" && !communityLoaded && !communityLoading) {
      loadCommunity();
    }
  }, [activeTab, communityLoaded, communityLoading]);

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      await toggleSnippet(vaultId, id, enabled);
      onSnippetsChange(
        snippets.map((s) => (s.id === id ? { ...s, enabled } : s))
      );
    },
    [vaultId, snippets, onSnippetsChange]
  );

  const handleEdit = useCallback((snippet: CSSSnippet) => {
    setEditingId(snippet.id);
    setEditContent(snippet.content);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    await updateSnippetContent(vaultId, editingId, editContent);
    onSnippetsChange(
      snippets.map((s) =>
        s.id === editingId ? { ...s, content: editContent } : s
      )
    );
    setEditingId(null);
    setEditContent("");
  }, [vaultId, editingId, editContent, snippets, onSnippetsChange]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent("");
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    const snippet = await createSnippet(
      vaultId,
      newName.trim(),
      `/* ${newName.trim()} */\n`
    );
    onSnippetsChange([...snippets, snippet]);
    setNewName("");
    setShowNewForm(false);
    setEditingId(snippet.id);
    setEditContent(snippet.content);
  }, [vaultId, newName, snippets, onSnippetsChange]);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteSnippet(vaultId, id);
      onSnippetsChange(snippets.filter((s) => s.id !== id));
      setConfirmDelete(null);
      if (editingId === id) {
        setEditingId(null);
        setEditContent("");
      }
    },
    [vaultId, snippets, onSnippetsChange, editingId]
  );

  const handleInstallCommunity = useCallback(
    async (entry: CommunitySnippetEntry) => {
      setInstallingId(entry.id);
      const content = await fetchCommunitySnippetContent(entry.file);
      if (!content) {
        setInstallingId(null);
        return;
      }
      const snippet = await installCommunitySnippet(vaultId, entry, content);
      if (!snippets.some((s) => s.id === snippet.id)) {
        onSnippetsChange([...snippets, snippet]);
      }
      setInstallingId(null);
    },
    [vaultId, onSnippetsChange]
  );

  const isInstalled = (id: string) => snippets.some((s) => s.id === id);

  const filtered = snippets.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.id.toLowerCase().includes(search.toLowerCase())
  );

  const categories = Array.from(new Set(communityEntries.map((e) => e.category)));

  const filteredCommunity = communityEntries.filter(
    (e) => communityFilter === "all" || e.category === communityFilter
  );

  return (
    <div
      className="snippets-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="snippets-modal">
        <div className="snippets-header">
          <h2 className="snippets-title">{t("snippets.title")}</h2>
          <button onClick={onClose} className="snippets-close-btn">
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Segmented tab control */}
        <div className="cs-tabs">
          <button
            className={`cs-tab${activeTab === "installed" ? " cs-tab-active" : ""}`}
            onClick={() => setActiveTab("installed")}
          >
            {t("snippets.installed")}
            {snippets.length > 0 && (
              <span className="cs-tab-count">{snippets.length}</span>
            )}
          </button>
          <button
            className={`cs-tab${activeTab === "community" ? " cs-tab-active" : ""}`}
            onClick={() => setActiveTab("community")}
          >
            {t("snippets.community")}
          </button>
        </div>

        {/* ── Installed tab ── */}
        {activeTab === "installed" && (
          <>
            <div className="snippets-toolbar">
              <input
                type="text"
                className="snippets-search"
                placeholder={t("snippets.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="snippets-new-btn"
                onClick={() => setShowNewForm(true)}
              >
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path
                    d="M6 2v8M2 6h8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                {t("snippets.new")}
              </button>
            </div>

            {showNewForm && (
              <div className="snippet-new-form">
                <input
                  type="text"
                  className="snippet-new-input"
                  placeholder={t("snippets.namePlaceholder")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") {
                      setShowNewForm(false);
                      setNewName("");
                    }
                  }}
                  autoFocus
                />
                <button className="snippet-create-btn" onClick={handleCreate}>
                  {t("snippets.create")}
                </button>
                <button
                  className="snippet-cancel-btn"
                  onClick={() => {
                    setShowNewForm(false);
                    setNewName("");
                  }}
                >
                  {t("snippets.cancel")}
                </button>
              </div>
            )}

            <div className="snippets-list">
              {filtered.length === 0 ? (
                <div className="snippet-empty">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  >
                    <path d="M4 4h16v16H4z" strokeLinecap="round" />
                    <path d="M8 8h3M8 12h8M8 16h5" strokeLinecap="round" />
                  </svg>
                  <p className="snippet-empty-title">{t("snippets.empty")}</p>
                  <p className="snippet-empty-desc">
                    {t("snippets.emptyBefore")} <button className="cs-inline-link" onClick={() => setActiveTab("community")}>{t("snippets.community")}</button> {t("snippets.emptyAfter")}
                  </p>
                </div>
              ) : (
                filtered.map((snippet) => (
                  <div key={snippet.id} className="snippet-item">
                    <div className="snippet-item-header">
                      <button
                        className={`snippet-toggle${snippet.enabled ? " snippet-toggle-on" : ""}`}
                        onClick={() => handleToggle(snippet.id, !snippet.enabled)}
                        role="switch"
                        aria-checked={snippet.enabled}
                      >
                        <span className="snippet-toggle-thumb" />
                      </button>
                      <div className="snippet-info">
                        <span className="snippet-name">{snippet.name}</span>
                        <span className="snippet-meta">
                          {snippet.filename} &middot;{" "}
                          {t("snippets.lines", { count: snippet.content.split("\n").length })}
                        </span>
                      </div>
                      <div className="snippet-actions">
                        <button
                          className="snippet-action-btn"
                          onClick={() => handleEdit(snippet)}
                          title={t("snippets.edit")}
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M11.5 1.5l3 3L5 14H2v-3z"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        {confirmDelete === snippet.id ? (
                          <>
                            <button
                              className="snippet-action-btn snippet-delete-confirm"
                              onClick={() => handleDelete(snippet.id)}
                            >
                              {t("snippets.delete")}
                            </button>
                            <button
                              className="snippet-action-btn"
                              onClick={() => setConfirmDelete(null)}
                            >
                              {t("snippets.cancel")}
                            </button>
                          </>
                        ) : (
                          <button
                            className="snippet-action-btn snippet-delete-btn"
                            onClick={() => setConfirmDelete(snippet.id)}
                            title={t("snippets.deleteTitle")}
                          >
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                              <path
                                d="M3 4h10M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M4 4l1 9a1 1 0 001 1h4a1 1 0 001-1l1-9"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {editingId === snippet.id && (
                      <div className="snippet-editor">
                        <textarea
                          className="snippet-editor-textarea"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          spellCheck={false}
                          rows={Math.min(20, Math.max(6, editContent.split("\n").length + 2))}
                        />
                        <div className="snippet-editor-actions">
                          <button
                            className="snippet-save-btn"
                            onClick={handleSaveEdit}
                          >
                            {t("snippets.save")}
                          </button>
                          <button
                            className="snippet-cancel-edit-btn"
                            onClick={handleCancelEdit}
                          >
                            {t("snippets.cancel")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ── Community tab ── */}
        {activeTab === "community" && (
          <div className="cs-community">
            <div className="cs-filters">
              <button
                className={`cs-filter${communityFilter === "all" ? " cs-filter-on" : ""}`}
                onClick={() => setCommunityFilter("all")}
              >
                {t("snippets.all")}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`cs-filter${communityFilter === cat ? " cs-filter-on" : ""}`}
                  onClick={() => setCommunityFilter(cat)}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>

            <div className="cs-community-list">
              {communityLoading ? (
                <div className="cs-status">
                  <div className="cs-spinner" />
                  {t("snippets.loading")}
                </div>
              ) : communityError ? (
                <div className="cs-status cs-status-err">
                  <span>{communityError}</span>
                  <button className="cs-retry-btn" onClick={loadCommunity}>{t("snippets.retry")}</button>
                </div>
              ) : filteredCommunity.length === 0 ? (
                <div className="cs-status">{t("snippets.noneFound")}</div>
              ) : (
                filteredCommunity.map((entry) => {
                  const installed = isInstalled(entry.id);
                  const installing = installingId === entry.id;
                  return (
                    <div key={entry.id} className="cs-entry">
                      <div className="cs-entry-info">
                        <div className="cs-entry-top">
                          <span className="cs-entry-name">{entry.name}</span>
                          <span className="cs-entry-cat">{entry.category}</span>
                        </div>
                        <span className="cs-entry-desc">{entry.description}</span>
                      </div>
                      <div className="cs-entry-action">
                        {installed ? (
                          <span className="cs-installed-tag">
                            <svg width="10" height="10" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            {t("snippets.installed")}
                          </span>
                        ) : (
                          <button
                            className="cs-install-btn"
                            onClick={() => handleInstallCommunity(entry)}
                            disabled={installing}
                          >
                            {installing ? "..." : t("snippets.install")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <a
              className="cs-gh-link"
              href="https://github.com/thejacedev/NoterivSnippets"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { e.preventDefault(); window.open("https://github.com/thejacedev/NoterivSnippets", "_blank"); }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" fill="currentColor" />
              </svg>
              {t("snippets.submit")}
            </a>
          </div>
        )}

        <div className="snippets-footer">
          <span className="snippets-footer-text">
            {t("snippets.storedBefore")}{" "}
            <code>.noteriv/snippets/</code> {t("snippets.storedAfter")}
          </span>
        </div>
      </div>
    </div>
  );
}
