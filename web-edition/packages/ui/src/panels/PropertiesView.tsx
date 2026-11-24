"use client";

import { useEffect, useMemo, useState } from "react";
import type { NoteRef, VaultAdapter } from "@noteriv/core/vault-adapter";
import {
  PROPERTY_TYPES,
  collectVaultProperties,
  readProperties,
  renamePropertyKey,
  isValidPropertyKey,
  type PropertyType,
  type PropertyTypes,
} from "@noteriv/core/properties";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import { adapterNoteEditor, mapLimited, type NoteEditor } from "./note-edit";

export interface PropertiesViewProps {
  adapter: VaultAdapter;
  types: PropertyTypes;
  onTypeChange: (key: string, type: PropertyType) => void;
  /** Moves a type to a renamed property name. */
  onTypeRename: (oldKey: string, newKey: string) => void;
  onNoteOpen: (noteId: string) => void;
  onClose: () => void;
  /** How renaming changes notes (through open tabs). Default: straight through the adapter. */
  editNote?: NoteEditor;
}

interface NoteProps {
  ref: NoteRef;
  /** The note's text, or just its front matter. */
  text: string;
}

/** Every note's front matter: from the adapter when it can give just that, else by reading the notes. */
async function loadNotes(adapter: VaultAdapter): Promise<NoteProps[]> {
  if (adapter.frontmatterHeads) return (await adapter.frontmatterHeads()).map(({ ref, head }) => ({ ref, text: head }));
  const notes = await adapter.listNotes();
  const read = await mapLimited(notes, 8, async (ref) => ({ ref, text: (await adapter.readNote(ref.id)) ?? "" }));
  return read.filter((n) => readProperties(n.text).hasBlock);
}

/**
 * All properties used in the vault: how many notes have each, its type (set here for the whole vault), the notes that
 * have it, and renaming it in every note.
 */
export default function PropertiesView({ adapter, types, onTypeChange, onTypeRename, onNoteOpen, onClose, editNote }: PropertiesViewProps) {
  useLocale();
  const [notes, setNotes] = useState<NoteProps[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);
  const [notice, setNotice] = useState("");
  const edit = useMemo(() => editNote ?? adapterNoteEditor(adapter), [editNote, adapter]);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    setFailed(false);
    loadNotes(adapter)
      .then((n) => !cancelled && setNotes(n))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const all = useMemo(() => (notes ? collectVaultProperties(notes.map((n) => n.text), types) : []), [notes, types]);
  const notesWith = (key: string) => (notes ?? []).filter((n) => readProperties(n.text).properties.some((p) => p.key === key));

  async function rename(oldKey: string, newKey: string) {
    setRenaming(null);
    const next = newKey.trim();
    if (next === oldKey || oldKey === "tags" || !notes) return;
    if (!isValidPropertyKey(next)) {
      setNotice(t("properties.view.invalidName"));
      return;
    }
    // From the notes as they are now (notes created since the view opened included).
    let current: NoteProps[];
    try {
      current = await loadNotes(adapter);
    } catch {
      setNotice(t("properties.view.failed"));
      return;
    }
    let changed = 0;
    let skipped = 0;
    for (const n of current.filter((c) => readProperties(c.text).properties.some((p) => p.key === oldKey))) {
      const ok = await edit(n.ref.id, (text) => {
        const out = renamePropertyKey(text, oldKey, next);
        return out === text ? null : out;
      }).catch(() => false);
      if (ok) changed++;
      else skipped++;
    }
    // The type moves with the name only when every note was renamed (else the old name is still in use).
    if (oldKey in types && skipped === 0) onTypeRename(oldKey, next);
    // Shown at once from what is known here; open tabs save on their own schedule.
    setNotes(current.map((n) => ({ ...n, text: renamePropertyKey(n.text, oldKey, next) })));
    setNotice(skipped > 0 ? t("properties.view.renamedSome", { count: changed, skipped }) : t("properties.view.renamed", { count: changed }));
  }

  return (
    <div className="bl-panel pv-panel">
      <div className="bl-header">
        <span className="bl-title">{t("properties.view.title")}</span>
        <div className="bl-header-right">
          {notes && <span className="bl-count">{all.length}</span>}
          <button onClick={onClose} className="bl-close" title={t("common.close")}>
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {notice && (
        <div className="pv-notice" role="status" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
      <div className="bl-list">
        {failed ? (
          <div className="bl-section-empty">{t("properties.view.failed")}</div>
        ) : !notes ? (
          <div className="bl-loading">
            <div className="bl-spinner" />
          </div>
        ) : all.length === 0 ? (
          <div className="bl-empty">{t("properties.view.empty")}</div>
        ) : (
          all.map((p) => (
            <div key={p.key} className="bl-group pv-row">
              <div className="pv-head">
                {renaming?.key === p.key ? (
                  <input
                    autoFocus
                    className="pv-rename"
                    value={renaming.value}
                    onChange={(e) => setRenaming({ key: p.key, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void rename(p.key, renaming.value);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    aria-label={t("properties.view.rename")}
                  />
                ) : (
                  <button
                    className="bl-file-header pv-key"
                    onClick={() => setOpen(open === p.key ? null : p.key)}
                    onDoubleClick={() => p.key !== "tags" && setRenaming({ key: p.key, value: p.key })}
                    title={t("properties.view.renameHint")}
                  >
                    <span className="bl-file-name">{p.key}</span>
                    <span className="bl-count">{p.count}</span>
                  </button>
                )}
                <select
                  className="fm-type-select"
                  value={p.type}
                  disabled={p.key === "tags"}
                  onChange={(e) => onTypeChange(p.key, e.target.value as PropertyType)}
                  aria-label={t("properties.typeTitle")}
                  title={t("properties.typeTitle")}
                >
                  {PROPERTY_TYPES.filter((ty) => ty !== "tags" || p.key === "tags").map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`properties.types.${ty}`)}
                    </option>
                  ))}
                </select>
                {p.key !== "tags" && (
                  <button className="bl-link-btn" onClick={() => setRenaming({ key: p.key, value: p.key })}>
                    {t("properties.view.rename")}
                  </button>
                )}
              </div>
              {open === p.key &&
                notesWith(p.key).map((n) => (
                  <button key={n.ref.id} className="bl-snippet" onClick={() => onNoteOpen(n.ref.id)} title={n.ref.path}>
                    <span className="bl-snippet-text">{n.ref.name.replace(/\.md$/i, "")}</span>
                  </button>
                ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
