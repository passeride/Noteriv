"use client";

import { useEffect, useState, useCallback, useMemo, useRef, type ComponentType } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { EditorView } from "@codemirror/view";
import SplitPane from "@/components/SplitPane";
import {
  QuickOpen,
  BacklinksPanel,
  OutgoingLinksPanel,
  OutlinePanel,
  TagPane,
  CommandPalette,
  BookmarksPanel,
  ConflictBanner,
  VaultSearch,
  PropertiesEditor,
  PropertiesView,
  usePropertyTypes,
  settingsPropertyTypesStore,
  adapterNoteEditor,
  type NoteEditor,
  NoteHoverPreview,
  AiSettingsModal,
} from "@noteriv/ui/panels";
import type { AiProviderConfig } from "@noteriv/core";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import { applyLanguage, storedLanguage } from "@/lib/i18n";
import ChatLayout from "@/components/ChatLayout";
import CollabPanel from "@/components/CollabPanel";
import VaultHeader from "@/components/VaultHeader";
import TabBar, { type TabBarTab } from "@/components/TabBar";
import Ribbon from "@/components/Ribbon";
import Sidebar from "@/components/Sidebar";
import NoteToolbar from "@/components/NoteToolbar";
import StatusBar from "@/components/StatusBar";
import { PluginMirror } from "@noteriv/ui/plugins/sandbox";
import { createUntitledNote } from "@/lib/note-names";
import { createWebVaultAdapter } from "@/lib/webVaultAdapter";
import { setImageLightboxHandler } from "@noteriv/ui/markdown/renderers/images";
import { setPostProcessorRunner } from "@noteriv/ui/markdown/vault-hooks";
import { CloseIcon } from "@/components/icons";
import { toggleBookmark, isBookmarked } from "@noteriv/core/bookmark-utils";
import { usePluginHost } from "@/lib/plugin-sandbox/usePluginHost";
import { webCorePluginConfig } from "@/lib/core-plugins";
import {
  CorePluginRibbonButtons,
  CorePluginStatusItems,
  CorePluginNoteToolbarButtons,
  CorePluginFileView,
  matchFileView,
  CorePluginAttachmentViewer,
  matchAttachmentViewer,
  CorePluginSidePanels,
  CorePluginViewOverlay,
  useCorePluginHost,
  useCorePluginHotkeys,
  useCorePlugins,
} from "@noteriv/ui/plugins";
import type { EditorApi } from "@noteriv/plugin-api";
import type { EditorSnapshot } from "@noteriv/ui/plugins/sandbox";
import { startCollab, type CollabSession, type CollabPeer } from "@/lib/collab";
import {
  webApi,
  ApiError,
  isEmailUnverified,
  type ApiVault,
  type VaultIndex,
  type ApiSyncConnection,
  type ApiWorkspaceState,
  type StaleNote,
  type ViewMode,
} from "@/lib/webApi";
import { contentHash } from "@/lib/content-hash";
import { isNetworkError, staleNote } from "@/lib/offline";
import { dropPendingEdit, getPendingEdit, getStoredNote, kvGet, kvSet, putPendingEdit, storeNote } from "@/lib/offline-store";
import { flushPending } from "@/lib/offline-sync";
import { BUILT_IN_THEMES, getDefaultTheme, applyTheme, loadCustomThemes, type ThemeDefinition } from "@/lib/theme-utils";
import { loadSnippets, applySnippets, refreshSnippets, type CSSSnippet } from "@/lib/css-snippets";
import {
  DEFAULT_HOTKEYS,
  mergeHotkeys,
  hotkeysToOverrideMap,
  matchesHotkey,
  detectPlatform,
  type HotkeyBinding,
  type HotkeyAction,
} from "@/lib/hotkeys";
import { wrapSelection, insertLink, insertImage, insertBlockquote, insertCodeBlock, insertTaskList, insertTable, insertHorizontalRule, insertAtCursor, runFormattingAction } from "@noteriv/ui/editor/editor-commands";
import { DEFAULT_EDITOR_SETTINGS } from "@/lib/settings";
import { resolveLinkTarget, rewriteLinksForMoves, updateLinksAfterMove, type LinkUpdateResult, type PathMove } from "@noteriv/core/link-rename";
import { anchorLine, parseLinkTarget, type Anchor } from "@noteriv/core/note-embed";
import { bumpEmbedVersion, getEmbedVersion, setEmbedSource } from "@noteriv/ui/markdown/vault-hooks";
import { useIsPhone } from "@/lib/use-is-phone";
import TermsGate from "@/components/TermsGate";

const RECENT_COMMANDS_KEY = "noteriv-recent-commands";

function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentCommand(action: string) {
  try {
    const prev = loadRecentCommands().filter((a) => a !== action);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify([action, ...prev].slice(0, 5)));
  } catch {
    // localStorage unavailable (private window etc.) — recent list is a convenience, not load-bearing
  }
}

const PublishPreview = dynamic(() => import("@/components/PublishPreview"), { ssr: false });

// The editor (CodeMirror with its language parsers) is the heaviest part of the page: it loads when a note opens, and
// is prefetched once the vault has loaded and the browser is idle (see the effect below the index load).
type EditorModule = typeof import("@noteriv/ui/editor");
/** Set once the editor module has loaded. */
let editorModule: EditorModule | null = null;
const loadEditor = () => import("@noteriv/ui/editor").then((m) => (editorModule = m));
/**
 * A component of the editor module. Through `dynamic()` it suspends on its first mount even when the module is already
 * here, and React then holds the reveal back for ~300 ms; so once the module has loaded (prefetched), it is rendered
 * directly. The choice is made once per mount, so a mounted editor never swaps implementation.
 */
function editorPart<P extends object>(pick: (m: EditorModule) => ComponentType<P>) {
  const Lazy = dynamic(() => loadEditor().then(pick), { ssr: false }) as ComponentType<P>;
  return function EditorPart(props: P) {
    const [Part] = useState(() => (editorModule ? pick(editorModule) : Lazy));
    return <Part {...props} />;
  };
}
const Editor = editorPart((m) => m.Editor);
const SourceEditor = editorPart((m) => m.SourceEditor);
const ReadOnlyView = editorPart((m) => m.ReadOnlyView);
const FormattingToolbar = editorPart((m) => m.FormattingToolbar);

// Dialogs opened on demand.
const PluginManager = dynamic(() => import("@/components/PluginManager"), { ssr: false });
const CSSSnippets = dynamic(() => import("@/components/CSSSnippets"), { ssr: false });
const SettingsModal = dynamic(() => import("@/components/SettingsModal"), { ssr: false });
const ImportVault = dynamic(() => import("@/components/ImportVault"), { ssr: false });
const AppImport = dynamic(() => import("@noteriv/ui/panels").then((m) => m.AppImport), { ssr: false });
const DiagnosticsModal = dynamic(() => import("@/components/DiagnosticsModal"), { ssr: false });
const CreateVaultFromGithub = dynamic(() => import("@/components/sync/CreateVaultFromGithub"), { ssr: false });
const TrashPanel = dynamic(() => import("@/components/TrashPanel"), { ssr: false });
const AttachmentManager = dynamic(() => import("@/components/AttachmentManager"), { ssr: false });
const FileRecovery = dynamic(() => import("@/components/FileRecovery"), { ssr: false });
const PdfPreviewModal = dynamic(() => import("@/components/PdfPreviewModal"), { ssr: false });
/** PDF export (markdown → HTML, the PDF service): loaded when used. */
const loadPdfExport = () => import("@/lib/pdf-export");

const SAVE_DEBOUNCE_MS = 800;
const WORKSPACE_SAVE_DEBOUNCE_MS = 1000;
const DEFAULT_SIDEBAR_WIDTH = 250;

interface OpenTab {
  noteId: string;
  path: string;
  name: string;
  content: string;
  savedContent: string;
}

export default function VaultPage() {
  useLocale(); // re-render on a language change (labels passed to shared panels)
  const params = useParams<{ vaultId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const vaultId = params.vaultId;
  const vaultAdapter = useMemo(() => createWebVaultAdapter(vaultId), [vaultId]);
  /** Property types for the vault (one per property name), kept in the vault settings. */
  const propertyTypes = usePropertyTypes(useMemo(() => settingsPropertyTypesStore(vaultAdapter), [vaultAdapter]));
  const listNotes = useCallback(() => vaultAdapter.listNotes(), [vaultAdapter]);

  const [vault, setVault] = useState<ApiVault | null>(null);
  const [allVaults, setAllVaults] = useState<ApiVault[]>([]);
  const [index, setIndex] = useState<VaultIndex | null>(null);

  // Tabs — a web vault can now have several notes open at once, mirroring
  // desktop's tab-bar model (docs/plans/2026-10-13-noteriv-web-full-parity.md
  // Phase A1). `tabs` holds in-memory content; Postgres is still the source
  // of truth, refreshed via webApi.notes.get on open.
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [pinnedTabIds, setPinnedTabIds] = useState<Set<string>>(new Set());
  const [fileViewModes, setFileViewModes] = useState<Record<string, ViewMode>>({});
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const workspaceLoadedRef = useRef(false);
  /** The workspace state as the server has it (loaded, or last sent): an unchanged state is not sent again. */
  const savedWorkspaceRef = useRef<string | null>(null);
  // State twin of workspaceLoadedRef: the `?note=` effect must wait for the
  // saved-tabs restore to finish, otherwise the restore's setTabs overwrites
  // the tab `?note=` just opened.
  const restoreIncompleteRef = useRef(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const workspaceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isPhone = useIsPhone();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [backlinksVisible, setBacklinksVisible] = useState(false);
  const [outgoingVisible, setOutgoingVisible] = useState(false);
  const [propertiesVisible, setPropertiesVisible] = useState(false);
  const [aiChatVisible, setAiChatVisible] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProviderConfig>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("noteriv_ai_provider");
        return raw ? JSON.parse(raw) : { id: "claude-sdk", label: "Claude Code CLI (Local / Subscription)" };
      } catch {
        return { id: "claude-sdk", label: "Claude Code CLI (Local / Subscription)" };
      }
    }
    return { id: "claude-sdk", label: "Claude Code CLI (Local / Subscription)" };
  });

  const handleSaveAiProvider = useCallback((cfg: AiProviderConfig) => {
    setAiProvider(cfg);
    try {
      localStorage.setItem("noteriv_ai_provider", JSON.stringify(cfg));
    } catch {}
  }, []);

  const [relayUrl, setRelayUrl] = useState<string>(() => {
    // Empty = same-origin /api (the providers fall back to it). A saved localhost URL is useless off localhost.
    if (typeof window === "undefined") return "";
    try {
      const stored = localStorage.getItem("noteriv_ai_relay_url") || "";
      // Browsers sometimes autofill the field with an email; anything that is not an http(s) URL is dropped.
      const saved = /^https?:\/\//.test(stored) ? stored : "";
      const onLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(saved) && !onLocalhost ? "" : saved;
    } catch {
      return "";
    }
  });

  const handleSaveRelayUrl = useCallback((url: string) => {
    setRelayUrl(url);
    try {
      localStorage.setItem("noteriv_ai_relay_url", url);
    } catch {}
  }, []);

  const [outlineVisible, setOutlineVisible] = useState(false);
  const [tagPaneVisible, setTagPaneVisible] = useState(false);
  const [frontmatterCollapsed, setFrontmatterCollapsed] = useState(true);
  /** The vault search box (shared VaultSearch, as on desktop). */
  const [searchVisible, setSearchVisible] = useState(false);
  /** A line to jump to once the note it belongs to is open in the editor (from a search result). */
  const pendingJumpRef = useRef<{ noteId: string; line?: number; anchor?: Anchor } | null>(null);
  /** Asks the sidebar to put a just-created note into rename mode. */
  const [sidebarRenameRequest, setSidebarRenameRequest] = useState<{ id: string; name: string; nonce: number } | null>(null);
  const clearSidebarRenameRequest = useCallback(() => setSidebarRenameRequest(null), []);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [collabVisible, setCollabVisible] = useState(false);
  const [collabConnected, setCollabConnected] = useState(false);
  const [collabPeers, setCollabPeers] = useState<CollabPeer[]>([]);
  const [displayName, setDisplayName] = useState<string | undefined>(undefined);
  const [showCSSSnippets, setShowCSSSnippets] = useState(false);
  const [cssSnippets, setCSSSnippets] = useState<CSSSnippet[]>([]);
  const [currentThemeId, setCurrentThemeId] = useState<string>(getDefaultTheme().id);
  const [editorViewVersion, setEditorViewVersion] = useState(0);

  // Phase B2/B3 — per-user hotkey overrides + editor preferences
  // (web/server/src/routes/users.ts's /me/preferences), Settings modal, and
  // the Command Palette that reads the same hotkey list.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<"general" | "appearance" | "editor" | "shortcuts" | "sync" | "ecosystem">("general");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [hotkeyBindings, setHotkeyBindings] = useState<HotkeyBinding[]>(DEFAULT_HOTKEYS);
  const [editorSettings, setEditorSettingsState] = useState(DEFAULT_EDITOR_SETTINGS);
  const [platform, setPlatform] = useState("web");
  const [syncConnections, setSyncConnections] = useState<ApiSyncConnection[]>([]);
  const preferencesLoadedRef = useRef(false);
  /** Preferences as the server has them (loaded, or last sent): unchanged ones are not sent again. */
  const savedPreferencesRef = useRef<string | null>(null);
  const preferencesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase C — Trash/Bookmarks/Vault Insights/Templates/Note Composer/hover preview
  // (docs/plans/2026-10-13-noteriv-web-full-parity.md Phase C).
  const [showTrash, setShowTrash] = useState(false);
  const [showNewFromGithub, setShowNewFromGithub] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ blob: Blob; filename: string } | null>(null);
  const [zenMode, setZenMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  // key = `${pluginDbId}:${panelId}` of the plugin sidebar panel shown in place of the file tree
  const [activePluginPanel, setActivePluginPanel] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"current" | "new" | null>(null);
  /** Folder the import dialog starts aimed at (set from the file sidebar; "" = vault root). */
  const [importFolder, setImportFolder] = useState("");
  const [bookmarksVisible, setBookmarksVisible] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const bookmarkedNotes = useMemo(
    () =>
      bookmarks
        .map((id) => index?.notes.find((n) => n.id === id))
        .filter((n): n is NonNullable<typeof n> => !!n)
        .map((n) => ({ id: n.id, name: n.name, path: n.path })),
    [bookmarks, index]
  );
  const [showAttachments, setShowAttachments] = useState(false);
  /** An attachment shown by a core plugin's viewer (the PDF viewer), over the page. */
  const [attachmentView, setAttachmentView] = useState<{ target: string; name: string } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showPublishPreview, setShowPublishPreview] = useState(false);
  // D5/D6 (docs/plans/2026-10-13-noteriv-web-full-parity.md Phase D nhóm 4).
  const [showFileRecovery, setShowFileRecovery] = useState(false);
  const [wikilinkHover, setWikilinkHover] = useState<{ target: string; x: number; y: number } | null>(null);
  const [showAppImport, setShowAppImport] = useState(false);
  const wikilinkHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const collabPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const collabSessionRef = useRef<CollabSession | null>(null);

  const activeTab = tabs.find((t) => t.noteId === activeTabId) ?? null;
  const splitTab = splitTabId ? tabs.find((t) => t.noteId === splitTabId) ?? null : null;
  const draft = activeTab?.content ?? "";
  const viewMode: ViewMode = (activeTabId && fileViewModes[activeTabId]) || "live";
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Last content applied FROM a remote collab update. CodeMirror's update
  // listener fires for *any* doc change, including the programmatic dispatch
  // Editor.tsx does to reflect a new `content` prop — so a remote update
  // flows: collab onUpdate -> setActiveTabContent -> Editor re-renders ->
  // CodeMirror dispatch -> onChange -> onDraftChange. Without this guard,
  // onDraftChange would immediately push that same content back into Yjs as
  // if the user had typed it, and two tabs would echo each other's updates
  // back and forth, which Yjs's CRDT merges as concurrent edits — corrupting
  // the text within a few round trips. Comparing against the exact string we
  // just received (set synchronously, before the state update) closes the
  // loop regardless of timing.
  const lastRemoteContentRef = useRef<string | null>(null);

  useEffect(() => {
    webApi.auth.me().then((u) => setDisplayName(u.displayName)).catch(() => undefined);
    webApi.vaults.list().then(setAllVaults).catch(() => undefined);
  }, []);

  // D9 — image lightbox: double-click on a rendered <img> (Editor or
  // ReadOnlyView, both share the same renderer pipeline) opens it enlarged.
  useEffect(() => {
    setImageLightboxHandler((src) => setLightboxSrc(src));
    return () => setImageLightboxHandler(null);
  }, []);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  function setActiveTabContent(noteId: string, content: string) {
    setTabs((prev) => prev.map((t) => (t.noteId === noteId ? { ...t, content } : t)));
  }

  const editorSettingsRef = useRef(editorSettings);
  editorSettingsRef.current = editorSettings;

  // Notes whose last save failed (no network, server error). They stay "unsaved", the status bar says so, and the
  // latest text is sent again when the browser is back online, every 15 s, or on the next edit.
  const [saveFailed, setSaveFailed] = useState(false);
  const failedSavesRef = useRef(new Set<string>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  /** The server's text of each open note as this page last saw it: what an edit started from (sent as baseHash). */
  const serverBaseRef = useRef<Record<string, string>>({});
  /** Saves of one note run one after the other, so a save never starts from a base the previous one is changing. */
  const saveChainRef = useRef<Record<string, Promise<void>>>({});
  /** The last request failed for want of a network: the page shows what this device kept. */
  const [networkDown, setNetworkDown] = useState(false);
  const collabNoteRef = useRef<string | null>(null);
  const openNoteRef = useRef<(noteId: string) => Promise<void>>(async () => {});
  /** Notes opened with an edit still waiting to be sent: saved again once their tab is on screen. */
  const resendRef = useRef(new Set<string>());

  function persistNote(noteId: string, content: string): Promise<void> {
    const next = (saveChainRef.current[noteId] ?? Promise.resolve()).then(() => saveNow(noteId, content));
    saveChainRef.current[noteId] = next;
    return next;
  }

  async function saveNow(noteId: string, content: string) {
    const tab = tabsRef.current.find((t) => t.noteId === noteId);
    const base = serverBaseRef.current[noteId] ?? tab?.savedContent;
    if (base === content) {
      // Nothing new for the server (e.g. the editor normalised the text it was given).
      failedSavesRef.current.delete(noteId);
      if (failedSavesRef.current.size === 0) setSaveFailed(false);
      void dropPendingEdit(noteId);
      setTabs((prev) => prev.map((t) => (t.noteId === noteId ? { ...t, savedContent: content } : t)));
      return;
    }
    // A note being edited together (collab) is written by the collab server too: no version check there, as before.
    const baseHash = base !== undefined && collabNoteRef.current !== noteId ? (await contentHash(base)) ?? undefined : undefined;
    try {
      const note = await webApi.notes.update(vaultId, noteId, { content, baseHash });
      serverBaseRef.current[noteId] = note.content;
      void dropPendingEdit(noteId);
      void storeNote({ id: note.id, vaultId, path: note.path, name: note.name, content: note.content });
      setNetworkDown(false);
    } catch (err) {
      const stale = staleNote(err);
      if (stale) return onStaleSave(noteId, content, stale);
      // Kept on this device until the server takes it, so closing or reloading the page does not lose it.
      await putPendingEdit({ noteId, vaultId, path: tab?.path ?? "", name: tab?.name ?? "", content, base: base ?? content, queuedAt: Date.now() });
      if (isNetworkError(err)) setNetworkDown(true);
      failedSavesRef.current.add(noteId);
      setSaveFailed(true);
      return;
    }
    failedSavesRef.current.delete(noteId);
    if (failedSavesRef.current.size === 0) setSaveFailed(false);
    setTabs((prev) => prev.map((t) => (t.noteId === noteId ? { ...t, savedContent: content } : t)));
    refreshIndex();
    emitPluginEvent("file-save", tab?.path ?? null);
  }

  /**
   * The note changed elsewhere since this edit started. The server kept its text and saved this edit as a conflict
   * copy: the tab now shows the server's text, the copy opens beside it (its banner compares, uses or discards it).
   */
  async function onStaleSave(noteId: string, sent: string, stale: StaleNote) {
    serverBaseRef.current[noteId] = stale.note.content;
    void dropPendingEdit(noteId);
    void storeNote({ id: noteId, vaultId, path: stale.note.path, name: stale.note.name, content: stale.note.content });
    failedSavesRef.current.delete(noteId);
    if (failedSavesRef.current.size === 0) setSaveFailed(false);
    // Typing that went on after this save was sent belongs to the copy too.
    const latest = tabsRef.current.find((t) => t.noteId === noteId)?.content;
    if (latest !== undefined && latest !== sent) await webApi.notes.update(vaultId, stale.copy.id, { content: latest }).catch(() => undefined);
    if (saveTimers.current[noteId]) clearTimeout(saveTimers.current[noteId]);
    setTabs((prev) => prev.map((t) => (t.noteId === noteId ? { ...t, content: stale.note.content, savedContent: stale.note.content } : t)));
    setPageNotice(t("web.offline.conflict", { name: stale.copy.name }));
    refreshIndex();
    void openNoteRef.current(stale.copy.id);
  }

  /**
   * Notes moved or renamed in the file tree: rewrite the links that pointed at their old paths (setting "Update links
   * when renaming", on by default). A tab with unsaved edits is not written from here: its text gets the same rewrite
   * and its own save sends it, against the base it started from.
   */
  async function handleNotesMoved(moves: PathMove[], before: string[]) {
    const renamed = new Map(moves.map((m) => [m.from, m.to]));
    const backToBefore = new Map(moves.map((m) => [m.to, m.from]));
    setTabs((prev) =>
      prev.map((tab) => {
        const to = renamed.get(tab.path);
        return to ? { ...tab, path: to, name: to.slice(to.lastIndexOf("/") + 1) } : tab;
      })
    );
    if (!editorSettingsRef.current.autoUpdateLinks) return;
    const unsavedIds = new Set(tabsRef.current.filter((tab) => tab.content !== tab.savedContent).map((tab) => tab.noteId));
    let result: LinkUpdateResult;
    try {
      result = await updateLinksAfterMove(vaultAdapter, moves, before, (ref) => unsavedIds.has(ref.id));
    } catch {
      setPageNotice(t("shell.files.linksNotUpdated"));
      return;
    }
    const byId = new Map(result.changed.map((c) => [c.id, c]));
    for (const note of result.changed) {
      serverBaseRef.current[note.id] = note.content;
      void storeNote({ id: note.id, vaultId, path: note.path, name: note.name, content: note.content });
    }
    const rewriteTab = (tab: { path: string; content: string }) => {
      const sourceAfter = renamed.get(tab.path) ?? tab.path;
      const sourceBefore = backToBefore.get(sourceAfter) ?? sourceAfter;
      return rewriteLinksForMoves(tab.content, { sourceBefore, sourceAfter, moves, before });
    };
    // A tab with no unsaved text shows the server's new text. One with unsaved text (from before the rename, or typed
    // while it ran) keeps it, rewritten the same way, and saves it through the usual debounced path; its base is the
    // server's new text, so that save is not taken for a stale one.
    const rewritten = new Map<string, string>();
    for (const tab of tabsRef.current) {
      if (tab.content === tab.savedContent || !(unsavedIds.has(tab.noteId) || byId.has(tab.noteId))) continue;
      const content = rewriteTab(tab);
      if (content !== tab.content) rewritten.set(tab.noteId, content);
    }
    setTabs((prev) =>
      prev.map((tab) => {
        const note = byId.get(tab.noteId);
        if (note && tab.content === tab.savedContent) return { ...tab, content: note.content, savedContent: note.content };
        if (!note && !unsavedIds.has(tab.noteId)) return tab;
        const content = rewriteTab(tab);
        return content === tab.content ? tab : { ...tab, content };
      })
    );
    for (const [noteId, content] of rewritten) scheduleSave(noteId, content);
    const count = result.changed.length + Array.from(rewritten.keys()).filter((id) => !byId.has(id)).length;
    if (result.failed.length > 0) setPageNotice(t("shell.files.linksNotUpdated"));
    else if (count > 0) setPageNotice(t("shell.files.linksUpdated", { count }));
    refreshIndex();
  }

  /**
   * Edits from the link panels: a note open in a tab is changed there (the editor shows it, the usual save sends it);
   * any other note is read and written by the adapter, never over a newer version.
   */
  const editNoteInTabs: NoteEditor = async (id, transform) => {
    const tab = tabsRef.current.find((t) => t.noteId === id);
    if (!tab) return adapterNoteEditor(vaultAdapter)(id, transform);
    const next = transform(tab.content);
    if (next === null || next === tab.content) return false;
    setTabs((prev) => prev.map((t) => (t.noteId === id ? { ...t, content: transform(t.content) ?? t.content } : t)));
    scheduleSave(id, next);
    return true;
  };

  /**
   * A note's text as a tab: the server's (also kept on this device) or, offline, the copy kept here. An edit still
   * waiting to be sent wins over both; it shows as unsaved and is sent again.
   */
  async function tabForNote(note: { id: string; path: string; name: string; content: string }, fromServer: boolean): Promise<OpenTab> {
    if (fromServer) void storeNote({ id: note.id, vaultId, path: note.path, name: note.name, content: note.content });
    const pending = await getPendingEdit(note.id);
    if (pending && pending.content !== note.content) {
      serverBaseRef.current[note.id] = pending.base;
      resendRef.current.add(note.id);
      return { noteId: note.id, path: note.path, name: note.name, content: pending.content, savedContent: pending.base };
    }
    if (pending) void dropPendingEdit(note.id);
    serverBaseRef.current[note.id] = note.content;
    return { noteId: note.id, path: note.path, name: note.name, content: note.content, savedContent: note.content };
  }

  /** A note for a tab; offline, the copy kept on this device. "missing": deleted (404); "unavailable": not kept here. */
  async function fetchNoteTab(noteId: string): Promise<OpenTab | "missing" | "unavailable"> {
    try {
      const note = await webApi.notes.get(vaultId, noteId);
      return tabForNote(note, true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return "missing";
      if (!isNetworkError(err)) throw err;
      setNetworkDown(true);
      const kept = await getStoredNote(noteId);
      return kept ? tabForNote(kept, false) : "unavailable";
    }
  }

  // Tabs opened with a waiting edit: send it now (or keep it waiting if still offline).
  useEffect(() => {
    for (const noteId of [...resendRef.current]) {
      const tab = tabs.find((t) => t.noteId === noteId);
      if (!tab) continue;
      resendRef.current.delete(noteId);
      void persistNote(noteId, tab.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  useEffect(() => {
    if (!saveFailed && !networkDown) return;
    const retry = () => {
      for (const noteId of [...failedSavesRef.current]) {
        const tab = tabsRef.current.find((t) => t.noteId === noteId);
        if (!tab) failedSavesRef.current.delete(noteId);
        else void persistNote(noteId, tab.content);
      }
      if (failedSavesRef.current.size === 0) setSaveFailed(false);
      void sendWaitingEdits();
      refreshIndex();
    };
    const timer = setInterval(retry, 15_000);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFailed, networkDown]);

  /** Edits kept on this device for notes that are not open here (an open one is saved by its tab). */
  async function sendWaitingEdits() {
    const open = new Set(tabsRef.current.map((t) => t.noteId));
    const result = await flushPending(vaultId, open);
    if (result.saved.length) setNetworkDown(false);
    for (const { stale } of result.conflicts) setPageNotice(t("web.offline.conflict", { name: stale.copy.name }));
    if (result.saved.length || result.conflicts.length) refreshIndex();
  }

  // Edits kept on this device from an earlier visit (or another vault page) go out once the page has loaded.
  useEffect(() => {
    if (workspaceReady) void sendWaitingEdits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceReady]);

  // A network request that failed and was not handled (creating, renaming, deleting… need a connection): say so.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (!isNetworkError(e.reason)) return;
      e.preventDefault();
      setNetworkDown(true);
      setPageNotice(t("web.offline.needsNetwork"));
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  function scheduleSave(noteId: string, content: string) {
    // A new edit is "unsaved" until its own save is tried; an earlier failure no longer describes it.
    if (failedSavesRef.current.delete(noteId) && failedSavesRef.current.size === 0) setSaveFailed(false);
    if (saveTimers.current[noteId]) clearTimeout(saveTimers.current[noteId]);
    saveTimers.current[noteId] = setTimeout(() => {
      persistNote(noteId, content);
    }, editorSettingsRef.current.autoSaveInterval || SAVE_DEBOUNCE_MS);
  }

  function forceSaveActiveTab() {
    if (!activeTabId) return;
    if (saveTimers.current[activeTabId]) clearTimeout(saveTimers.current[activeTabId]);
    persistNote(activeTabId, draftRef.current);
  }

  // Join/leave the realtime collab room for the active note as the panel is
  // toggled or the active tab changes — a web note already has a durable id,
  // so "the room" is just `note:{id}`, no code to generate/share like desktop
  // needed.
  useEffect(() => {
    if (!collabVisible || !activeTabId) {
      collabSessionRef.current?.destroy();
      collabSessionRef.current = null;
      setCollabConnected(false);
      setCollabPeers([]);
      return;
    }

    const noteId = activeTabId;
    collabNoteRef.current = noteId;
    let cancelled = false;
    setCollabConnected(false);
    setCollabPeers([]);
    startCollab(
      noteId,
      draftRef.current,
      (content) => {
        lastRemoteContentRef.current = content;
        setActiveTabContent(noteId, content);
        scheduleSave(noteId, content);
      },
      setCollabPeers,
      displayName
    ).then((session) => {
      if (cancelled || !session) return;
      collabSessionRef.current = session;
      setCollabConnected(true);
    });

    return () => {
      cancelled = true;
      collabNoteRef.current = null;
      collabSessionRef.current?.destroy();
      collabSessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabVisible, activeTabId]);

  // The file tree; kept on this device, which is what shows when the network is down.
  const refreshIndex = useCallback(() => {
    webApi.vaults
      .index(vaultId)
      .then((idx) => {
        setIndex(idx);
        void kvSet(`index:${vaultId}`, idx);
      })
      .catch(async (err) => {
        if (!isNetworkError(err)) return;
        setNetworkDown(true);
        const kept = await kvGet<VaultIndex>(`index:${vaultId}`);
        if (kept) setIndex((cur) => cur ?? kept);
      });
  }, [vaultId]);

  useEffect(() => {
    refreshIndex();
  }, [refreshIndex]);

  // Once the vault is on screen, fetch the editor while the browser is idle, so opening a note does not wait for it.
  const vaultShown = index !== null;
  useEffect(() => {
    if (!vaultShown) return;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const prefetch = () => void loadEditor().catch(() => {});
    if (idle) {
      const id = idle(prefetch, { timeout: 3000 });
      return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(prefetch, 1500);
    return () => clearTimeout(t);
  }, [vaultShown]);

  const editorBridge: EditorApi = {
      getContent: () => draftRef.current,
      setContent: (content) => onDraftChange(content),
      insertAtCursor: (text) => {
        const view = editorViewRef.current;
        if (!view) return;
        const pos = view.state.selection.main.head;
        view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
      },
      getSelection: () => {
        const view = editorViewRef.current;
        if (!view) return "";
        const sel = view.state.selection.main;
        return view.state.sliceDoc(sel.from, sel.to);
      },
      replaceSelection: (text) => {
        const view = editorViewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } });
      },
      getCursorPosition: () => {
        const view = editorViewRef.current;
        if (!view) return { line: 0, ch: 0 };
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        return { line: line.number - 1, ch: head - line.from };
      },
      setCursor: ({ line, ch }) => {
        const view = editorViewRef.current;
        if (!view) return;
        const docLine = view.state.doc.line(Math.min(Math.max(line + 1, 1), view.state.doc.lines));
        view.dispatch({ selection: { anchor: docLine.from + Math.min(Math.max(ch, 0), docLine.length) }, scrollIntoView: true });
        view.focus();
      },
  };
  /**
   * `workspace.openFile` for both plugin tiers. A note the plugin has just created is not in `index` yet (the refresh
   * is still in flight), so a miss asks the adapter before giving up.
   */
  const openPluginPath = async (path: string) => {
    const note = index?.notes.find((n) => n.path === path) ?? (await vaultAdapter.listNotes()).find((n) => n.path === path);
    if (!note) return false;
    openNote(note.id);
    return true;
  };
  const pluginHost = usePluginHost(vaultId, vaultAdapter, editorBridge, refreshIndex, openPluginPath);

  // Core plugins (Plugin API v1, trusted tier): loaded in-page by dynamic import, state in vault settings.
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activeTab?.path ?? null;
  const corePluginConfig = useMemo(() => webCorePluginConfig(vaultAdapter), [vaultAdapter]);
  const corePluginHost = useCorePluginHost(corePluginConfig, {
    editor: editorBridge,
    getCurrentFile: () => activePathRef.current,
    // A core plugin opening a note (the PDF viewer's export…) brings the editor forward.
    openFile: async (path) => {
      const ok = await openPluginPath(path);
      if (ok) {
        setShowAttachments(false);
        setAttachmentView(null);
      }
      return ok;
    },
    onVaultChanged: refreshIndex,
    // `vault.edit` (views, …): a note open in a tab is changed there.
    editNote: editNoteInTabs,
  });
  const corePlugins = useCorePlugins(corePluginHost.host);
  useCorePluginHotkeys(corePlugins.contributions.commands);
  // Turning a core plugin on/off is saved per vault; tell the other open tabs of this vault so they follow without a reload.
  const corePluginChannelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const host = corePluginHost.host;
    if (!host || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`noteriv-core-plugins:${vaultId}`);
    channel.onmessage = (e: MessageEvent<{ id?: unknown; enabled?: unknown }>) => {
      if (typeof e.data?.id === "string" && typeof e.data.enabled === "boolean") {
        void host.registry.applyExternalChange(e.data.id, e.data.enabled);
      }
    };
    corePluginChannelRef.current = channel;
    return () => {
      channel.close();
      if (corePluginChannelRef.current === channel) corePluginChannelRef.current = null;
    };
  }, [corePluginHost.host, vaultId]);
  const toggleCorePlugin = useCallback(
    async (id: string, enabled: boolean) => {
      await corePlugins.setEnabled(id, enabled);
      corePluginChannelRef.current?.postMessage({ id, enabled });
    },
    [corePlugins]
  );

  // Core plugins' markdown post-processors run over each rendered piece of a note.
  useEffect(() => {
    const host = corePluginHost.host;
    if (!host) return;
    setPostProcessorRunner((el, ctx) => host.runPostProcessors(el, ctx));
    return () => setPostProcessorRunner(null);
  }, [corePluginHost.host]);
  // File Recovery (core) links to the Time scrubber while the Note history plugin is on.
  const scrubberCommand = corePlugins.contributions.commands.find((c) => c.key === "note-history:scrubber");
  /** Both plugin tiers receive the same app events. */
  const emitPluginEvent = (event: Parameters<typeof pluginHost.emitEvent>[0], ...args: unknown[]) => {
    pluginHost.emitEvent(event, ...args);
    corePluginHost.host?.emit(event, ...args);
  };

  // --- Plugin sandbox feeds (sync editor snapshot + desktop-style events) ---
  // The sandbox's api.editor.* are synchronous like desktop's, so we push a
  // snapshot instead of answering RPC calls. See public/plugin-sandbox.html.
  const activePath = activeTab?.path ?? null;
  const buildEditorSnapshot = useCallback((): EditorSnapshot => {
    const view = editorViewRef.current;
    let selection = "";
    let cursor = { line: 0, ch: 0 };
    if (view) {
      const sel = view.state.selection.main;
      selection = view.state.sliceDoc(sel.from, sel.to);
      const line = view.state.doc.lineAt(sel.head);
      cursor = { line: line.number - 1, ch: sel.head - line.from };
    }
    return { content: activePath ? draftRef.current : null, selection, cursor, currentFile: activePath };
  }, [activePath]);

  useEffect(() => {
    pluginHost.syncEditorState(buildEditorSnapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, activePath, editorViewVersion, buildEditorSnapshot]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSelection = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        pluginHost.syncEditorState(buildEditorSnapshot());
      }, 150);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildEditorSnapshot]);

  const prevDraftRef = useRef<{ tabId: string | null; content: string }>({ tabId: null, content: "" });
  useEffect(() => {
    const prev = prevDraftRef.current;
    if (prev.tabId === activeTabId && prev.content !== draft) emitPluginEvent("editor-change", draft);
    prevDraftRef.current = { tabId: activeTabId, content: draft };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, activeTabId]);

  useEffect(() => {
    if (activePath) emitPluginEvent("file-open", activePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  const prevNotePathsRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!index) return;
    const current = new Map(index.notes.map((n) => [n.id, n.path]));
    const prev = prevNotePathsRef.current;
    prevNotePathsRef.current = current;
    if (!prev) return; // first load isn't a change
    let changed = false;
    for (const [id, path] of current) {
      if (!prev.has(id)) {
        emitPluginEvent("file-create", path);
        changed = true;
      }
    }
    for (const [id, path] of prev) {
      if (!current.has(id)) {
        emitPluginEvent("file-delete", path);
        changed = true;
      }
    }
    if (changed) emitPluginEvent("vault-change");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Search results open a note at a line, links to a heading or block (`[[Note#Goals]]`) at that place: move the
  // cursor there once that note's editor is ready.
  useEffect(() => {
    const pending = pendingJumpRef.current;
    const view = editorViewRef.current;
    if (!pending || pending.noteId !== activeTabId || !view) return;
    // A heading or block is looked up in the note's own text: wait until the editor holds it (not the previous note's).
    if (pending.anchor && view.state.doc.toString() !== draft) return;
    const target = pending.line ?? (pending.anchor ? anchorLine(draft, pending.anchor) : null);
    pendingJumpRef.current = null;
    if (!target) return;
    const line = view.state.doc.line(Math.min(Math.max(target, 1), view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  }, [activeTabId, editorViewVersion, draft]);

  const openNote = useCallback(
    async (noteId: string) => {
      setSearchVisible(false);

      const alreadyOpen = tabs.some((t) => t.noteId === noteId);
      if (alreadyOpen) {
        setActiveTabId(noteId);
        return;
      }
      let tab: OpenTab | "missing" | "unavailable";
      try {
        tab = await fetchNoteTab(noteId);
      } catch {
        setPageNotice(t("web.notice.openFailed"));
        return;
      }
      if (tab === "missing" || tab === "unavailable") {
        setPageNotice(tab === "missing" ? t("web.notice.noteMissing") : t("web.offline.notKept"));
        return;
      }
      const opened = tab;
      setTabs((prev) => (prev.some((t) => t.noteId === noteId) ? prev : [...prev, opened]));
      setActiveTabId(noteId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vaultId, tabs]
  );
  openNoteRef.current = openNote;

  function closeTab(noteId: string) {
    if (pinnedTabIds.has(noteId)) return;
    if (splitTabId === noteId) setSplitTabId(null);
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.noteId === noteId);
      const next = prev.filter((t) => t.noteId !== noteId);
      if (activeTabId === noteId) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newIdx]?.noteId ?? null);
      }
      return next;
    });
  }

  function reorderTabs(from: number, to: number) {
    setTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function handleTogglePin(noteId: string) {
    setPinnedTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function handleCloseOtherTabs(noteId: string) {
    setTabs((prev) => prev.filter((t) => t.noteId === noteId || pinnedTabIds.has(t.noteId)));
    setActiveTabId(noteId);
  }

  function handleCloseAllTabs() {
    setTabs((prev) => {
      const remaining = prev.filter((t) => pinnedTabIds.has(t.noteId));
      if (activeTabId && !pinnedTabIds.has(activeTabId)) {
        setActiveTabId(remaining[0]?.noteId ?? null);
      }
      return remaining;
    });
    setSplitTabId(null);
  }

  function handleCloseTabsToRight(noteId: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.noteId === noteId);
      if (idx === -1) return prev;
      const next = prev.filter((t, i) => i <= idx || pinnedTabIds.has(t.noteId));
      if (activeTabId && !next.some((t) => t.noteId === activeTabId)) setActiveTabId(noteId);
      return next;
    });
  }

  function handleSplitRight(noteId: string) {
    setSplitTabId(noteId);
  }

  function handleCloseSplit() {
    setSplitTabId(null);
  }

  function handleViewModeChange(mode: ViewMode) {
    if (!activeTabId) return;
    setFileViewModes((prev) => ({ ...prev, [activeTabId]: mode }));
  }

  // Load this vault's config (theme/snippets) and this user's workspace
  // state (open tabs/active tab/pinned/view-modes) in parallel.
  useEffect(() => {
    webApi.vaults
      .get(vaultId)
      .then((v) => {
        void kvSet(`vault:${vaultId}`, v);
        return v;
      })
      .catch(async (err) => {
        // Offline: the copy kept on this device, if this vault was opened here before.
        const kept = isNetworkError(err) ? await kvGet<ApiVault>(`vault:${vaultId}`) : undefined;
        if (!kept) throw err;
        setNetworkDown(true);
        return kept;
      })
      .then(async (v) => {
        setVault(v);

        setBookmarks((v.settings.bookmarks as string[] | undefined) ?? []);

        const themeId = (v.settings.themeId as string | undefined) ?? getDefaultTheme().id;
        setCurrentThemeId(themeId);
        const builtIn = BUILT_IN_THEMES.find((t) => t.id === themeId);
        if (builtIn) {
          applyTheme(builtIn);
        } else {
          const customs = await loadCustomThemes(vaultId).catch(() => (v.settings.customThemes as ThemeDefinition[] | undefined) ?? []);
          applyTheme(customs.find((t) => t.id === themeId) ?? getDefaultTheme());
        }

        const snips = await loadSnippets(vaultId).catch(() => [] as CSSSnippet[]);
        setCSSSnippets(snips);
        applySnippets(snips);
      })
      .catch(() => router.replace("/vaults"));
    refreshIndex();

    // A superseded run (StrictMode double-effect, vaultId change) must not
    // apply its results: a late setActiveTabId would clobber a tab that
    // `?note=` already opened after the first run signalled ready.
    let cancelled = false;
    webApi.workspace
      .getState(vaultId)
      .then((state) => {
        void kvSet(`ws:${vaultId}`, state);
        return state;
      })
      .catch(async (err) => {
        const kept = isNetworkError(err) ? await kvGet<ApiWorkspaceState>(`ws:${vaultId}`) : undefined;
        if (!kept) throw err;
        // Shown from this device: the server's copy must not be overwritten from it.
        restoreIncompleteRef.current = true;
        setNetworkDown(true);
        return kept;
      })
      .then(async (state) => {
        // Tabs to restore will show an editor: fetch its chunk alongside the notes, not after they render.
        if (state.openTabs.length > 0) void loadEditor().catch(() => {});
        // Only a 404 means the note is really gone and its tab should be
        // dropped. Any other failure (network blip, 5xx) leaves the restore
        // incomplete: those tabs are skipped for this session, but we must not
        // persist the shrunken list over the server's good copy.
        let transientFailure = false;
        const inlined = state.notes ?? {};
        const missing = new Set(state.missingNoteIds ?? []);
        const notes = await Promise.all(
          state.openTabs.map((t) =>
            inlined[t.noteId]
              ? tabForNote(inlined[t.noteId], !restoreIncompleteRef.current)
              : missing.has(t.noteId)
              ? Promise.resolve(null)
              : fetchNoteTab(t.noteId)
                  .then((tab) => {
                    if (tab === "missing") return null;
                    if (tab === "unavailable") transientFailure = true;
                    return tab === "unavailable" ? null : tab;
                  })
                  .catch(() => {
                    transientFailure = true;
                    return null;
                  })
          )
        );
        if (cancelled) return;
        const restoredTabs = notes.filter((t): t is OpenTab => t !== null);
        if (transientFailure) {
          restoreIncompleteRef.current = true;
          setPageNotice(t("web.notice.tabsNotRestored"));
        }
        savedWorkspaceRef.current = JSON.stringify({
          openTabs: state.openTabs.map((t) => ({ noteId: t.noteId, path: t.path, name: t.name })),
          activeTabId: state.activeTabId ?? null,
          pinnedTabIds: state.pinnedTabIds,
          fileViewModes: state.fileViewModes,
        });
        setTabs(restoredTabs);
        // Prune ids of dropped tabs so dead pins/view-modes don't linger server-side.
        const liveIds = new Set(restoredTabs.map((t) => t.noteId));
        setPinnedTabIds(new Set(state.pinnedTabIds.filter((id) => liveIds.has(id))));
        setFileViewModes(Object.fromEntries(Object.entries(state.fileViewModes).filter(([id]) => liveIds.has(id))));
        setActiveTabId(
          state.activeTabId && restoredTabs.some((t) => t.noteId === state.activeTabId)
            ? state.activeTabId
            : restoredTabs[0]?.noteId ?? null
        );
      })
      .catch(() => {
        // getState itself failed: never persist an empty workspace over the saved one.
        restoreIncompleteRef.current = true;
      })
      .finally(() => {
        if (cancelled) return;
        workspaceLoadedRef.current = !restoreIncompleteRef.current;
        setWorkspaceReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId, router, refreshIndex]);

  // Persist workspace state (shape only — noteId/path/name, not content;
  // note content already autosaves via scheduleSave) whenever it changes,
  // debounced the same way note autosave is.
  useEffect(() => {
    if (!workspaceLoadedRef.current) return;
    const state = {
      openTabs: tabs.map((t) => ({ noteId: t.noteId, path: t.path, name: t.name })),
      activeTabId: activeTabId ?? null,
      pinnedTabIds: Array.from(pinnedTabIds),
      fileViewModes,
    };
    const serialized = JSON.stringify(state);
    if (serialized === savedWorkspaceRef.current) return;
    if (workspaceSaveTimer.current) clearTimeout(workspaceSaveTimer.current);
    workspaceSaveTimer.current = setTimeout(() => {
      savedWorkspaceRef.current = serialized;
      // This device's copy too: offline, the open tabs come back from it (their text from the stored notes).
      void kvSet(`ws:${vaultId}`, state);
      webApi.workspace.updateState(vaultId, state).catch(() => undefined);
    }, WORKSPACE_SAVE_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId, tabs, activeTabId, pinnedTabIds, fileViewModes]);

  // Load per-user hotkey overrides + editor preferences once (device-wide
  // across vaults, not per-vault — matches webApi.preferences's /users/me
  // scope). Platform + recent-commands are per-device only (localStorage),
  // never sent to the server.
  useEffect(() => {
    setPlatform(detectPlatform());
    setRecentCommands(loadRecentCommands());
    webApi.preferences
      .get()
      .then((prefs) => {
        const bindings = mergeHotkeys(prefs.hotkeys);
        const loaded = { ...DEFAULT_EDITOR_SETTINGS, ...prefs.editorSettings };
        savedPreferencesRef.current = JSON.stringify({ hotkeys: hotkeysToOverrideMap(bindings), editorSettings: loaded });
        // A language picked on this device before the account had one (login page) becomes the account's choice:
        // it differs from what was loaded, so the next preferences save stores it.
        const settings = { ...loaded, language: loaded.language ?? storedLanguage() };
        applyLanguage(settings.language);
        setHotkeyBindings(bindings);
        setEditorSettingsState(settings);
      })
      .catch(() => undefined)
      .finally(() => {
        preferencesLoadedRef.current = true;
      });
  }, []);

  // Apply editor preferences as CSS vars globals.css already reads
  // (--editor-font/--editor-font-size/--editor-line-height — see
  // docs/plans/2026-10-13-noteriv-web-full-parity.md Phase B2).
  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font", editorSettings.editorFont);
    document.documentElement.style.setProperty("--editor-font-size", `${editorSettings.fontSize}px`);
    document.documentElement.style.setProperty("--editor-line-height", String(editorSettings.lineHeight));
  }, [editorSettings]);

  // Accent override (empty = whatever the active theme defines). Re-applied after theme changes
  // because applyTheme rewrites --accent.
  useEffect(() => {
    const root = document.documentElement;
    if (editorSettings.accentColor) root.style.setProperty("--accent", editorSettings.accentColor);
    else if (preferencesLoadedRef.current) root.style.removeProperty("--accent");
  }, [editorSettings.accentColor, currentThemeId]);

  // Collapse the sidebar on narrow windows (once per crossing, so the user can still reopen it).
  useEffect(() => {
    if (!editorSettings.autoCollapseSidebar) return;
    const query = window.matchMedia("(max-width: 800px)");
    const apply = (narrow: boolean) => narrow && setSidebarCollapsed(true);
    apply(query.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [editorSettings.autoCollapseSidebar]);

  // Esc leaves zen mode.
  useEffect(() => {
    if (!zenMode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZenMode(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zenMode]);

  // Persist hotkey/editor-setting changes, debounced like workspace state.
  useEffect(() => {
    if (!preferencesLoadedRef.current) return;
    const prefs = { hotkeys: hotkeysToOverrideMap(hotkeyBindings), editorSettings };
    const serialized = JSON.stringify(prefs);
    if (serialized === savedPreferencesRef.current) return;
    if (preferencesSaveTimer.current) clearTimeout(preferencesSaveTimer.current);
    preferencesSaveTimer.current = setTimeout(() => {
      savedPreferencesRef.current = serialized;
      webApi.preferences.update(prefs).catch(() => undefined);
    }, WORKSPACE_SAVE_DEBOUNCE_MS);
  }, [hotkeyBindings, editorSettings]);

  const refreshSyncConnections = useCallback(() => {
    webApi.sync.list(vaultId).then(setSyncConnections).catch(() => undefined);
  }, [vaultId]);

  useEffect(() => {
    refreshSyncConnections();
    // Keep the status-bar sync entry fresh (auto-sync / sync-on-save finish in the background).
    const t = setInterval(refreshSyncConnections, 60_000);
    return () => clearInterval(t);
  }, [refreshSyncConnections]);

  // "Pull on open": once per vault visit, ask the server to queue a sync for
  // connections that opted in (it skips ones that just ran or need attention).
  const pullOnOpenDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (pullOnOpenDoneRef.current === vaultId) return;
    if (!syncConnections.some((c) => c.pullOnOpen)) return;
    pullOnOpenDoneRef.current = vaultId;
    webApi.sync.pullOnOpen(vaultId).then(() => setTimeout(refreshSyncConnections, 5000)).catch(() => undefined);
  }, [vaultId, syncConnections, refreshSyncConnections]);

  const syncSummaryText =
    syncConnections.length === 0
      ? t("web.sync.notConnected")
      : syncConnections.some((c) => c.lastSyncStatus?.status === "conflict")
      ? t("web.sync.conflict")
      : syncConnections.some((c) => c.lastSyncStatus?.status === "error")
      ? t("web.sync.error")
      : syncConnections[0].lastSyncedAt
      ? t("web.sync.at", { time: new Date(syncConnections[0].lastSyncedAt).toLocaleTimeString() })
      : t("web.sync.never");
  const syncTone: "muted" | "warn" | "error" =
    syncConnections.some((c) => c.lastSyncStatus?.status === "error" || c.lastSyncStatus?.status === "conflict")
      ? "error"
      : syncConnections.length === 0
      ? "warn"
      : "muted";

  function openSettings(section: typeof settingsInitialSection = "general") {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }

  function cycleViewMode() {
    if (!activeTabId) return;
    const order: ViewMode[] = ["live", "view", "source"];
    const next = order[(order.indexOf(viewMode) + 1) % order.length];
    handleViewModeChange(next);
  }

  async function handleGitSyncHotkey() {
    if (syncConnections.length === 0) {
      openSettings("sync");
      return;
    }
    await webApi.sync.trigger(vaultId, syncConnections[0].id);
    refreshSyncConnections();
  }

  function executeCommand(action: HotkeyAction) {
    switch (action) {
      case "save":
        forceSaveActiveTab();
        break;
      case "newNote":
        handleQuickNewNote();
        break;
      case "closeTab":
        if (activeTabId) closeTab(activeTabId);
        break;
      case "closeAllTabs":
        handleCloseAllTabs();
        break;
      case "closeOtherTabs":
        if (activeTabId) handleCloseOtherTabs(activeTabId);
        break;
      case "togglePinTab":
        if (activeTabId) handleTogglePin(activeTabId);
        break;
      case "quickOpen":
        setQuickOpenVisible(true);
        break;
      case "commandPalette":
        setCommandPaletteOpen(true);
        break;
      case "findInVault":
        setSearchVisible(true);
        break;
      case "toggleSidebar":
        setSidebarCollapsed((v) => !v);
        break;
      case "toggleViewMode":
        cycleViewMode();
        break;
      case "settings":
        openSettings("general");
        break;
      case "toggleOutline":
        setOutlineVisible((v) => !v);
        break;
      case "toggleTags":
        setTagPaneVisible((v) => !v);
        break;
        break;
      case "toggleBacklinks":
        setBacklinksVisible((v) => !v);
        break;
      case "toggleOutgoingLinks":
        setOutgoingVisible((v) => !v);
        break;
      case "toggleProperties":
        setPropertiesVisible((v) => !v);
        break;
      case "toggleCollab":
        setCollabVisible((v) => !v);
        break;
      case "previewPDF":
        handlePreviewPDF();
        break;
      case "exportPDF":
        handleExportPDF();
        break;
      case "printNote":
        handlePrint();
        break;
      case "pluginManager":
        setPluginManagerOpen(true);
        break;
      case "cssSnippets":
        setShowCSSSnippets(true);
        break;
      case "gitSync":
        handleGitSyncHotkey();
        break;
      case "splitEditor":
        if (activeTabId) handleSplitRight(activeTabId);
        break;
      case "closeSplit":
        handleCloseSplit();
        break;
      case "toggleBold":
        if (editorViewRef.current) wrapSelection(editorViewRef.current, "**", "**");
        break;
      case "toggleItalic":
        if (editorViewRef.current) wrapSelection(editorViewRef.current, "*", "*");
        break;
      case "toggleStrikethrough":
        if (editorViewRef.current) wrapSelection(editorViewRef.current, "~~", "~~");
        break;
      case "toggleCode":
        if (editorViewRef.current) wrapSelection(editorViewRef.current, "`", "`");
        break;
      case "insertLink":
        if (editorViewRef.current) insertLink(editorViewRef.current);
        break;
      case "insertImage":
        if (editorViewRef.current) insertImage(editorViewRef.current);
        break;
      case "insertBlockquote":
        if (editorViewRef.current) insertBlockquote(editorViewRef.current);
        break;
      case "insertCodeBlock":
        if (editorViewRef.current) insertCodeBlock(editorViewRef.current);
        break;
      case "insertTaskList":
        if (editorViewRef.current) insertTaskList(editorViewRef.current);
        break;
      case "insertTable":
        if (editorViewRef.current) insertTable(editorViewRef.current);
        break;
      case "insertHorizontalRule":
        if (editorViewRef.current) insertHorizontalRule(editorViewRef.current);
        break;
      case "toggleBookmark":
        if (activeTabId) handleToggleBookmark(activeTabId);
        break;
      case "openTrash":
        setShowTrash(true);
        break;
      case "syncSettings":
        openSettings("sync");
        break;
      case "importVault":
        setImportMode("current");
        break;
      case "importNewVault":
        setImportMode("new");
        break;
      case "importFromApp":
        setShowAppImport(true);
        break;
      case "newVaultFromGithub":
        setShowNewFromGithub(true);
        break;
      case "randomNote":
        handleRandomNote();
        break;
      case "diagnostics":
        setShowDiagnostics(true);
        break;
      case "devToolsHint":
        // A web page cannot open the browser's DevTools itself.
        setPageNotice(t("web.notice.devTools"));
        break;
      case "reloadApp":
        handleReloadApp();
        break;
      case "zenMode":
        setZenMode((v) => !v);
        break;
      case "focusMode":
        setFocusMode((v) => !v);
        break;
      case "exportVault":
        window.location.href = webApi.vaultTransfer.exportUrl(vaultId);
        break;
      case "themePicker":
        openSettings("appearance");
        break;
    }
  }

  // Global hotkey dispatch — replaces the old Cmd/Ctrl+K-only listener below
  // with a lookup against the full (default-merged-with-user-overrides)
  // binding list, so Shortcuts-tab rebinds actually take effect everywhere,
  // not just in Quick Open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // F1 always opens the palette: Ctrl+Shift+P is taken by the browser on some platforms.
      if (e.key === "F1" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      for (const binding of hotkeyBindings) {
        if (matchesHotkey(e, binding.keys)) {
          e.preventDefault();
          if (binding.action === "commandPalette") {
            setCommandPaletteOpen(true);
          } else {
            executeCommand(binding.action);
          }
          return;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeyBindings, activeTabId, tabs, pinnedTabIds, viewMode, draft, syncConnections]);

  async function handleThemeSelect(themeId: string) {
    setCurrentThemeId(themeId);
    let theme: ThemeDefinition | undefined = BUILT_IN_THEMES.find((t) => t.id === themeId);
    if (!theme) {
      const customs = await loadCustomThemes(vaultId);
      theme = customs.find((t) => t.id === themeId);
    }
    if (theme) applyTheme(theme);

    const v = await webApi.vaults.get(vaultId);
    await webApi.vaults.update(vaultId, { settings: { ...v.settings, themeId } });
  }

  async function handleToggleBookmark(noteId: string) {
    const next = toggleBookmark(bookmarks, noteId);
    setBookmarks(next);
    const v = await webApi.vaults.get(vaultId);
    await webApi.vaults.update(vaultId, { settings: { ...v.settings, bookmarks: next } });
  }

  function handleWikilinkHover(target: string, x: number, y: number) {
    if (wikilinkHoverTimer.current) clearTimeout(wikilinkHoverTimer.current);
    wikilinkHoverTimer.current = setTimeout(() => setWikilinkHover({ target, x, y }), 300);
  }

  function handleWikilinkLeave() {
    if (wikilinkHoverTimer.current) clearTimeout(wikilinkHoverTimer.current);
    setWikilinkHover(null);
  }
  // Another tab or view mode replaces the editor (and the link) without the pointer leaving it.
  useEffect(() => {
    if (wikilinkHoverTimer.current) clearTimeout(wikilinkHoverTimer.current);
    setWikilinkHover(null);
  }, [activeTabId, viewMode]);

  /**
   * Opens the note a clicked `[[link]]` names — by path, else by name — or creates it (folders included) when there
   * is none yet, as the link promises.
   */
  async function openWikilink(raw: string) {
    const parsed = parseLinkTarget(raw);
    const anchor = parsed.heading || parsed.block ? { heading: parsed.heading, block: parsed.block } : undefined;
    // `[[#Heading]]`: a place in the note being viewed.
    if (!parsed.note) {
      if (anchor && activeTabId) {
        pendingJumpRef.current = { noteId: activeTabId, anchor };
        setEditorViewVersion((v) => v + 1);
      }
      return;
    }
    const target = parsed.note;
    // Resolved like the editor's links and embeds (same folder first when names repeat).
    const notes = index?.notes ?? [];
    const path = resolveLinkTarget(target, activeTab?.path ?? "", notes.map((n) => n.path));
    const hit = path ? notes.find((n) => n.path === path) : undefined;
    if (hit) {
      if (anchor) {
        pendingJumpRef.current = { noteId: hit.id, anchor };
        // Already open: nothing else changes, so nudge the jump effect.
        if (hit.id === activeTabId) setEditorViewVersion((v) => v + 1);
      }
      return openNote(hit.id);
    }
    try {
      const created = await vaultAdapter.createNote(`${target.replace(/\.md$/i, "")}.md`);
      refreshIndex();
      await openNote(created.id);
    } catch (err) {
      setPageNotice(isNetworkError(err) ? t("web.offline.needsNetwork") : t("web.notice.newNoteFailed"));
    }
  }

  // `![[…]]` embeds read notes through this page: an open tab's text (unsaved edits included), else the server's.
  // `![[pic.png]]` is matched to an attachment by file name.
  const embedStateRef = useRef({ index, activePath: "", openWikilink });
  embedStateRef.current = { index, activePath: activeTab?.path ?? "", openWikilink };
  // A new index means notes changed (saved, renamed, synced): embeds load again.
  useEffect(() => {
    if (index) bumpEmbedVersion();
  }, [index]);
  useEffect(() => {
    const noteCache = new Map<string, Promise<string>>();
    let images: { at: number; list: Promise<{ name: string; url: string }[]> } | null = null;
    const imageList = () => {
      if (!images || Date.now() - images.at > 10_000) {
        images = {
          at: Date.now(),
          list: webApi.attachments
            .list(vaultId)
            .then(({ attachments }) => attachments.map((a) => ({ name: a.filename, url: webApi.attachments.downloadUrl(vaultId, a.id) })))
            .catch(() => []),
        };
      }
      return images.list;
    };
    setEmbedSource({
      async load(note) {
        const { index: idx, activePath } = embedStateRef.current;
        if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(note)) {
          const file = note.slice(note.lastIndexOf("/") + 1).toLowerCase();
          const hit = (await imageList()).find((a) => a.name.toLowerCase() === file);
          return hit ? { image: hit.url } : null;
        }
        const notes = idx?.notes ?? [];
        const path = resolveLinkTarget(note || activePath, activePath, notes.map((n) => n.path));
        const hit = path ? notes.find((n) => n.path === path) : undefined;
        if (!hit) return null;
        const tab = tabsRef.current.find((t) => t.noteId === hit.id);
        if (tab) return { path: hit.path, content: tab.content };
        // Kept until notes change (the version moves on every index refresh, i.e. after saves), so redrawing a page
        // of embeds does not fetch every note again.
        const key = `${getEmbedVersion()}:${hit.id}`;
        let text = noteCache.get(key);
        if (!text) {
          if (noteCache.size > 200) noteCache.clear();
          text = webApi.notes.get(vaultId, hit.id).then((n) => n.content);
          noteCache.set(key, text);
          text.catch(() => noteCache.delete(key));
        }
        return { path: hit.path, content: await text };
      },
      open: (target) => void embedStateRef.current.openWikilink(target),
    });
    return () => setEmbedSource(null);
  }, [vaultId]);

  function openNoteByPath(path: string) {
    const note = index?.notes.find((n) => n.path === path);
    if (note) openNote(note.id);
  }

  const pdfOptions = () => ({
    columnLayout: editorSettings.pdfColumnLayout,
    chessboardWidthPercent: editorSettings.pdfChessboardWidth,
  });

  // Download a real PDF (rendered by the server); progress and failures are reported in the page notice.
  async function handleExportPDF() {
    if (!activeTab) return;
    setPageNotice(t("web.notice.pdfCreating"));
    try {
      await (await loadPdfExport()).downloadPdf(vaultId, activeTab.noteId, draft, activeTab.name, pdfOptions());
      const done = t("web.notice.pdfDone");
      setPageNotice(done);
      setTimeout(() => setPageNotice((n) => (n === done ? null : n)), 3000);
    } catch (err) {
      const message = isEmailUnverified(err) ? t("web.account.verifyFirst") : (err as { body?: { message?: string } } | null)?.body?.message;
      setPageNotice(message ?? t("web.notice.pdfFailed"));
    }
  }

  // Render the same PDF as "Tải PDF" but show it in a modal first; the user downloads from there.
  async function handlePreviewPDF() {
    if (!activeTab) return;
    setPageNotice(t("web.notice.previewCreating"));
    try {
      setPdfPreview(await (await loadPdfExport()).renderPdf(vaultId, activeTab.noteId, draft, activeTab.name, pdfOptions()));
      setPageNotice(null);
    } catch (err) {
      const message = isEmailUnverified(err) ? t("web.account.verifyFirst") : (err as { body?: { message?: string } } | null)?.body?.message;
      setPageNotice(message ?? t("web.notice.previewFailed"));
    }
  }

  async function handlePrint() {
    if (!activeTab) return;
    await (await loadPdfExport()).exportToPDF(draft, activeTab.name, pdfOptions());
  }

  // Developer > Reload: persist every edited tab first so reloading never drops unsaved text.
  async function handleReloadApp() {
    await Promise.all(tabs.filter((t) => t.content !== t.savedContent).map((t) => persistNote(t.noteId, t.content).catch(() => undefined)));
    window.location.reload();
  }


  function handleRandomNote() {
    const candidates = (index?.notes ?? []).filter((n) => n.id !== activeTabId);
    if (candidates.length === 0) return;
    openNote(candidates[Math.floor(Math.random() * candidates.length)].id);
  }

  // Keep open tabs' name/path in step with renames and moves done in the file tree.
  useEffect(() => {
    if (!index) return;
    const byId = new Map(index.notes.map((n) => [n.id, n]));
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const n = byId.get(t.noteId);
        if (n && (n.path !== t.path || n.name !== t.name)) {
          changed = true;
          return { ...t, path: n.path, name: n.name };
        }
        return t;
      });
      return changed ? next : prev;
    });
  }, [index]);

  async function handleQuickNewNote() {
    try {
      // Picks "Untitled 2.md" etc. when the name is taken; a plain "Untitled.md" used to 409 silently.
      const note = await createUntitledNote(vaultId, null, index?.notes ?? []);
      refreshIndex();
      openNote(note.id);
      setSidebarRenameRequest({ id: note.id, name: note.name.replace(/\.md$/i, ""), nonce: Date.now() });
    } catch {
      setPageNotice(t("web.notice.newNoteFailed"));
    }
  }

  function handleHeadingClick(line: number) {
    const view = editorViewRef.current;
    if (!view) return;
    const lineInfo = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
    view.dispatch({ selection: { anchor: lineInfo.from }, scrollIntoView: true });
    view.focus();
  }

  // Open the note requested via ?note=<id> (a link into a note of this vault)
  // Waits for the saved-tabs restore (workspaceReady) so the note is merged
  // into the restored tab list instead of being overwritten by it.
  useEffect(() => {
    if (!workspaceReady) return;
    const noteId = searchParams.get("note");
    if (noteId && noteId !== activeTabId) {
      openNote(noteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, workspaceReady]);

  function onDraftChange(value: string) {
    if (!activeTabId) return;
    setActiveTabContent(activeTabId, value);
    scheduleSave(activeTabId, value);

    // Don't echo a just-received remote update back into Yjs as if it were a
    // fresh local edit (see lastRemoteContentRef's comment above).
    if (value === lastRemoteContentRef.current) return;

    if (collabSessionRef.current) {
      if (collabPushTimer.current) clearTimeout(collabPushTimer.current);
      collabPushTimer.current = setTimeout(() => {
        collabSessionRef.current?.pushLocalText(value);
      }, 300);
    }
  }

  function onSplitDraftChange(value: string) {
    if (!splitTabId) return;
    setActiveTabContent(splitTabId, value);
    scheduleSave(splitTabId, value);
  }

  const tabBarTabs: TabBarTab[] = tabs.map((t) => ({
    noteId: t.noteId,
    path: t.path,
    name: t.name,
    isDirty: t.content !== t.savedContent,
  }));

  // Sync conflict copies ("<name> (conflict …).md"): compare with the original and resolve from the banner.
  const findNoteByPath = async (path: string) =>
    index?.notes.find((n) => n.path === path) ?? (await vaultAdapter.listNotes()).find((n) => n.path === path) ?? null;
  const loadConflictOriginal = useCallback(
    async (path: string) => {
      const ref = index?.notes.find((n) => n.path === path) ?? (await vaultAdapter.listNotes()).find((n) => n.path === path);
      return ref ? vaultAdapter.readNote(ref.id) : null;
    },
    [index, vaultAdapter]
  );
  async function discardConflictCopy(copyId: string) {
    clearTimeout(saveTimers.current[copyId]);
    delete saveTimers.current[copyId];
    await vaultAdapter.deleteNote(copyId); // to the trash, restorable
    closeTab(copyId);
    refreshIndex();
  }
  async function useConflictCopy(copy: OpenTab, originalPath: string) {
    const original = await findNoteByPath(originalPath);
    if (!original) return;
    await vaultAdapter.writeNote(original.id, copy.content);
    serverBaseRef.current[original.id] = copy.content;
    setTabs((prev) => prev.map((t) => (t.noteId === original.id ? { ...t, content: copy.content, savedContent: copy.content } : t)));
    await discardConflictCopy(copy.noteId);
    openNote(original.id);
  }

  function renderNoteBody(tab: OpenTab, mode: ViewMode, isMain: boolean) {
    const content = tab.content;
    const onChange = isMain ? onDraftChange : onSplitDraftChange;
    const onReady = isMain
      ? (view: EditorView) => {
          editorViewRef.current = view;
          setEditorViewVersion((v) => v + 1);
        }
      : undefined;

    // A core plugin's file view (Board…) replaces the editor, except in source mode where the file stays editable as text.
    const fileView = mode !== "source" ? matchFileView(corePlugins.contributions.fileViews, tab.path, content) : undefined;
    if (fileView) {
      return (
        <div className="flex-1 min-h-0" key={`${fileView.key}:${tab.noteId}`}>
          <CorePluginFileView view={fileView} path={tab.path} content={content} onChange={onChange} />
        </div>
      );
    }

    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ConflictBanner
          path={tab.path}
          content={content}
          loadOriginal={loadConflictOriginal}
          onKeepOriginal={() => discardConflictCopy(tab.noteId)}
          onUseThisVersion={(originalPath) => useConflictCopy(tab, originalPath)}
        />
        {mode !== "source" && (
          <PropertiesEditor
            content={content}
            onChange={onChange}
            types={propertyTypes.types}
            onTypeChange={(key, type) => void propertyTypes.setType(key, type)}
            knownKeys={Object.keys(propertyTypes.types)}
            collapsed={frontmatterCollapsed}
            onToggleCollapse={() => setFrontmatterCollapsed((v) => !v)}
          />
        )}
        {isMain && mode === "live" && (
          <FormattingToolbar key={editorViewVersion} onAction={(action) => runFormattingAction(editorViewRef.current, action)} />
        )}
        <div className="flex-1 min-h-0">
          {mode === "source" ? (
            <SourceEditor
              content={content}
              onChange={onChange}
              adapter={vaultAdapter}
              onViewReady={onReady}
              prefs={{ spellCheck: editorSettings.spellCheck, tabSize: editorSettings.tabSize }}
            />
          ) : mode === "view" ? (
            <ReadOnlyView content={content} onChange={onChange} onWikilinkOpen={openWikilink} />
          ) : (
            <Editor
              content={content}
              onChange={onChange}
              adapter={vaultAdapter}
              aiProvider={aiProvider}
              relayUrl={relayUrl}
              vimMode={editorSettings.vimModeEnabled}
              prefs={{ spellCheck: editorSettings.spellCheck, tabSize: editorSettings.tabSize }}
              focusMode={focusMode}
              onViewReady={onReady}
              onWikilinkHover={isMain ? handleWikilinkHover : undefined}
              onWikilinkLeave={isMain ? handleWikilinkLeave : undefined}
              onWikilinkOpen={openWikilink}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="web-vault h-screen flex flex-col" data-vault-id={vaultId}>
      <TermsGate />
      {!zenMode && (
        <VaultHeader
          vault={vault}
          vaults={allVaults}
          activeNotePath={activeTab?.path ?? null}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          showViewModes={!!activeTab}
          hotkeys={hotkeyBindings}
          platform={platform}
          onMenuAction={executeCommand}
          pluginCommands={corePlugins.contributions.commands}
          onImportNewVault={() => setImportMode("new")}
          onNewFromGithub={() => setShowNewFromGithub(true)}
          onVaultsChanged={() => {
            webApi.vaults.list().then(setAllVaults).catch(() => undefined);
            webApi.vaults.get(vaultId).then(setVault).catch(() => undefined);
          }}
        />
      )}

      {tabs.length > 0 && !zenMode && (
        <TabBar
          tabs={tabBarTabs}
          activeTabId={activeTabId}
          pinnedTabIds={pinnedTabIds}
          onTabSelect={setActiveTabId}
          onTabClose={closeTab}
          onTabReorder={reorderTabs}
          onTogglePin={handleTogglePin}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseTabsToRight={handleCloseTabsToRight}
          onSplitRight={handleSplitRight}
          onNewTab={handleQuickNewNote}
        />
      )}

      <div className="web-vault-body flex flex-1 overflow-hidden">
        {!zenMode && (
          <Ribbon
            onQuickOpen={() => setQuickOpenVisible(true)}
            onNewNote={handleQuickNewNote}
            onCommandPalette={() => setCommandPaletteOpen(true)}
            onSearch={() => setSearchVisible(true)}
            onSettings={() => openSettings("general")}
            onOutline={() => setOutlineVisible((v) => !v)}
            onAiChat={() => setAiChatVisible((v) => !v)}
            aiChatActive={aiChatVisible}
            onTags={() => setTagPaneVisible((v) => !v)}
            onTrash={() => setShowTrash(true)}
            onBookmarks={() => setBookmarksVisible((v) => !v)}
            onAttachments={() => setShowAttachments(true)}
            onSync={() => openSettings("sync")}
            onPlugins={() => setPluginManagerOpen(true)}
            onThemes={() => openSettings("appearance")}
            onSnippets={() => setShowCSSSnippets(true)}
            pluginPanels={pluginHost.panels
              .filter((p) => p.kind === "sidebar")
              .map((p) => ({ key: `${p.pluginDbId}:${p.id}`, title: p.title, icon: p.icon }))}
            coreRibbon={
              <CorePluginRibbonButtons
                icons={corePlugins.contributions.ribbonIcons}
                panels={corePlugins.contributions.sidebarPanels}
                openPanels={corePluginHost.openPanels}
                onTogglePanel={corePluginHost.togglePanel}
              />
            }
            activePluginPanel={activePluginPanel}
            onPluginPanel={(key) => {
              setActivePluginPanel((cur) => (cur === key ? null : key));
              setSidebarCollapsed(false);
            }}
            syncAttention={syncConnections.some((c) => c.lastSyncStatus?.status === "error" || c.lastSyncStatus?.status === "conflict")}
            outlineActive={outlineVisible}
            tagsActive={tagPaneVisible}
            bookmarksActive={bookmarksVisible}
          />
        )}

        {/* On a phone the sidebar is a drawer over the note: tapping beside it closes it. */}
        {isPhone && !sidebarCollapsed && !zenMode && <div className="web-drawer-backdrop" onClick={() => setSidebarCollapsed(true)} />}
        {!sidebarCollapsed && !zenMode &&
          (activePluginPanel && pluginHost.panels.some((p) => `${p.pluginDbId}:${p.id}` === activePluginPanel && p.kind === "sidebar") ? (
            (() => {
              const panel = pluginHost.panels.find((p) => `${p.pluginDbId}:${p.id}` === activePluginPanel && p.kind === "sidebar")!;
              return (
                <div className="sidebar-root flex flex-col" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
                  <div className="sidebar-header">
                    <span className="sidebar-title">{panel.title}</span>
                    <div className="sidebar-actions">
                      <button onClick={() => setActivePluginPanel(null)} className="sidebar-btn" title={t("shell.closePanel")}>
                        <CloseIcon size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 py-2">
                    <PluginMirror
                      html={panel.html}
                      css={panel.css}
                      onEvent={(e) => pluginHost.sendMirrorEvent(panel.pluginDbId, "sidebar", panel.id, e)}
                    />
                  </div>
                </div>
              );
            })()
          ) : (
            <Sidebar
              vaultId={vaultId}
              vaultName={vault?.name ?? ""}
              index={index}
              activeNoteId={activeTabId}
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              onFileSelect={(noteId) => {
                void openNote(noteId);
                if (isPhone) setSidebarCollapsed(true);
              }}
              onRefresh={refreshIndex}
              onNewNote={handleQuickNewNote}
              renameRequest={sidebarRenameRequest}
              onRenameRequestHandled={clearSidebarRenameRequest}
              onMoved={(moves, before) => void handleNotesMoved(moves, before)}
              onImportHere={(folderPath) => {
                setImportFolder(folderPath);
                setImportMode("current");
              }}
            />
          ))}

        <main className="flex-1 min-w-0 flex flex-col relative">
          {activeTab ? (
            <>
              <NoteToolbar
                notePath={activeTab.path}
                backlinksVisible={backlinksVisible}
                collabVisible={collabVisible}
                collabPeerCount={collabPeers.length}
                bookmarked={isBookmarked(bookmarks, activeTab.noteId)}
                onToggleBacklinks={() => setBacklinksVisible((v) => !v)}
                onToggleCollab={() => setCollabVisible((v) => !v)}
                onExportPDF={handleExportPDF}
                onToggleBookmark={() => handleToggleBookmark(activeTab.noteId)}
                onPublish={() => setShowPublishPreview(true)}
                onFileRecovery={() => setShowFileRecovery(true)}
                pluginButtons={<CorePluginNoteToolbarButtons buttons={corePlugins.contributions.noteToolbarButtons} />}
              />
              {pluginHost.commands.length > 0 && (
                <div className="flex gap-2 px-4 py-1.5 border-b border-[var(--border)] text-xs">
                  {pluginHost.commands.map((cmd) => (
                    <button
                      key={`${cmd.pluginDbId}:${cmd.id}`}
                      onClick={() => pluginHost.runCommand(cmd.pluginDbId, cmd.id)}
                      className="px-2 py-1 rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)]"
                    >
                      {cmd.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="web-note-area flex-1 flex min-h-0">
                <div className="flex-1 min-w-0 flex flex-col">
                  <SplitPane
                    direction="horizontal"
                    splitRatio={splitRatio}
                    onSplitRatioChange={setSplitRatio}
                    left={renderNoteBody(activeTab, viewMode, true)}
                    right={
                      splitTab
                        ? (
                          <div className="h-full flex flex-col">
                            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] text-xs text-[var(--text-secondary)]">
                              <span className="truncate">{splitTab.path}</span>
                              <button onClick={handleCloseSplit} className="titlebar-btn" title={t("shell.closeSplit")}>
                                <CloseIcon size={11} />
                              </button>
                            </div>
                            {renderNoteBody(splitTab, (splitTabId && fileViewModes[splitTabId]) || "live", false)}
                          </div>
                        )
                        : null
                    }
                  />
                </div>
                {aiChatVisible && vaultAdapter && (
                  <div className="web-side-panel w-80 border-l border-[var(--border)] overflow-hidden flex flex-col bg-[var(--bg-secondary)]" style={{ zIndex: 10 }}>
                    <ChatLayout
                      adapter={vaultAdapter}
                      vaultName={vault?.name}
                      activeNotePath={activeTab?.path ?? null}
                      activeNoteContent={draft ?? activeTab?.content ?? null}
                      onOpenNote={(targetPath: string) => {
                        const note = index?.notes.find((n) => n.path === targetPath);
                        if (note) openNote(note.id);
                      }}
                      provider={aiProvider}
                      onProviderChange={handleSaveAiProvider}
                      relayUrl={relayUrl}
                      onOpenSettings={() => setShowAiSettings(true)}
                    />
                  </div>
                )}
                {outlineVisible && (
                  <div className="web-side-panel w-64 border-l border-[var(--border)] overflow-y-auto">
                    <OutlinePanel content={draft} onHeadingClick={handleHeadingClick} onClose={() => setOutlineVisible(false)} />
                  </div>
                )}
                {tagPaneVisible && (
                  <div className="web-side-panel w-64 border-l border-[var(--border)] overflow-y-auto">
                    <TagPane adapter={vaultAdapter} onTagClick={() => {}} onNoteSelect={openNote} visible={tagPaneVisible} />
                  </div>
                )}
                {bookmarksVisible && (
                  <div className="web-side-panel w-64 border-l border-[var(--border)] overflow-y-auto">
                    <BookmarksPanel
                      notes={bookmarkedNotes}
                      currentNoteId={activeTabId}
                      onNoteSelect={openNote}
                      onBookmarkRemove={handleToggleBookmark}
                      onClose={() => setBookmarksVisible(false)}
                      labels={{ hint: t("web.bookmarks.hint") }}
                    />
                  </div>
                )}
                {backlinksVisible && (
                  <div className="web-side-panel w-72 border-l border-[var(--border)] overflow-y-auto">
                    <BacklinksPanel
                      adapter={vaultAdapter}
                      noteId={activeTab.noteId}
                      onNoteOpen={openNote}
                      onClose={() => setBacklinksVisible(false)}
                      editNote={editNoteInTabs}
                    />
                  </div>
                )}
                {propertiesVisible && (
                  <div className="web-side-panel w-72 border-l border-[var(--border)] overflow-y-auto">
                    <PropertiesView
                      adapter={vaultAdapter}
                      types={propertyTypes.types}
                      onTypeChange={(key, type) => void propertyTypes.setType(key, type)}
                      onTypeRename={(from, to) => void propertyTypes.renameType(from, to)}
                      onNoteOpen={openNote}
                      onClose={() => setPropertiesVisible(false)}
                      editNote={editNoteInTabs}
                    />
                  </div>
                )}
                {outgoingVisible && (
                  <div className="web-side-panel w-72 border-l border-[var(--border)] overflow-y-auto">
                    <OutgoingLinksPanel
                      adapter={vaultAdapter}
                      noteId={activeTab.noteId}
                      content={activeTab.content}
                      onNoteOpen={openNote}
                      onClose={() => setOutgoingVisible(false)}
                      editNote={editNoteInTabs}
                    />
                  </div>
                )}
                {collabVisible && (
                  <CollabPanel
                    connected={collabConnected}
                    peers={collabPeers}
                    onClose={() => setCollabVisible(false)}
                  />
                )}
                <CorePluginSidePanels
                  panels={corePlugins.contributions.sidebarPanels}
                  open={corePluginHost.openPanels}
                  onClose={corePluginHost.togglePanel}
                />
              </div>
              {!zenMode && (
                <StatusBar
                  viewMode={viewMode}
                  vaultName={vault?.name ?? ""}
                  notePath={activeTab.path}
                  content={draft}
                  dirty={activeTab.content !== activeTab.savedContent}
                  saveFailed={saveFailed && failedSavesRef.current.has(activeTab.noteId)}
                  keptLocally={networkDown}
                  syncSummary={syncSummaryText}
                  syncTone={syncTone}
                  onOpenSync={() => openSettings("sync")}
                  pluginItems={pluginHost.statusItems}
                  onPluginItemClick={pluginHost.clickStatusItem}
                  coreItems={<CorePluginStatusItems items={corePlugins.contributions.statusItems} buttonClassName="hover:text-[var(--text-primary)]" />}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
              <span>{t("web.empty.title")}</span>
              <button onClick={() => setQuickOpenVisible(true)} className="text-sm hover:text-[var(--text-primary)]">
                {t("web.empty.quickOpen")}
              </button>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <button
                  onClick={handleQuickNewNote}
                  style={{ padding: "12px 16px" }}
                  className="rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)] text-left"
                >
                  <div className="font-medium">{t("web.empty.newNote")}</div>
                  <div className="text-xs text-[var(--text-muted)]">{t("web.empty.newNoteHint")}</div>
                </button>
                <button
                  onClick={() => openSettings("sync")}
                  style={{ padding: "12px 16px" }}
                  className="rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)] text-left"
                >
                  <div className="font-medium">{t("web.empty.connect")}</div>
                  <div className="text-xs text-[var(--text-muted)]">{t("web.empty.connectHint")}</div>
                </button>
                <button
                  onClick={() => setImportMode("current")}
                  style={{ padding: "12px 16px" }}
                  className="rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)] text-left"
                >
                  <div className="font-medium">{t("web.empty.import")}</div>
                  <div className="text-xs text-[var(--text-muted)]">{t("web.empty.importHint")}</div>
                </button>
                <button
                  onClick={() => setPluginManagerOpen(true)}
                  style={{ padding: "12px 16px" }}
                  className="rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm text-[var(--text-primary)] text-left"
                >
                  <div className="font-medium">{t("web.empty.plugins")}</div>
                  <div className="text-xs text-[var(--text-muted)]">{t("web.empty.pluginsHint")}</div>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {searchVisible && (
        <VaultSearch
          adapter={vaultAdapter}
          onOpen={(ref, line) => {
            if (line !== undefined) pendingJumpRef.current = { noteId: ref.id, line };
            openNote(ref.id);
          }}
          onClose={() => setSearchVisible(false)}
          editNote={editNoteInTabs}
        />
      )}

      {quickOpenVisible && (
        <QuickOpen
          load={listNotes}
          onSelect={(noteId) => openNote(noteId)}
          onClose={() => setQuickOpenVisible(false)}
        />
      )}


      <CorePluginViewOverlay host={corePluginHost.host} view={corePluginHost.activeView} onClose={corePluginHost.closeView} />

      {settingsOpen && (
        <SettingsModal
          vaultId={vaultId}
          vaultName={vault?.name}
          pluginTabs={pluginHost.panels.filter((p) => p.kind === "settings")}
          corePlugins={corePlugins.plugins}
          onToggleCorePlugin={(id, enabled) => void toggleCorePlugin(id, enabled)}
          corePluginSettingsTabs={corePlugins.contributions.settingsTabs}
          onPluginEvent={(tab, e) => pluginHost.sendMirrorEvent(tab.pluginDbId, "settings", tab.id, e)}
          currentThemeId={currentThemeId}
          onThemeSelect={handleThemeSelect}
          hotkeys={hotkeyBindings}
          onHotkeysChange={setHotkeyBindings}
          editorSettings={editorSettings}
          onEditorSettingsChange={(patch) => setEditorSettingsState((prev) => ({ ...prev, ...patch }))}
          platform={platform}
          onOpenPlugins={() => setPluginManagerOpen(true)}
          onOpenSnippets={() => setShowCSSSnippets(true)}
          initialSection={settingsInitialSection}
          onClose={() => {
            setSettingsOpen(false);
            refreshSyncConnections();
          }}
        />
      )}

      {commandPaletteOpen && (
        <CommandPalette<string>
          hotkeys={hotkeyBindings}
          extraItems={[
            ...corePlugins.contributions.commands.map((c) => ({
              action: `core:${c.key}`,
              label: c.name,
              // Palette shortcut text uses Ctrl; formatHotkey shows it as ⌘ on macOS.
              keys: c.hotkey?.replace(/\bMod\b/, "Ctrl") ?? "",
              category: t("shell.commands.corePlugin"),
            })),
            ...pluginHost.commands.map((c) => ({
              action: `plugin:${c.pluginDbId}:${c.id}`,
              label: c.name,
              keys: "",
              category: t("shell.commands.plugin", { id: c.pluginId }),
            })),
          ]}
          platform={platform}
          recentActions={recentCommands}
          onExecute={(action) => {
            if (action.startsWith("core:")) {
              corePlugins.contributions.commands.find((c) => `core:${c.key}` === action)?.run();
            } else if (action.startsWith("plugin:")) {
              const [, dbId, ...rest] = action.split(":");
              pluginHost.runCommand(dbId, rest.join(":"));
            } else {
              executeCommand(action as HotkeyAction);
            }
          }}
          onRecent={(action) => {
            saveRecentCommand(action);
            setRecentCommands(loadRecentCommands());
          }}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {showCSSSnippets && (
        <CSSSnippets
          vaultId={vaultId}
          snippets={cssSnippets}
          onSnippetsChange={(snips) => { setCSSSnippets(snips); refreshSnippets(snips); }}
          onClose={() => setShowCSSSnippets(false)}
        />
      )}

      {pluginManagerOpen && (
        <PluginManager
          denied={pluginHost.deniedPermissions}
          vaultId={vaultId}
          installed={pluginHost.installed}
          onChanged={pluginHost.refreshInstalled}
          onClose={() => setPluginManagerOpen(false)}
        />
      )}

      {showTrash && (
        <TrashPanel vaultId={vaultId} onClose={() => setShowTrash(false)} onRestored={refreshIndex} />
      )}

      {showAttachments && (
        <AttachmentManager
          vaultId={vaultId}
          onInsert={(markdownLink) => {
            if (editorViewRef.current) insertAtCursor(editorViewRef.current, markdownLink);
          }}
          onClose={() => setShowAttachments(false)}
          viewerOpen={attachmentView !== null}
          onView={(a) => {
            const file = { target: webApi.attachments.downloadUrl(vaultId, a.id), name: a.filename };
            if (!matchAttachmentViewer(corePlugins.contributions.attachmentViewers, file)) return false;
            setAttachmentView(file);
            return true;
          }}
        />
      )}

      {attachmentView &&
        (() => {
          const viewer = matchAttachmentViewer(corePlugins.contributions.attachmentViewers, attachmentView);
          // Above the Attachments dialog (.am-overlay is 8500).
          return viewer ? (
            <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "var(--bg-primary)" }}>
              <CorePluginAttachmentViewer viewer={viewer} target={attachmentView.target} name={attachmentView.name} onClose={() => setAttachmentView(null)} />
            </div>
          ) : null;
        })()}


      {showPublishPreview && activeTab && (
        <PublishPreview
          vaultId={vaultId}
          index={index}
          content={draft}
          title={activeTab.name.replace(/\.(md|markdown)$/i, "")}
          currentNoteId={activeTabId}
          onClose={() => setShowPublishPreview(false)}
        />
      )}

      {showFileRecovery && activeTab && activeTabId && (
        <FileRecovery
          vaultId={vaultId}
          noteId={activeTabId}
          notePath={activeTab.path}
          onRestore={onDraftChange}
          onClose={() => setShowFileRecovery(false)}
          onOpenScrubber={
            scrubberCommand
              ? () => {
                  setShowFileRecovery(false);
                  scrubberCommand.run();
                }
              : undefined
          }
        />
      )}

      {lightboxSrc && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
          onClick={() => setLightboxSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary runtime src (vault image / attachment URL), not a static asset */}
          <img
            src={lightboxSrc}
            alt=""
            style={{ maxWidth: "92vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 6 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {wikilinkHover && (
        <NoteHoverPreview target={wikilinkHover.target} position={{ x: wikilinkHover.x, y: wikilinkHover.y }} onDismiss={handleWikilinkLeave} />
      )}

      {/* Hidden sandboxed <iframe> per enabled plugin — see usePluginHost.ts */}
      <div ref={pluginHost.containerRef} style={{ display: "none" }} />

      {showAiSettings && (
        <AiSettingsModal
          currentConfig={aiProvider}
          relayUrl={relayUrl}
          onSave={handleSaveAiProvider}
          onSaveRelayUrl={handleSaveRelayUrl}
          onClose={() => setShowAiSettings(false)}
        />
      )}

      {pdfPreview && (
        <PdfPreviewModal
          blob={pdfPreview.blob}
          filename={pdfPreview.filename}
          onDownload={() => void loadPdfExport().then((m) => m.saveBlob(pdfPreview.blob, pdfPreview.filename))}
          onClose={() => setPdfPreview(null)}
        />
      )}

      {showDiagnostics && (
        <DiagnosticsModal
          vaultId={vaultId}
          plugins={pluginHost.installed}
          denied={pluginHost.deniedPermissions}
          syncConnections={syncConnections}
          onClose={() => setShowDiagnostics(false)}
        />
      )}

      {showNewFromGithub && (
        <CreateVaultFromGithub
          onClose={() => setShowNewFromGithub(false)}
          onCreated={(id) => {
            setShowNewFromGithub(false);
            router.push(`/vaults/${id}`);
          }}
        />
      )}

      {importMode && (
        <ImportVault
          vaultId={importMode === "current" ? vaultId : null}
          vaultName={vault?.name}
          folders={index?.folders.map((f) => f.path) ?? []}
          initialFolder={importMode === "current" ? importFolder : ""}
          onClose={() => {
            setImportMode(null);
            setImportFolder("");
          }}
          onFinished={(id) => {
            setImportMode(null);
            setImportFolder("");
            if (id !== vaultId) router.push(`/vaults/${id}`);
            else refreshIndex();
          }}
        />
      )}

      {showAppImport && (
        <AppImport
          write={async (result, onProgress, signal) => {
            const { importConverted } = await import("@/lib/vault-import");
            const report = await importConverted(vaultId, result, onProgress, signal);
            refreshIndex();
            return report;
          }}
          existingPaths={async () => (await webApi.vaults.index(vaultId)).notes.map((n) => n.path)}
          onClose={() => setShowAppImport(false)}
          onOpen={(path) => {
            // The index in this render predates the import: the note is looked up in a fresh one.
            void webApi.vaults
              .index(vaultId)
              .then((idx) => {
                setIndex(idx);
                const note = idx.notes.find((n) => n.path === path);
                if (note) openNote(note.id);
              })
              .catch(() => undefined);
          }}
        />
      )}

      {zenMode && (
        <button
          onClick={() => setZenMode(false)}
          className="fixed top-2 right-3 z-40 text-xs rounded-md bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          style={{ padding: "4px 10px", opacity: 0.7 }}
        >
          {t("web.zenExit")}
        </button>
      )}

      {networkDown && (
        <div role="status" className="fixed top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--yellow)] text-xs text-[var(--text-secondary)] shadow-lg max-w-[90vw] text-center">
          {t("web.offline.banner")}
        </div>
      )}

      {pageNotice && (
        <div
          onClick={() => setPageNotice(null)}
          className="fixed bottom-4 left-4 z-50 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm cursor-pointer shadow-lg"
        >
          {pageNotice}
        </div>
      )}

      {pluginHost.notices.length + corePluginHost.notices.length > 0 && (
        <div className="fixed right-4 z-50 flex flex-col gap-2" style={{ bottom: 36 }}>
          {[...pluginHost.notices, ...corePluginHost.notices].map((n) => (
            <div
              key={n.key}
              onClick={() => (n.key.startsWith("core:") ? corePluginHost.dismissNotice(n.key) : pluginHost.dismissNotice(n.key))}
              className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm cursor-pointer shadow-lg"
            >
              {n.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
