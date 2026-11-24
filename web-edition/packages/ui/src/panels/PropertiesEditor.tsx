"use client";

import { useEffect, useRef, useState } from "react";
import {
  PROPERTY_TYPES,
  coerceValue,
  convertLossless,
  deleteProperty,
  isValidPropertyKey,
  propertyTypeOf,
  readProperties,
  writeProperty,
  type Property,
  type PropertyType,
  type PropertyTypes,
  type PropertyValue,
} from "@noteriv/core/properties";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";

export interface PropertiesEditorProps {
  /** The note's text; changes come back whole through `onChange`. */
  content: string;
  onChange: (content: string) => void;
  /** The vault's property types (see usePropertyTypes). */
  types: PropertyTypes;
  /** Sets a property name's type for the whole vault. */
  onTypeChange: (key: string, type: PropertyType) => void;
  /** Property names used elsewhere in the vault, offered when adding one. */
  knownKeys?: string[];
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const COMMON_KEYS = ["tags", "aliases", "date", "status", "cssclasses"];

/** A value as the text an input shows. */
function asText(value: PropertyValue): string {
  if (value === null) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/**
 * The note's properties as typed rows: text, number, checkbox, date, date & time, list and tags each get their own
 * control. A property's type is set for the whole vault. Properties this editor cannot edit (nested YAML) are shown
 * read-only and kept as written.
 */
export default function PropertiesEditor({ content, onChange, types, onTypeChange, knownKeys = [], collapsed, onToggleCollapse }: PropertiesEditorProps) {
  useLocale();
  const { properties, hasBlock } = readProperties(content);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");

  const set = (key: string, value: PropertyValue) => onChange(writeProperty(content, key, value));

  const changeType = (p: Property, from: PropertyType, type: PropertyType) => {
    onTypeChange(p.key, type);
    // Convert the value only when nothing is lost (text ⇄ list, "3" ⇄ 3…); otherwise it stays as written.
    const converted = p.complex ? null : convertLossless(from, type, p.value);
    if (converted !== null && JSON.stringify(converted) !== JSON.stringify(p.value)) set(p.key, converted);
  };

  const add = (key: string) => {
    const k = key.trim();
    setAdding(false);
    setNewKey("");
    if (!isValidPropertyKey(k) || properties.some((p) => p.key === k)) return;
    const type = propertyTypeOf(k, null, types);
    const initial: PropertyValue = type === "list" || type === "tags" ? [] : type === "checkbox" ? false : type === "date" ? new Date().toISOString().slice(0, 10) : null;
    set(k, initial);
  };

  if (!hasBlock) {
    return (
      <div className="fm-editor">
        <button className="fm-add-frontmatter-btn" onClick={() => onChange(writeProperty(content, "tags", []))}>
          <PlusIcon />
          {t("frontmatter.add")}
        </button>
      </div>
    );
  }

  const suggestions = Array.from(new Set([...COMMON_KEYS, ...knownKeys]))
    .filter((k) => !properties.some((p) => p.key === k) && k.toLowerCase().includes(newKey.trim().toLowerCase()))
    .slice(0, 8);

  return (
    <div className="fm-editor">
      <div className="fm-header" onClick={onToggleCollapse}>
        <svg width="10" height="10" viewBox="0 0 10 10" className={`fm-chevron ${collapsed ? "" : "fm-chevron-open"}`}>
          <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="fm-header-label">{t("frontmatter.title")}</span>
        <span className="fm-header-count">{properties.length}</span>
      </div>

      {!collapsed && (
        <div className="fm-body">
          {properties.length === 0 && !adding && <div className="fm-empty">{t("frontmatter.none")}</div>}

          {properties.map((p, index) => {
            const type = propertyTypeOf(p.key, p.value, types);
            return (
              <div key={`${p.key}:${index}`} className="fm-property" data-type={type}>
                <select
                  className="fm-type-select"
                  value={type}
                  disabled={p.key === "tags" || p.complex}
                  onChange={(e) => changeType(p, type, e.target.value as PropertyType)}
                  title={t("properties.typeTitle")}
                  aria-label={t("properties.typeTitle")}
                >
                  {PROPERTY_TYPES.filter((ty) => ty !== "tags" || p.key === "tags").map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`properties.types.${ty}`)}
                    </option>
                  ))}
                </select>
                <span className="fm-property-key" title={p.key}>
                  {p.key}
                </span>
                <div className="fm-property-value-wrap">
                  {p.complex ? (
                    <span className="fm-property-value fm-complex" title={t("properties.complex")}>
                      {t("properties.complex")}
                    </span>
                  ) : (
                    <ValueControl type={type} value={p.value} onCommit={(v) => set(p.key, v)} />
                  )}
                </div>
                <button className="fm-delete-btn" onClick={() => onChange(deleteProperty(content, p.key))} title={t("frontmatter.remove")}>
                  <CloseIcon />
                </button>
              </div>
            );
          })}

          {adding ? (
            <div className="fm-add-row">
              <input
                autoFocus
                className="fm-new-key-input"
                placeholder={t("frontmatter.namePlaceholder")}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") add(newKey);
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewKey("");
                  }
                }}
                onBlur={() => setTimeout(() => !newKey.trim() && setAdding(false), 150)}
              />
              {suggestions.length > 0 && (
                <div className="fm-suggestions">
                  {suggestions.map((k) => (
                    <button
                      key={k}
                      className="fm-suggestion-item"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        add(k);
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button className="fm-add-btn" onClick={() => setAdding(true)}>
              <PlusIcon />
              {t("frontmatter.addOne")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The editing control for one value, by type. Text-like inputs commit on Enter or leaving the field. */
function ValueControl({ type, value, onCommit }: { type: PropertyType; value: PropertyValue; onCommit: (v: PropertyValue) => void }) {
  const [draft, setDraft] = useState(asText(value));
  useEffect(() => setDraft(asText(value)), [value]);

  // A value that does not fit its type (`rating: TBD` in a number property) is edited as the text it is, so showing it
  // in a number, date or checkbox control never changes or blanks it.
  const fits =
    value === null ||
    (type === "checkbox" && typeof value === "boolean") ||
    ((type === "list" || type === "tags") && Array.isArray(value)) ||
    (type === "number" && typeof value === "number") ||
    (type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ||
    (type === "datetime" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(value)) ||
    (type === "text" && !Array.isArray(value));
  const shownType: PropertyType = fits ? type : "text";

  if (shownType === "checkbox") {
    return <input type="checkbox" className="fm-checkbox" checked={value === true} onChange={(e) => onCommit(e.target.checked)} />;
  }
  if (shownType === "list" || shownType === "tags") {
    return <ListControl type={shownType} items={Array.isArray(value) ? value : []} onCommit={onCommit} />;
  }
  const inputType = shownType === "number" ? "number" : shownType === "date" ? "date" : shownType === "datetime" ? "datetime-local" : "text";
  const shown = shownType === "datetime" ? draft.replace(" ", "T").slice(0, 16) : draft;
  // Written only when the text was actually changed: focusing and leaving a field never rewrites the value.
  const commit = () => {
    if (draft === asText(value)) return;
    onCommit(fits ? coerceValue(type, draft) : draft);
  };
  return (
    <input
      className="fm-property-input"
      type={inputType}
      value={shown}
      placeholder={t("frontmatter.empty")}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(asText(value));
      }}
      onBlur={commit}
    />
  );
}

/** List and tags values as chips; type and press Enter (or a comma) to add, Backspace in the empty field to remove. */
function ListControl({ type, items, onCommit }: { type: PropertyType; items: string[]; onCommit: (v: PropertyValue) => void }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const addDraft = () => {
    const added = coerceValue(type, draft) as string[];
    setDraft("");
    if (added.length > 0) onCommit([...items, ...added.filter((a) => !items.includes(a))]);
  };
  return (
    <div className="fm-chips" onClick={() => inputRef.current?.focus()}>
      {items.map((item, i) => (
        <span key={`${item}:${i}`} className="fm-chip">
          {type === "tags" ? `#${item}` : item}
          <button
            className="fm-chip-x"
            title={t("properties.removeItem")}
            onClick={(e) => {
              e.stopPropagation();
              onCommit(items.filter((_, j) => j !== i));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="fm-chip-input"
        value={draft}
        placeholder={items.length === 0 ? t("properties.addValue") : ""}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addDraft();
          } else if (e.key === "Backspace" && draft === "" && items.length > 0) {
            onCommit(items.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && addDraft()}
      />
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
