"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  QuickOpenIcon,
  NewNoteIcon,
  SettingsIcon,
  SearchIcon,
  OutlineIcon,
  TagIcon,
  TrashIcon,
  BookmarkIcon,
  AttachmentIcon,
  SyncIcon,
  ThemeIcon,
  PluginIcon,
  SnippetsIcon,
  CommandIcon,
  MoreIcon,
} from "@/components/icons";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

interface RibbonProps {
  onQuickOpen: () => void;
  onNewNote: () => void;
  onCommandPalette: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onOutline: () => void;
  onTags: () => void;
  onTrash: () => void;
  onBookmarks: () => void;
  onAttachments: () => void;
  onSync: () => void;
  onPlugins: () => void;
  onThemes: () => void;
  onSnippets: () => void;
  syncAttention?: boolean;
  /** Sidebar panels registered by plugins; one extra button each. */
  pluginPanels?: { key: string; title: string; icon?: string }[];
  /** Ribbon buttons of core plugins, rendered by @noteriv/ui (CorePluginRibbonButtons). */
  coreRibbon?: React.ReactNode;
  activePluginPanel?: string | null;
  onPluginPanel?: (key: string) => void;
  outlineActive?: boolean;
  tagsActive?: boolean;
  bookmarksActive?: boolean;
  onAiChat?: () => void;
  aiChatActive?: boolean;
}

const ACTIVE_STYLE = { color: "var(--accent)", background: "rgba(137,180,250,0.12)" } as const;

/**
 * Vault-level left icon rail — equivalent to desktop's ribbon (inlined in
 * desktop/src/app/page.tsx, no standalone file there). Holds actions that
 * apply to the whole vault, not to whichever note happens to be open.
 *
 * It used to hold ~22 buttons and ran off the bottom of the window (Settings got cut off).
 * Now the everyday ones stay on the rail like desktop's and the rest live in the "⋯" popover.
 */
export default function Ribbon(props: RibbonProps) {
  useLocale();
  const {
    onQuickOpen, onNewNote, onCommandPalette, onSearch, onSettings,
    onOutline, onTags, onBookmarks, onSync, onPlugins, syncAttention, pluginPanels = [], activePluginPanel = null,
    onPluginPanel, outlineActive, tagsActive, bookmarksActive, coreRibbon, onAiChat, aiChatActive,
  } = props;

  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 44, bottom: 8 });
  const POPOVER_WIDTH = 220;

  // Placed before the browser paints: positioned in a plain effect, the menu showed for one frame at its default
  // spot (over the phone's bottom bar), and a click or a measurement could land on it there.
  useLayoutEffect(() => {
    if (!moreOpen) return;
    const r = moreBtnRef.current?.getBoundingClientRect();
    if (r) {
      // A rail on the left opens the menu beside the button; the phone's bottom bar opens it above.
      const bar = r.top > window.innerHeight / 2 && r.bottom > window.innerHeight - 80 && window.matchMedia("(max-width: 600px)").matches;
      setPos(
        bar
          ? { left: Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8)), bottom: window.innerHeight - r.top + 8 }
          : { left: r.right + 8, bottom: Math.max(8, window.innerHeight - r.bottom) }
      );
    }
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !moreBtnRef.current?.contains(t)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const moreItems: { label: string; icon: React.ReactNode; run: () => void }[] = [
    { label: t("web.ribbon.attachments"), icon: <AttachmentIcon />, run: props.onAttachments },
    { label: t("web.ribbon.themes"), icon: <ThemeIcon />, run: props.onThemes },
    { label: t("web.ribbon.snippets"), icon: <SnippetsIcon />, run: props.onSnippets },
    { label: t("web.ribbon.trash"), icon: <TrashIcon size={16} />, run: props.onTrash },
  ];

  return (
    <div className="ribbon">
      <div className="ribbon-top" style={{ overflowY: "auto", scrollbarWidth: "none", minHeight: 0 }}>
        <button className="ribbon-btn" title={t("web.ribbon.quickOpen")} onClick={onQuickOpen}>
          <QuickOpenIcon />
        </button>
        <button className="ribbon-btn" title={t("shell.ribbon.newNote")} onClick={onNewNote}>
          <NewNoteIcon />
        </button>
        <button className="ribbon-btn" title={t("web.ribbon.commandPalette")} onClick={onCommandPalette}>
          <CommandIcon />
        </button>
        <button className="ribbon-btn" title={t("shell.ribbon.search")} onClick={onSearch}>
          <SearchIcon />
        </button>
        <button className="ribbon-btn" title={t("web.ribbon.outline")} onClick={onOutline} style={outlineActive ? ACTIVE_STYLE : undefined}>
          <OutlineIcon />
        </button>
        <button className="ribbon-btn" title={t("web.ribbon.tags")} onClick={onTags} style={tagsActive ? ACTIVE_STYLE : undefined}>
          <TagIcon />
        </button>
        <button className="ribbon-btn" title={t("web.ribbon.bookmarks")} onClick={onBookmarks} style={bookmarksActive ? ACTIVE_STYLE : undefined}>
          <BookmarkIcon />
        </button>
                {onAiChat && (
          <button className="ribbon-btn" title="AI Assistant (Chat & Vault)" onClick={onAiChat} style={aiChatActive ? ACTIVE_STYLE : undefined}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
            </svg>
          </button>
        )}
        {/* Core plugins (daily note, calendar, flashcards, …): everyday tools, so on the top rail. */}
        {coreRibbon}
      </div>
      <div className="ribbon-bottom" style={{ flexShrink: 0 }}>
        {pluginPanels.map((p) => (
          <button
            key={p.key}
            className="ribbon-btn"
            title={p.title}
            onClick={() => onPluginPanel?.(p.key)}
            style={{ fontSize: 12, fontWeight: 600, ...(activePluginPanel === p.key ? { color: "var(--accent)" } : {}) }}
          >
            {(p.icon && p.icon.length <= 2 ? p.icon : p.title.charAt(0)).toUpperCase()}
          </button>
        ))}
        <button
          ref={moreBtnRef}
          className="ribbon-btn"
          title={t("web.ribbon.more")}
          onClick={() => setMoreOpen((v) => !v)}
          style={moreOpen ? ACTIVE_STYLE : undefined}
        >
          <MoreIcon />
        </button>
        <button className="ribbon-btn" title={t("web.ribbon.sync")} onClick={onSync} style={syncAttention ? { color: "var(--yellow)" } : undefined}>
          <SyncIcon />
        </button>
        <button className="ribbon-btn" title={t("web.ribbon.plugins")} onClick={onPlugins}>
          <PluginIcon />
        </button>
        <button className="ribbon-btn" title={t("shell.settingsHotkey")} onClick={onSettings}>
          <SettingsIcon />
        </button>
      </div>

      {moreOpen && (
        <div
          ref={popRef}
          role="menu"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg"
          style={{ position: "fixed", left: pos.left, bottom: pos.bottom, zIndex: 60, minWidth: POPOVER_WIDTH, padding: 4 }}
        >
          {moreItems.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                it.run();
              }}
              className="w-full flex items-center gap-3 text-sm text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-md"
              style={{ padding: "7px 10px" }}
            >
              <span style={{ display: "flex", width: 18, justifyContent: "center", color: "var(--text-muted)" }}>{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
