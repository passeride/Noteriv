"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginPlatform } from "@noteriv/plugin-api";
import type { NoteRef, VaultAdapter } from "@noteriv/core/vault-adapter";
import {
  registerCodeBlockProcessor,
  unregisterAllCodeBlockProcessorsForPlugin,
  unregisterCodeBlockProcessor,
} from "@noteriv/core/markdown-code-block-registry";
import { listVaultEntries } from "../core-plugin-host";
import { t } from "../../i18n";
import { mountMirror, type MirrorEvent } from "./mirror";
import type {
  EditorBridge,
  EditorSnapshot,
  PluginCommandRef,
  PluginEventName,
  PluginNotice,
  PluginPanelRef,
  PluginPermission,
  PluginStatusItem,
  SandboxPluginRecord,
} from "./types";

/** RPC method -> permission it needs (null: always allowed). Anything not listed is refused. */
const METHOD_PERMISSIONS: Record<string, PluginPermission | null> = {
  "vault.read": "vault:read",
  "vault.list": "vault:read",
  "vault.exists": "vault:read",
  "vault.write": "vault:write",
  "vault.delete": "vault:write",
  "workspace.openFile": "vault:read",
  "editor.getContent": "editor:read",
  "editor.getSelection": "editor:read",
  "editor.setContent": "editor:write",
  "editor.insertAtCursor": "editor:write",
  "editor.replaceSelection": "editor:write",
  "ui.addCommand": "ui:commands",
  "ui.removeCommand": "ui:commands",
  "ui.addStatusBarItem": "ui:statusbar",
  "ui.removeStatusBarItem": "ui:statusbar",
  "ui.addSidebarPanel": "ui:panel",
  "ui.removeSidebarPanel": "ui:panel",
  "ui.addSettingsTab": "ui:panel",
  "ui.removeSettingsTab": "ui:panel",
  "markdown.registerCodeBlockProcessor": "markdown:render",
  "markdown.unregisterCodeBlockProcessor": "markdown:render",
  "ui.showNotice": null, // always allowed, informational only
  "app.loadSettings": null,
  "app.saveSettings": null,
};

export interface SandboxHostLabels {
  renderFailed: string;
  pluginError: (pluginId: string, error: string) => string;
}

/** Defaults from the i18n catalog, read when a message is shown so a language change applies to the next one. */
function labelsOf(labels: Partial<SandboxHostLabels> | undefined): SandboxHostLabels {
  return {
    renderFailed: labels?.renderFailed ?? t("plugins.sandbox.renderFailed"),
    pluginError: labels?.pluginError ?? ((pluginId, error) => t("plugins.sandbox.pluginError", { id: pluginId, error })),
  };
}

export interface SandboxPluginHostOptions {
  /** URL of plugin-sandbox.html as the app serves it (both apps: `/plugin-sandbox.html`). */
  sandboxUrl: string;
  platform: PluginPlatform;
  /** Shown to plugins as `api.app.version`. */
  appVersion: string;
  /** Installed community plugins; the host mounts one iframe per enabled entry. */
  installed: SandboxPluginRecord[];
  adapter: VaultAdapter | null;
  editor: EditorBridge;
  /** After a plugin wrote or deleted a note. */
  onVaultMutated: () => void;
  /** Persist `api.app.saveSettings`; the app then hands in an updated `installed`. */
  saveSettings: (pluginDbId: string, settings: Record<string, unknown>) => Promise<void>;
  openFile?: (path: string) => boolean | Promise<boolean>;
  labels?: Partial<SandboxHostLabels>;
}

interface LoadedPlugin {
  dbId: string;
  pluginId: string;
  permissions: PluginPermission[];
  iframe: HTMLIFrameElement;
  /** Permissions the plugin booted with; a different grant means it must be remounted. */
  permsKey: string;
}

const permsKeyOf = (p: SandboxPluginRecord) => JSON.stringify(p.permissions.slice().sort());

/**
 * Community-plugin host shared by web and desktop. Mounts one sandboxed <iframe> per enabled plugin (see
 * public/plugin-sandbox.html for why the sandbox boundary, not the serving origin, provides isolation) and bridges
 * its postMessage RPC calls to the vault (through the VaultAdapter) and the editor, but only for methods covered by
 * permissions the user granted.
 */
export function useSandboxPluginHost(options: SandboxPluginHostOptions) {
  const optsRef = useRef(options);
  optsRef.current = options;
  const { installed } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pluginsRef = useRef<Map<Window, LoadedPlugin>>(new Map());
  // Iframes created but not ready yet (pluginDbId -> frame + its ready listener + the grant it will boot with).
  const bootingRef = useRef<Map<string, { iframe: HTMLIFrameElement; listener: (e: MessageEvent) => void; permsKey: string }>>(new Map());

  const [commands, setCommands] = useState<PluginCommandRef[]>([]);
  const [statusItems, setStatusItems] = useState<PluginStatusItem[]>([]);
  const [panels, setPanels] = useState<PluginPanelRef[]>([]);
  // Permissions each plugin tried to use without holding them (pluginDbId -> permissions). Lets the plugin manager
  // explain a plugin that silently does nothing and offer a one-click grant.
  const [denied, setDenied] = useState<Record<string, string[]>>({});
  // Code-block renders in flight (callId -> resolver) and a small result cache so widgets that CodeMirror re-creates
  // don't flash while the sandbox re-renders.
  const pendingBlocksRef = useRef<Map<string, (r: { html: string; css: string } | null) => void>>(new Map());
  const blockCacheRef = useRef<Map<string, { html: string; css: string }>>(new Map());
  const blockLangsRef = useRef<Map<string, Set<string>>>(new Map()); // pluginDbId -> languages
  const latestSnapshotRef = useRef<EditorSnapshot | null>(null);
  const [notices, setNotices] = useState<PluginNotice[]>([]);

  const dismissNotice = useCallback((key: string) => {
    setNotices((prev) => prev.filter((n) => n.key !== key));
  }, []);

  async function findNote(path: string): Promise<NoteRef | undefined> {
    const adapter = optsRef.current.adapter;
    if (!adapter) return undefined;
    return (await adapter.listNotes()).find((n) => n.path === path);
  }

  function requireAdapter(): VaultAdapter {
    const adapter = optsRef.current.adapter;
    if (!adapter) throw new Error("no vault is open");
    return adapter;
  }

  /** Asks the plugin's sandbox to render one fenced block; resolves null on failure/timeout. */
  function renderCodeBlock(pluginDbId: string, language: string, source: string): Promise<{ html: string; css: string } | null> {
    const key = `${pluginDbId}|${language}|${source}`;
    const cached = blockCacheRef.current.get(key);
    if (cached) return Promise.resolve(cached);
    let target: LoadedPlugin | null = null;
    for (const l of pluginsRef.current.values()) if (l.dbId === pluginDbId) target = l;
    if (!target) return Promise.resolve(null);
    const callId = `cb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingBlocksRef.current.delete(callId);
        resolve(null);
      }, 8000);
      pendingBlocksRef.current.set(callId, (r) => {
        clearTimeout(timer);
        if (r) {
          if (blockCacheRef.current.size > 150) blockCacheRef.current.clear();
          blockCacheRef.current.set(key, r);
        }
        resolve(r);
      });
      target!.iframe.contentWindow?.postMessage(
        { type: "noteriv:render-codeblock", callId, language, source, sourcePath: null },
        "*"
      );
    });
  }

  /** The processor handed to the markdown renderer: shows the sandbox's render inside a shadow root. */
  function makeBlockProcessor(pluginDbId: string, language: string) {
    return (source: string, el: HTMLElement) => {
      const mirror = mountMirror(el);
      let disposed = false;
      const cached = blockCacheRef.current.get(`${pluginDbId}|${language}|${source}`);
      if (cached) {
        mirror.update(cached);
      } else {
        mirror.update({ html: '<div data-nrv-pending="1" style="opacity:.6;font-size:12px">…</div>', css: "" });
        renderCodeBlock(pluginDbId, language, source).then((r) => {
          if (disposed) return;
          const fail = `<div style="color:#f38ba8;font-size:12px">${labelsOf(optsRef.current.labels).renderFailed}</div>`;
          mirror.update(r ?? { html: fail, css: "" });
        });
      }
      return () => {
        disposed = true;
        mirror.dispose();
      };
    };
  }

  async function dispatchCall(plugin: LoadedPlugin, method: string, args: unknown[]): Promise<unknown> {
    const required = METHOD_PERMISSIONS[method];
    if (required === undefined) throw new Error(`unknown method "${method}"`);
    if (required && !plugin.permissions.includes(required)) {
      setDenied((prev) => (prev[plugin.dbId]?.includes(required) ? prev : { ...prev, [plugin.dbId]: [...(prev[plugin.dbId] ?? []), required] }));
      throw new Error(`plugin "${plugin.pluginId}" lacks permission "${required}" for ${method}`);
    }
    const opts = optsRef.current;

    switch (method) {
      case "vault.read": {
        const ref = await findNote(String(args[0]));
        return ref ? requireAdapter().readNote(ref.id) : null;
      }
      case "vault.write": {
        const path = String(args[0]);
        const content = String(args[1] ?? "");
        const ref = await findNote(path);
        // Writes into a folder that does not exist fail (web adapter) rather than creating a folder chain.
        if (ref) await requireAdapter().writeNote(ref.id, content);
        else await requireAdapter().createNote(path, content);
        opts.onVaultMutated();
        return true;
      }
      case "vault.exists":
        return (await findNote(String(args[0]))) !== undefined;
      case "vault.list":
        return listVaultEntries(opts.adapter ? await opts.adapter.listNotes() : [], typeof args[0] === "string" ? args[0] : undefined);
      case "vault.delete": {
        const ref = await findNote(String(args[0]));
        if (!ref) return false;
        await requireAdapter().deleteNote(ref.id);
        opts.onVaultMutated();
        return true;
      }
      case "workspace.openFile":
        return opts.openFile ? Boolean(await opts.openFile(String(args[0]))) : false;
      case "editor.getContent":
        return opts.editor.getContent();
      case "editor.setContent":
        opts.editor.setContent(String(args[0] ?? ""));
        return undefined;
      case "editor.insertAtCursor":
        opts.editor.insertAtCursor(String(args[0] ?? ""));
        return undefined;
      case "editor.getSelection":
        return opts.editor.getSelection();
      case "editor.replaceSelection":
        opts.editor.replaceSelection(String(args[0] ?? ""));
        return undefined;
      case "ui.addCommand": {
        const cmd = args[0] as { id?: unknown; name?: unknown; icon?: unknown } | undefined;
        if (!cmd || typeof cmd.id !== "string" || !cmd.id || cmd.id.length > 100) throw new Error("ui.addCommand: invalid id");
        const ref: PluginCommandRef = {
          pluginDbId: plugin.dbId,
          pluginId: plugin.pluginId,
          id: cmd.id,
          name: String(cmd.name ?? cmd.id).slice(0, 120),
          icon: typeof cmd.icon === "string" ? cmd.icon.slice(0, 40) : undefined,
        };
        setCommands((prev) => [...prev.filter((c) => !(c.pluginDbId === plugin.dbId && c.id === ref.id)), ref]);
        return undefined;
      }
      case "ui.removeCommand": {
        const id = args[0] as string;
        setCommands((prev) => prev.filter((c) => !(c.pluginDbId === plugin.dbId && c.id === id)));
        return undefined;
      }
      case "ui.addStatusBarItem": {
        const item = args[0] as { id?: unknown; text?: unknown; title?: unknown; clickable?: unknown } | undefined;
        if (!item || typeof item.id !== "string" || !item.id || item.id.length > 100) {
          throw new Error("ui.addStatusBarItem: invalid item id");
        }
        const next: PluginStatusItem = {
          pluginDbId: plugin.dbId,
          pluginId: plugin.pluginId,
          id: item.id,
          text: String(item.text ?? "").slice(0, 200),
          title: typeof item.title === "string" ? item.title.slice(0, 500) : undefined,
          clickable: item.clickable === true,
        };
        setStatusItems((prev) => {
          const others = prev.filter((i) => !(i.pluginDbId === plugin.dbId && i.id === next.id));
          // Cap per plugin so a runaway plugin can't flood the bar.
          if (others.filter((i) => i.pluginDbId === plugin.dbId).length >= 10) return prev;
          return [...others, next];
        });
        return undefined;
      }
      case "ui.removeStatusBarItem": {
        const id = args[0] as string;
        setStatusItems((prev) => prev.filter((i) => !(i.pluginDbId === plugin.dbId && i.id === id)));
        return undefined;
      }
      case "ui.addSidebarPanel":
      case "ui.addSettingsTab": {
        const def = args[0] as { id?: unknown; title?: unknown; icon?: unknown } | undefined;
        if (!def || typeof def.id !== "string" || !def.id || def.id.length > 100) throw new Error(`${method}: invalid id`);
        const kind = method === "ui.addSidebarPanel" ? "sidebar" : "settings";
        const ref: PluginPanelRef = {
          pluginDbId: plugin.dbId,
          pluginId: plugin.pluginId,
          kind,
          id: def.id,
          title: String(def.title ?? def.id).slice(0, 80),
          icon: typeof def.icon === "string" ? def.icon.slice(0, 40) : undefined,
          html: "",
          css: "",
        };
        setPanels((prev) => {
          const others = prev.filter((p) => !(p.pluginDbId === plugin.dbId && p.kind === kind && p.id === ref.id));
          if (others.filter((p) => p.pluginDbId === plugin.dbId).length >= 10) return prev;
          return [...others, ref];
        });
        return undefined;
      }
      case "ui.removeSidebarPanel":
      case "ui.removeSettingsTab": {
        const kind = method === "ui.removeSidebarPanel" ? "sidebar" : "settings";
        const id = args[0] as string;
        setPanels((prev) => prev.filter((p) => !(p.pluginDbId === plugin.dbId && p.kind === kind && p.id === id)));
        return undefined;
      }
      case "markdown.registerCodeBlockProcessor": {
        const lang = String(args[0] ?? "").trim().toLowerCase();
        if (!lang || lang.length > 40) throw new Error("markdown.registerCodeBlockProcessor: invalid language");
        const langs = blockLangsRef.current.get(plugin.dbId) ?? new Set<string>();
        langs.add(lang);
        blockLangsRef.current.set(plugin.dbId, langs);
        registerCodeBlockProcessor(plugin.pluginId, lang, makeBlockProcessor(plugin.dbId, lang));
        return undefined;
      }
      case "markdown.unregisterCodeBlockProcessor": {
        const lang = String(args[0] ?? "").trim().toLowerCase();
        blockLangsRef.current.get(plugin.dbId)?.delete(lang);
        unregisterCodeBlockProcessor(plugin.pluginId, lang);
        return undefined;
      }
      case "ui.showNotice": {
        const message = String(args[0] ?? "").slice(0, 500);
        const key = `${plugin.dbId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        setNotices((prev) => [...prev, { key, message }]);
        const duration = typeof args[1] === "number" ? Math.min(Math.max(args[1], 500), 30000) : 4000;
        setTimeout(() => dismissNotice(key), duration);
        return undefined;
      }
      case "app.loadSettings":
        return opts.installed.find((p) => p.id === plugin.dbId)?.settings ?? {};
      case "app.saveSettings": {
        const data = args[0];
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("app.saveSettings: expected an object");
        await opts.saveSettings(plugin.dbId, data as Record<string, unknown>);
        // Saved settings (e.g. a board theme) usually change how the plugin's blocks look: drop cached renders and
        // re-register so open editors redraw them.
        for (const k of Array.from(blockCacheRef.current.keys())) if (k.startsWith(`${plugin.dbId}|`)) blockCacheRef.current.delete(k);
        for (const lang of blockLangsRef.current.get(plugin.dbId) ?? []) {
          registerCodeBlockProcessor(plugin.pluginId, lang, makeBlockProcessor(plugin.dbId, lang));
        }
        return undefined;
      }
      default:
        throw new Error(`unknown method "${method}"`);
    }
  }

  function teardown(win: Window, loaded: LoadedPlugin) {
    loaded.iframe.remove();
    pluginsRef.current.delete(win);
    setCommands((prev) => prev.filter((c) => c.pluginDbId !== loaded.dbId));
    setStatusItems((prev) => prev.filter((i) => i.pluginDbId !== loaded.dbId));
    setPanels((prev) => prev.filter((p) => p.pluginDbId !== loaded.dbId));
    unregisterAllCodeBlockProcessorsForPlugin(loaded.pluginId);
    blockLangsRef.current.delete(loaded.dbId);
    for (const k of Array.from(blockCacheRef.current.keys())) if (k.startsWith(`${loaded.dbId}|`)) blockCacheRef.current.delete(k);
  }

  // Mount/unmount iframes as the enabled-plugin set (or a plugin's grant) changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const enabled = installed.filter((p) => p.enabled);
    const byId = new Map(enabled.map((p) => [p.id, p]));

    for (const [win, loaded] of Array.from(pluginsRef.current)) {
      const want = byId.get(loaded.dbId);
      // Remount when the user changed this plugin's permissions so it boots with the new grant.
      if (!want || loaded.permsKey !== permsKeyOf(want)) teardown(win, loaded);
    }

    for (const [dbId, b] of Array.from(bootingRef.current)) {
      const want = byId.get(dbId);
      if (!want || b.permsKey !== permsKeyOf(want)) {
        window.removeEventListener("message", b.listener);
        b.iframe.remove();
        bootingRef.current.delete(dbId);
      }
    }

    const alreadyMounted = new Set([...Array.from(pluginsRef.current.values()).map((p) => p.dbId), ...bootingRef.current.keys()]);

    for (const plugin of enabled) {
      if (alreadyMounted.has(plugin.id)) continue;

      const iframe = document.createElement("iframe");
      // Opaque origin: scripts only, never allow-same-origin.
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.src = optsRef.current.sandboxUrl;
      iframe.style.display = "none";
      iframe.setAttribute("title", `plugin:${plugin.pluginId}`);
      container.appendChild(iframe);

      // contentWindow only exists once the iframe element is attached; the LoadedPlugin record is keyed by it once
      // the frame posts its first "ready" message.
      const bootWhenReady = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        if (event.data?.type !== "noteriv:ready") return;
        window.removeEventListener("message", bootWhenReady);
        bootingRef.current.delete(plugin.id);

        const loaded: LoadedPlugin = {
          dbId: plugin.id,
          pluginId: plugin.pluginId,
          permissions: plugin.permissions,
          iframe,
          permsKey: permsKeyOf(plugin),
        };
        pluginsRef.current.set(iframe.contentWindow as Window, loaded);
        // State first so the snapshot is in place before onLoad reads it synchronously.
        if (latestSnapshotRef.current && loaded.permissions.includes("editor:read")) {
          iframe.contentWindow?.postMessage({ type: "noteriv:editor-state", state: latestSnapshotRef.current }, "*");
        }
        iframe.contentWindow?.postMessage(
          {
            type: "noteriv:boot",
            mainJs: plugin.mainJs,
            platform: optsRef.current.platform,
            version: optsRef.current.appVersion,
          },
          "*"
        );
      };
      window.addEventListener("message", bootWhenReady);
      bootingRef.current.set(plugin.id, { iframe, listener: bootWhenReady, permsKey: permsKeyOf(plugin) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed]);

  // Unmount everything when the host goes away (vault closed, page left).
  useEffect(() => {
    const plugins = pluginsRef.current;
    const booting = bootingRef.current;
    return () => {
      for (const b of booting.values()) {
        window.removeEventListener("message", b.listener);
        b.iframe.remove();
      }
      booting.clear();
      for (const [win, loaded] of Array.from(plugins)) {
        loaded.iframe.remove();
        plugins.delete(win);
        unregisterAllCodeBlockProcessorsForPlugin(loaded.pluginId);
      }
    };
  }, []);

  // Single long-lived listener that routes RPC calls from whichever plugin iframe sent them.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const source = event.source as Window | null;
      if (!source) return;
      const loaded = pluginsRef.current.get(source);
      if (!loaded) return; // not a message from a tracked plugin iframe

      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "noteriv:call") {
        dispatchCall(loaded, String(data.method), Array.isArray(data.args) ? data.args : [])
          .then((result) => {
            source.postMessage({ type: "noteriv:response", callId: data.callId, ok: true, result }, "*");
          })
          .catch((err: Error) => {
            source.postMessage({ type: "noteriv:response", callId: data.callId, ok: false, error: err.message }, "*");
          });
        return;
      }

      if (data.type === "noteriv:codeblock-result") {
        const done = pendingBlocksRef.current.get(String(data.callId));
        if (done) {
          pendingBlocksRef.current.delete(String(data.callId));
          done(data.ok === true && typeof data.html === "string" ? { html: data.html, css: typeof data.css === "string" ? data.css : "" } : null);
        }
        return;
      }

      if (data.type === "noteriv:mirror-html") {
        const kind = data.kind === "settings" ? "settings" : "sidebar";
        setPanels((prev) =>
          prev.map((p) =>
            p.pluginDbId === loaded.dbId && p.kind === kind && p.id === data.id
              ? { ...p, html: String(data.html ?? ""), css: String(data.css ?? "") }
              : p
          )
        );
        return;
      }

      if (data.type === "noteriv:boot-result" && data.ok === false) {
        const key = `${loaded.dbId}:boot-error`;
        setNotices((prev) => [...prev.filter((n) => n.key !== key), { key, message: labelsOf(optsRef.current.labels).pluginError(loaded.pluginId, String(data.error)) }]);
      }

      if (data.type === "noteriv:log" && data.level === "error") {
        const key = `${loaded.dbId}:log:${Date.now()}`;
        setNotices((prev) => [...prev, { key, message: `[${loaded.pluginId}] ${String(data.message)}` }]);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postTo = useCallback((pluginDbId: string, message: unknown) => {
    for (const loaded of pluginsRef.current.values()) {
      if (loaded.dbId === pluginDbId) {
        loaded.iframe.contentWindow?.postMessage(message, "*");
        return;
      }
    }
  }, []);

  const runCommand = useCallback(
    (pluginDbId: string, commandId: string) => postTo(pluginDbId, { type: "noteriv:invoke-command", commandId }),
    [postTo]
  );

  /** Push the latest editor snapshot to every plugin allowed to read the editor (feeds the sandbox's synchronous api.editor.*). */
  const syncEditorState = useCallback((snapshot: EditorSnapshot) => {
    latestSnapshotRef.current = snapshot;
    for (const loaded of pluginsRef.current.values()) {
      if (!loaded.permissions.includes("editor:read")) continue;
      loaded.iframe.contentWindow?.postMessage({ type: "noteriv:editor-state", state: snapshot }, "*");
    }
  }, []);

  /** Deliver an app event. Plugins without editor:read get the event but no payload. */
  const emitEvent = useCallback((event: PluginEventName, ...args: unknown[]) => {
    for (const loaded of pluginsRef.current.values()) {
      const payload = loaded.permissions.includes("editor:read") ? args : [];
      loaded.iframe.contentWindow?.postMessage({ type: "noteriv:emit-event", event, args: payload }, "*");
    }
  }, []);

  /** Forward a click/input/change from a mirrored panel back to the plugin that owns it. */
  const sendMirrorEvent = useCallback(
    (pluginDbId: string, kind: "sidebar" | "settings", id: string, ev: MirrorEvent) =>
      postTo(pluginDbId, { type: "noteriv:mirror-event", kind, id, index: ev.index, eventType: ev.type, value: ev.value, checked: ev.checked }),
    [postTo]
  );

  const clickStatusItem = useCallback(
    (pluginDbId: string, itemId: string) => postTo(pluginDbId, { type: "noteriv:invoke-status-click", itemId }),
    [postTo]
  );

  const clearDenied = useCallback(
    (pluginDbId: string) =>
      setDenied((prev) => (pluginDbId in prev ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== pluginDbId)) : prev)),
    []
  );

  return {
    containerRef,
    commands,
    statusItems,
    panels,
    deniedPermissions: denied,
    clearDenied,
    sendMirrorEvent,
    notices,
    dismissNotice,
    runCommand,
    clickStatusItem,
    syncEditorState,
    emitEvent,
  };
}

export type SandboxPluginHost = ReturnType<typeof useSandboxPluginHost>;
