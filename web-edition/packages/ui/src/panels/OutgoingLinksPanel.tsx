"use client";

import { useEffect, useMemo, useState } from "react";
import type { NoteRef, VaultAdapter } from "@noteriv/core/vault-adapter";
import { findMentions, linkMention, outgoingLinks, unlinkedMentionsIn, type Mention } from "@noteriv/core/link-mentions";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import { adapterNoteEditor, type NoteEditor } from "./note-edit";

export interface OutgoingLinksPanelProps {
  adapter: VaultAdapter;
  /** Id (adapter key) of the note being viewed. */
  noteId: string;
  /** The note's current text (what the editor shows), so the lists follow typing. */
  content: string;
  onNoteOpen: (noteId: string) => void;
  onClose: () => void;
  /** How "Link" changes this note (through its open tab). Default: straight through the adapter. */
  editNote?: NoteEditor;
}

/** Unlinked mentions are found this long after typing stops (one scan per note name). */
const MENTION_DELAY_MS = 400;

/**
 * What the open note links to (resolved links open the note; unresolved ones are shown dimmed) and which notes it
 * names without a link, each with a button that links the first such mention.
 */
export default function OutgoingLinksPanel({ adapter, noteId, content, onNoteOpen, onClose, editNote }: OutgoingLinksPanelProps) {
  useLocale();
  const [notes, setNotes] = useState<NoteRef[] | null>(null);
  // The text unlinked mentions are computed from, and the note it belongs to: a newly opened note is scanned at once,
  // typing in it only after a pause.
  const [scanned, setScanned] = useState({ noteId, text: content });
  const mentionText = scanned.noteId === noteId ? scanned.text : content;
  const edit = useMemo(() => editNote ?? adapterNoteEditor(adapter), [editNote, adapter]);

  useEffect(() => {
    let cancelled = false;
    adapter
      .listNotes()
      .then((list) => !cancelled && setNotes(list))
      .catch(() => !cancelled && setNotes([]));
    return () => {
      cancelled = true;
    };
  }, [adapter, noteId]);

  useEffect(() => {
    const timer = setTimeout(() => setScanned({ noteId, text: content }), MENTION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [noteId, content]);

  const self = notes?.find((n) => n.id === noteId) ?? null;
  const paths = useMemo(() => notes?.map((n) => n.path) ?? [], [notes]);
  const byPath = useMemo(() => new Map((notes ?? []).map((n) => [n.path.toLowerCase(), n])), [notes]);
  const links = useMemo(() => (self ? outgoingLinks(content, self.path, paths) : []), [content, self, paths]);
  const unlinked = useMemo(() => (self ? unlinkedMentionsIn(mentionText, self.path, paths) : []), [mentionText, self, paths]);

  async function linkFirst(path: string, mention: Mention) {
    if (!self) return;
    const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    await edit(noteId, (text) => {
      const fresh = findMentions(text, name);
      const target =
        fresh.find((m) => m.start === mention.start && m.text === mention.text) ??
        fresh.find((m) => m.line === mention.line && m.text === mention.text && m.snippet === mention.snippet);
      return target ? linkMention(text, target, path, self.path, paths) : null;
    });
  }

  return (
    <div className="bl-panel ol-panel">
      <div className="bl-header">
        <span className="bl-title">{t("panels.outgoing.title")}</span>
        <div className="bl-header-right">
          {notes && <span className="bl-count">{t("panels.backlinks.count", { count: links.length })}</span>}
          <button onClick={onClose} className="bl-close" title={t("common.close")}>
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="bl-list">
        {!notes ? (
          <div className="bl-loading">
            <div className="bl-spinner" />
          </div>
        ) : (
          <>
            {links.length === 0 ? (
              <div className="bl-section-empty">{t("panels.outgoing.empty")}</div>
            ) : (
              links.map((link) => {
                const ref = link.resolved ? byPath.get(link.resolved.toLowerCase()) : undefined;
                const label = (link.resolved ?? link.target).split("/").pop()!.replace(/\.md$/i, "");
                return (
                  <button
                    key={`${link.resolved ?? link.target}:${link.line}`}
                    className={`bl-file-header${ref ? "" : " ol-unresolved"}`}
                    onClick={() => ref && onNoteOpen(ref.id)}
                    disabled={!ref}
                    title={ref ? ref.path : t("panels.outgoing.unresolved", { target: link.target })}
                  >
                    <span className="bl-line-num">L{link.line}</span>
                    <span className="bl-file-name">{label}</span>
                  </button>
                );
              })
            )}

            <div className="bl-unlinked">
              <div className="bl-section">
                <span>{t("panels.outgoing.unlinked")}</span>
                <span className="bl-count">{unlinked.length}</span>
              </div>
              {unlinked.length === 0 ? (
                <div className="bl-section-empty">{t("panels.outgoing.unlinkedEmpty")}</div>
              ) : (
                unlinked.map(({ path, mentions }) => (
                  <div key={path} className="bl-mention">
                    <span className="bl-line-num">L{mentions[0].line}</span>
                    <span className="bl-snippet-text" title={path}>
                      {path.split("/").pop()!.replace(/\.md$/i, "")}
                      {mentions.length > 1 ? ` ×${mentions.length}` : ""}
                    </span>
                    <button
                      className="bl-link-btn"
                      onClick={() => void linkFirst(path, mentions[0])}
                      title={t("panels.outgoing.linkTitle", { path })}
                    >
                      {t("panels.backlinks.link")}
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
