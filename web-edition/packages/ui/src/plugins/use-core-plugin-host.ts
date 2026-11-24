"use client";

import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { EditorApi, PluginApi, PluginPlatform, ViewState } from "@noteriv/plugin-api";
import type { CorePluginDef, PluginStateStore } from "@noteriv/core/plugin-registry";
import type { VaultAdapter } from "@noteriv/core/vault-adapter";
import { createCorePluginHost, type CorePluginHost } from "./core-plugin-host";
import { adapterNoteEditor, type NoteEditor } from "../panels/note-edit";

/** Where a vault keeps core-plugin state. Built by the app per vault (web: vault settings in the DB; desktop: a file). */
export interface CorePluginStorage {
  stateStore: PluginStateStore;
  loadPluginSettings(pluginId: string): Promise<Record<string, unknown>>;
  savePluginSettings(pluginId: string, data: Record<string, unknown>): Promise<void>;
}

/** Everything that identifies one host. Memoise it per vault: a new object restarts every plugin. */
export interface CorePluginHostConfig {
  adapter: VaultAdapter;
  platform: PluginPlatform;
  vaultPath: string | null;
  plugins: CorePluginDef<PluginApi>[];
  storage: CorePluginStorage;
}

/** Called on every use; may change each render, the host always calls the latest. */
export interface CorePluginPorts {
  editor: EditorApi;
  getCurrentFile: () => string | null;
  openFile: (path: string) => boolean | Promise<boolean>;
  /** A plugin created, changed or deleted notes: refresh the file tree / index. */
  onVaultChanged?: () => void;
  /** How `vault.edit` changes a note: through its open tab when it has one (the app's editNoteInTabs). */
  editNote?: NoteEditor;
}

export interface CorePluginNotice {
  key: string;
  message: string;
}

/** The plugin view on screen (one at a time), shown by `CorePluginViewOverlay`. */
export interface ActiveCorePluginView {
  type: string;
  state: ViewState;
}

/**
 * `markdown.renderReadOnly`: the editor's read-only live preview, in a React root of its own. CodeMirror is already
 * part of the page; the component itself is loaded on first use.
 */
function renderReadOnly(source: string, el: HTMLElement): () => void {
  let disposed = false;
  let unmount: (() => void) | null = null;
  void Promise.all([import("react-dom/client"), import("../editor/ReadOnlyView")]).then(([{ createRoot }, mod]) => {
    if (disposed) return;
    const root = createRoot(el);
    root.render(createElement(mod.default, { content: source }));
    unmount = () => root.unmount();
  });
  return () => {
    disposed = true;
    // Same reason as the plugin views: cleanup may run while React is dispatching an event of the plugin's.
    const u = unmount;
    if (u) setTimeout(u, 0);
  };
}

/**
 * One core-plugin host for the open vault (null while no vault is open). Starts enabled plugins on mount and stops
 * them all when the vault changes or the page unmounts. Notices from `ui.showNotice` are collected for the app to show,
 * and the view a plugin opened with `workspace.openView` is returned as `activeView`.
 */
export function useCorePluginHost(config: CorePluginHostConfig | null, ports: CorePluginPorts) {
  const portsRef = useRef(ports);
  portsRef.current = ports;
  const [host, setHost] = useState<CorePluginHost | null>(null);
  const [notices, setNotices] = useState<CorePluginNotice[]>([]);
  const [activeView, setActiveView] = useState<ActiveCorePluginView | null>(null);

  /** Keys (`<pluginId>:<panelId>`) of the core plugin sidebar panels shown in the right column. */
  const [openPanels, setOpenPanels] = useState<string[]>([]);

  const dismissNotice = useCallback((key: string) => setNotices((prev) => prev.filter((n) => n.key !== key)), []);
  const closeView = useCallback(() => setActiveView(null), []);
  const togglePanel = useCallback(
    (key: string) => setOpenPanels((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])),
    []
  );

  useEffect(() => {
    if (!config) return;
    const editor: EditorApi = {
      getContent: () => portsRef.current.editor.getContent(),
      setContent: (c) => portsRef.current.editor.setContent(c),
      insertAtCursor: (t) => portsRef.current.editor.insertAtCursor(t),
      getSelection: () => portsRef.current.editor.getSelection(),
      replaceSelection: (t) => portsRef.current.editor.replaceSelection(t),
      getCursorPosition: () => portsRef.current.editor.getCursorPosition(),
      setCursor: (pos) => portsRef.current.editor.setCursor(pos),
    };
    const h = createCorePluginHost({
      adapter: config.adapter,
      platform: config.platform,
      vaultPath: config.vaultPath,
      editor,
      getCurrentFile: () => portsRef.current.getCurrentFile(),
      openFile: async (path) => portsRef.current.openFile(path),
      openView: async (type, state) => {
        setActiveView({ type, state });
        return true;
      },
      closeView: (types) => setActiveView((v) => (v && types.includes(v.type) ? null : v)),
      onVaultChanged: () => portsRef.current.onVaultChanged?.(),
      editNote: (id, transform) =>
        portsRef.current.editNote ? portsRef.current.editNote(id, transform) : adapterNoteEditor(config.adapter)(id, transform),
      toggleSidebarPanel: togglePanel,
      renderReadOnly,
      notify: (message, durationMs = 4000) => {
        const key = `core:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        setNotices((prev) => [...prev, { key, message }]);
        setTimeout(() => setNotices((prev) => prev.filter((n) => n.key !== key)), durationMs);
      },
      loadPluginSettings: (id) => config.storage.loadPluginSettings(id),
      savePluginSettings: (id, data) => config.storage.savePluginSettings(id, data),
      stateStore: config.storage.stateStore,
      plugins: config.plugins,
    });
    setHost(h);
    void h.init();
    return () => {
      setHost(null);
      setActiveView(null);
      setOpenPanels([]);
      void h.dispose();
    };
  }, [config, togglePanel]);

  return { host, notices, dismissNotice, activeView, closeView, openPanels, togglePanel };
}
