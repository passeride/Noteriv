"use client";

import type { NoteRef } from "@noteriv/core/vault-adapter";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";

/** Visible text. Defaults come from the i18n catalog; an app overrides what it words differently (how to bookmark). */
export interface BookmarksLabels {
  title: string;
  empty: string;
  hint: string;
  close: string;
  remove: string;
}

const defaultLabels = (): BookmarksLabels => ({
  title: t("panels.bookmarks.title"),
  empty: t("panels.bookmarks.empty"),
  hint: t("panels.bookmarks.hint"),
  close: t("panels.bookmarks.close"),
  remove: t("panels.bookmarks.remove"),
});

export interface BookmarksPanelProps {
  notes: NoteRef[]; // bookmarked notes, in bookmark order
  currentNoteId: string | null;
  onNoteSelect: (noteId: string) => void;
  onBookmarkRemove: (noteId: string) => void;
  /** Shows a close button when given. */
  onClose?: () => void;
  labels?: Partial<BookmarksLabels>;
}

export default function BookmarksPanel({ notes, currentNoteId, onNoteSelect, onBookmarkRemove, onClose, labels }: BookmarksPanelProps) {
  useLocale();
  const text = { ...defaultLabels(), ...labels };
  return (
    <div className="bm-panel">
      <div className="bm-header">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="bm-header-icon">
          <path d="M8 2l1.8 3.6L14 6.3l-3 2.9.7 4.1L8 11.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7L8 2z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
        </svg>
        <span className="bm-header-label">{text.title}</span>
        <span className="bm-header-count">{notes.length}</span>
        {onClose && (
          <button onClick={onClose} className="titlebar-btn" style={{ marginLeft: "auto" }} title={text.close}>
            ×
          </button>
        )}
      </div>

      <div className="bm-list">
        {notes.length === 0 ? (
          <div className="bm-empty">
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" className="bm-empty-icon">
              <path d="M8 2l1.8 3.6L14 6.3l-3 2.9.7 4.1L8 11.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7L8 2z" stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round" />
            </svg>
            <p>{text.empty}</p>
            <p className="bm-empty-hint">{text.hint}</p>
          </div>
        ) : (
          notes.map((note) => {
            const isActive = currentNoteId === note.id;
            return (
              <div key={note.id} className={`bm-item ${isActive ? "bm-item-active" : ""}`} onClick={() => onNoteSelect(note.id)} title={note.path}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="bm-star">
                  <path d="M8 2l1.8 3.6L14 6.3l-3 2.9.7 4.1L8 11.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7L8 2z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" strokeLinejoin="round" />
                </svg>
                <div className="bm-item-info">
                  <span className="bm-item-name">{note.name}</span>
                  <span className="bm-item-path">{note.path}</span>
                </div>
                <button
                  className="bm-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onBookmarkRemove(note.id);
                  }}
                  title={text.remove}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
