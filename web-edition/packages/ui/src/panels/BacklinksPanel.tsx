"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { NoteBacklink, NoteRef, VaultAdapter } from "@noteriv/core/vault-adapter";
import { findMentions, linkMention, type Mention } from "@noteriv/core/link-mentions";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import { adapterNoteEditor, mapLimited, type NoteEditor } from "./note-edit";

interface BacklinksPanelProps {
  adapter: VaultAdapter;
  /** Id (adapter key) of the note being viewed. */
  noteId: string;
  /** Called when user clicks a backlink to open the linked note. */
  onNoteOpen: (noteId: string) => void;
  /** Called when the panel close button is clicked. */
  onClose: () => void;
  /** How "Link" changes another note (through its open tab when it has one). Default: straight through the adapter. */
  editNote?: NoteEditor;
}

/** After "Link", backlinks are read again this much later, once the linked note has likely been saved. */
const BACKLINK_RELOAD_MS = 2500;

interface BacklinkGroup {
  ref: NoteRef;
  links: NoteBacklink[];
}

interface MentionGroup {
  ref: NoteRef;
  mentions: Mention[];
}

/** Notes naming this one without a link: the ones the adapter says contain the name, else every note. */
async function loadUnlinked(adapter: VaultAdapter, noteId: string): Promise<{ self: NoteRef | null; paths: string[]; groups: MentionGroup[] }> {
  const notes = await adapter.listNotes();
  const self = notes.find((n) => n.id === noteId) ?? null;
  const paths = notes.map((n) => n.path);
  if (!self) return { self, paths, groups: [] };
  const name = self.name.replace(/\.md$/i, "");
  // A failed search (no network…) fails the whole list; only an answer the adapter says is incomplete (null) means
  // reading every note.
  const found = adapter.notesContaining ? await adapter.notesContaining([name]) : null;
  const candidates = found ?? (await mapLimited(notes, 8, async (ref) => ({ ref, content: await adapter.readNote(ref.id) })));
  const groups: MentionGroup[] = [];
  for (const { ref, content } of candidates) {
    if (ref.id === noteId || !content) continue;
    const mentions = findMentions(content, name);
    if (mentions.length > 0) groups.push({ ref, mentions });
  }
  groups.sort((a, b) => a.ref.name.localeCompare(b.ref.name));
  return { self, paths, groups };
}

export default function BacklinksPanel({ adapter, noteId, onNoteOpen, onClose, editNote }: BacklinksPanelProps) {
  useLocale();
  const [backlinks, setBacklinks] = useState<NoteBacklink[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlinked, setUnlinked] = useState<{ self: NoteRef | null; paths: string[]; groups: MentionGroup[] } | null>(null);
  const [unlinkedFailed, setUnlinkedFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edit = useMemo(() => editNote ?? adapterNoteEditor(adapter), [editNote, adapter]);

  useEffect(() => {
    let cancelled = false;
    setUnlinked(null);
    setUnlinkedFailed(false);
    loadUnlinked(adapter, noteId)
      .then((result) => !cancelled && setUnlinked(result))
      .catch(() => !cancelled && setUnlinkedFailed(true));
    return () => {
      cancelled = true;
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [adapter, noteId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const results = await adapter.backlinks(noteId);
        if (!cancelled) setBacklinks(results);
      } catch (err) {
        console.error("Failed to load backlinks:", err);
        if (!cancelled) setBacklinks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [adapter, noteId, reload]);

  // One group per source note; the web backend reports no line, so a group may hold a single bare entry.
  const groups = useMemo(() => {
    const byId = new Map<string, BacklinkGroup>();
    for (const bl of backlinks) {
      const group = byId.get(bl.ref.id) ?? { ref: bl.ref, links: [] };
      group.links.push(bl);
      byId.set(bl.ref.id, group);
    }
    return Array.from(byId.values());
  }, [backlinks]);

  const handleBacklinkClick = useCallback((id: string) => onNoteOpen(id), [onNoteOpen]);

  /** Turns one mention in another note into a link to this note, found again in that note's current text. */
  const linkOne = useCallback(
    async (ref: NoteRef, mention: Mention) => {
      const self = unlinked?.self;
      if (!self) return;
      const name = self.name.replace(/\.md$/i, "");
      // Found again in the note's current text (an open tab may hold edits not saved yet): at the same place, else the
      // same words on the same line; otherwise nothing is changed rather than linking another occurrence.
      const changed = await edit(ref.id, (text) => {
        const fresh = findMentions(text, name);
        const target =
          fresh.find((m) => m.start === mention.start && m.text === mention.text) ??
          fresh.find((m) => m.line === mention.line && m.text === mention.text && m.snippet === mention.snippet);
        return target ? linkMention(text, target, self.path, ref.path, unlinked.paths) : null;
      });
      if (!changed) return;
      // The other note may save a moment later (an open tab saves on its own schedule): drop the mention here now,
      // and look for the new backlink once that save has had time to land.
      setUnlinked((prev) =>
        prev && {
          ...prev,
          groups: prev.groups
            .map((g) => (g.ref.id === ref.id ? { ...g, mentions: g.mentions.filter((m) => m !== mention) } : g))
            .filter((g) => g.mentions.length > 0),
        }
      );
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => setReload((n) => n + 1), BACKLINK_RELOAD_MS);
    },
    [edit, unlinked]
  );

  const unlinkedCount = unlinked?.groups.reduce((sum, g) => sum + g.mentions.length, 0) ?? 0;

  return (
    <div className="bl-panel">
      <div className="bl-header">
        <span className="bl-title">{t("panels.backlinks.title")}</span>
        <div className="bl-header-right">
          {!loading && (
            <span className="bl-count">
              {t("panels.backlinks.count", { count: backlinks.length })}
            </span>
          )}
          <button onClick={onClose} className="bl-close" title={t("common.close")}>
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="bl-list">
        {loading ? (
          <div className="bl-loading">
            <div className="bl-spinner" />
            <span>{t("panels.backlinks.scanning")}</span>
          </div>
        ) : backlinks.length === 0 ? (
          <div className="bl-empty">{t("panels.backlinks.empty")}</div>
        ) : (
          groups.map(({ ref, links }) => (
            <div key={ref.id} className="bl-group">
              <button className="bl-file-header" onClick={() => handleBacklinkClick(ref.id)} title={ref.path}>
                <FileIcon />
                <span className="bl-file-name">{ref.name.replace(/\.md$/i, "")}</span>
              </button>

              {links.map(
                (bl, idx) =>
                  bl.line !== undefined && (
                    <button
                      key={`${ref.id}:${bl.line}:${idx}`}
                      className="bl-snippet"
                      onClick={() => handleBacklinkClick(ref.id)}
                      title={t("panels.backlinks.line", { line: bl.line })}
                    >
                      <span className="bl-line-num">L{bl.line}</span>
                      <span className="bl-snippet-text">{bl.snippet}</span>
                    </button>
                  )
              )}
            </div>
          ))
        )}

        {unlinkedFailed && (
          <div className="bl-unlinked">
            <div className="bl-section">
              <span>{t("panels.backlinks.unlinked")}</span>
            </div>
            <div className="bl-section-empty">{t("panels.backlinks.unlinkedFailed")}</div>
          </div>
        )}
        {unlinked && (
          <div className="bl-unlinked">
            <div className="bl-section">
              <span>{t("panels.backlinks.unlinked")}</span>
              <span className="bl-count">{unlinkedCount}</span>
            </div>
            {unlinked.groups.length === 0 ? (
              <div className="bl-section-empty">{t("panels.backlinks.unlinkedEmpty")}</div>
            ) : (
              unlinked.groups.map(({ ref, mentions }) => (
                <div key={ref.id} className="bl-group">
                  <button className="bl-file-header" onClick={() => handleBacklinkClick(ref.id)} title={ref.path}>
                    <FileIcon />
                    <span className="bl-file-name">{ref.name.replace(/\.md$/i, "")}</span>
                  </button>
                  {mentions.map((m) => (
                    <div key={`${ref.id}:${m.start}`} className="bl-mention">
                      <span className="bl-line-num">L{m.line}</span>
                      <span className="bl-snippet-text" title={m.snippet}>
                        {m.snippet}
                      </span>
                      <button className="bl-link-btn" onClick={() => void linkOne(ref, m)} title={t("panels.backlinks.linkTitle")}>
                        {t("panels.backlinks.link")}
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" className="bl-file-icon">
      <path d="M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}
