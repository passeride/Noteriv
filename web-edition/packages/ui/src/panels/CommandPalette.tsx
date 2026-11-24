"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { formatHotkey } from "./format-hotkey";
import { t, tOr } from "../i18n";
import { useLocale } from "../i18n/react";

/** A palette row: a built-in action, or a plugin command ("plugin:<dbId>:<cmdId>"). */
export interface PaletteItem<A extends string = string> {
  action: A;
  label: string;
  keys: string;
  category: string;
}

export interface CommandPaletteLabels {
  placeholder: string;
  recent: string;
  empty: string;
}

const defaultLabels = (): CommandPaletteLabels => ({
  placeholder: t("panels.commandPalette.placeholder"),
  recent: t("panels.commandPalette.recent"),
  empty: t("panels.commandPalette.empty"),
});

export interface CommandPaletteProps<A extends string = string> {
  hotkeys: PaletteItem<A>[];
  /** Commands registered by installed plugins (shown under their own category). */
  extraItems?: PaletteItem[];
  platform: string;
  recentActions?: A[];
  onExecute: (action: A) => void;
  onRecent?: (action: A) => void;
  onClose: () => void;
  labels?: Partial<CommandPaletteLabels>;
}

/**
 * The general action palette (Ctrl/Cmd+Shift+P): filter, group and navigate a list of commands. Pure UI; which
 * commands exist and what they do is the host's (the apps keep their own hotkey tables). Distinct from QuickOpen
 * (Ctrl/Cmd+K), which switches notes.
 */
export default function CommandPalette<A extends string = string>({ hotkeys: builtIn, extraItems = [], platform, recentActions = [], onExecute, onRecent, onClose, labels }: CommandPaletteProps<A>) {
  const locale = useLocale();
  const text = { ...defaultLabels(), ...labels };
  // The apps' hotkey tables name actions and English categories; their text comes from the catalog
  // (`hotkeys.<action>`, `hotkeys.category.<category>`), the table's own text when the catalog lacks it.
  const hotkeys: PaletteItem<string>[] = useMemo(
    () => [
      ...builtIn.map((h) => ({
        ...h,
        label: tOr(`hotkeys.${h.action}`, h.label),
        category: tOr(`hotkeys.category.${h.category.toLowerCase()}`, h.category),
      })),
      ...extraItems,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the locale changes the text
    [builtIn, extraItems, locale]
  );
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return hotkeys;
    const lower = query.toLowerCase();
    return hotkeys.filter(
      (h) =>
        h.label.toLowerCase().includes(lower) ||
        h.category.toLowerCase().includes(lower) ||
        h.action.toLowerCase().includes(lower)
    );
  }, [query, hotkeys]);

  const recentItems = useMemo(() => {
    if (query.trim()) return [];
    return recentActions
      .map((action) => hotkeys.find((h) => h.action === action))
      .filter((h): h is PaletteItem<string> => h !== undefined);
  }, [query, recentActions, hotkeys]);

  const grouped = useMemo(() => {
    const groups: { category: string; items: PaletteItem<string>[] }[] = [];
    const seen = new Set<string>();
    for (const item of filtered) {
      if (!seen.has(item.category)) {
        seen.add(item.category);
        groups.push({ category: item.category, items: [] });
      }
      groups.find((g) => g.category === item.category)!.items.push(item);
    }
    return groups;
  }, [filtered]);

  const flatItems = useMemo(() => [...recentItems, ...filtered], [recentItems, filtered]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-cmd-idx="${selectedIdx}"]`) as HTMLElement;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const executeCommand = useCallback(
    (action: string) => {
      // A row's action is one of the host's own (A) or a plugin command string; the host's handlers take it as it is.
      onRecent?.(action as A);
      onExecute(action as A);
      onClose();
    },
    [onExecute, onRecent, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, flatItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (flatItems[selectedIdx]) executeCommand(flatItems[selectedIdx].action);
      }
    },
    [flatItems, selectedIdx, executeCommand, onClose]
  );

  let flatIdx = 0;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette palette-wide" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <svg width="14" height="14" viewBox="0 0 16 16" className="palette-icon">
            <path d="M1 3h14M1 8h14M1 13h14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={text.placeholder}
            className="palette-input"
          />
        </div>

        <div className="palette-list" ref={listRef}>
          {recentItems.length > 0 && (
            <div>
              <div className="cmd-category cmd-category-recent">{text.recent}</div>
              {recentItems.map((item) => {
                const idx = flatIdx++;
                const isActive = idx === selectedIdx;
                return (
                  <button
                    key={`recent-${item.action}`}
                    data-cmd-idx={idx}
                    className={`palette-item${isActive ? " palette-item-active" : ""}`}
                    onClick={() => executeCommand(item.action)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="palette-item-name">{item.label}</span>
                    {item.keys && <span className="cmd-keys">{formatHotkey(item.keys, platform)}</span>}
                  </button>
                );
              })}
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="cmd-category">{group.category}</div>
              {group.items.map((item) => {
                const idx = flatIdx++;
                const isActive = idx === selectedIdx;
                return (
                  <button
                    key={item.action}
                    data-cmd-idx={idx}
                    className={`palette-item${isActive ? " palette-item-active" : ""}`}
                    onClick={() => executeCommand(item.action)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <span className="palette-item-name">{item.label}</span>
                    {item.keys && <span className="cmd-keys">{formatHotkey(item.keys, platform)}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {flatItems.length === 0 && <div className="palette-empty">{text.empty}</div>}
        </div>
      </div>
    </div>
  );
}
