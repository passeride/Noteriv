/**
 * Host for core plugins (the trusted tier of Plugin API v1, see docs/plugin-api/v1.md).
 *
 * Framework-free: it builds the `PluginApi` each plugin receives on top of a `VaultAdapter` and the ports the app
 * hands in, and keeps what plugins contribute (commands, status items, ribbon icons, views, panels) in a small store
 * the app renders from (React: `useCorePlugins`). The `PluginRegistry` from core owns enable/disable and guarantees
 * that every contribution of a plugin is removed when it stops.
 */

import {
  PLUGIN_API_VERSION,
  type EditorApi,
  type MarkdownPostProcessor,
  type PluginApi,
  type PluginEvent,
  type PluginPlatform,
  type PostProcessorContext,
  type SidebarPanel,
  type SettingsTab,
  type VaultEntry,
  type AttachmentViewerContext,
  type FileViewContext,
  type FileViewInstance,
  type ViewFactory,
  type ViewState,
} from "@noteriv/plugin-api";
import { PluginRegistry, type CorePluginDef, type PluginStateStore } from "@noteriv/core/plugin-registry";
import { toPosixPath, type NoteRef, type VaultAdapter } from "@noteriv/core/vault-adapter";
import {
  registerCodeBlockProcessor,
  unregisterAllCodeBlockProcessorsForPlugin,
  unregisterCodeBlockProcessor,
} from "@noteriv/core/markdown-code-block-registry";
import { frontmatterBlock } from "@noteriv/core/properties";
import { getLocale, onLocaleChange, t } from "../i18n";
import { adapterNoteEditor, mapLimited, type NoteEditor } from "../panels/note-edit";

export interface CorePluginHostServices {
  adapter: VaultAdapter;
  platform: PluginPlatform;
  /** Absolute vault path on desktop, null on web. */
  vaultPath: string | null;
  editor: EditorApi;
  /** Vault-relative path of the note in the active tab. */
  getCurrentFile(): string | null;
  openFile(path: string): Promise<boolean>;
  /** Shows a registered view (`useCorePluginHost` does: an overlay). Absent: `workspace.openView` resolves false. */
  openView?(type: string, state: ViewState): Promise<boolean>;
  /** Closes the shown view if it is of one of these types. */
  closeView?(types: string[]): void;
  /** A plugin created, changed or deleted notes: the app refreshes its file tree / index. */
  onVaultChanged?(): void;
  /**
   * How `vault.edit` changes a note: through its open tab when it has one (the app's editNoteInTabs). Absent: read and
   * written through the adapter, never over a newer version.
   */
  editNote?: NoteEditor;
  /** Shows or hides a core plugin's sidebar panel (namespaced key). Absent: `ui.toggleSidebarPanel` does nothing. */
  toggleSidebarPanel?(key: string): void;
  /** Draws markdown read-only into `el` (the editor's live preview); returns the cleanup. Absent: plain text. */
  renderReadOnly?(source: string, el: HTMLElement): () => void;
  notify(message: string, durationMs?: number): void;
  loadPluginSettings(pluginId: string): Promise<Record<string, unknown>>;
  savePluginSettings(pluginId: string, data: Record<string, unknown>): Promise<void>;
  stateStore: PluginStateStore;
  plugins: CorePluginDef<PluginApi>[];
}

interface Owned {
  pluginId: string;
  /** Namespaced `<pluginId>:<local id>`; unique across plugins. */
  key: string;
  /** The id the plugin used. */
  id: string;
}

export interface HostCommand extends Owned {
  name: string;
  icon?: string;
  hotkey?: string;
  run(): void;
}

export interface HostStatusItem extends Owned {
  text: string;
  title?: string;
  onClick?: () => void;
}

export interface HostRibbonIcon extends Owned {
  title: string;
  icon?: string;
  onClick(): void;
}

export interface HostNoteToolbarButton extends Owned {
  title: string;
  icon: string;
  onClick(): void;
}

export interface HostFileView extends Owned {
  /** Guarded: a plugin's match that throws counts as "no". */
  match(file: { path: string; content: string }): boolean;
  mount(container: HTMLElement, ctx: FileViewContext): FileViewInstance | void;
}

export interface HostAttachmentViewer extends Owned {
  /** Guarded: a plugin's match that throws counts as "no". */
  match(file: { target: string; name: string }): boolean;
  mount(container: HTMLElement, ctx: AttachmentViewerContext): void | (() => void);
}

export interface HostPanel extends Owned {
  title: string;
  icon?: string;
  render(container: HTMLElement): void | (() => void);
}

export interface CorePluginContributions {
  commands: HostCommand[];
  statusItems: HostStatusItem[];
  ribbonIcons: HostRibbonIcon[];
  noteToolbarButtons: HostNoteToolbarButton[];
  /** In registration order; the first that matches a file wins. */
  fileViews: HostFileView[];
  /** In registration order; the first that matches an attachment wins. */
  attachmentViewers: HostAttachmentViewer[];
  sidebarPanels: HostPanel[];
  settingsTabs: HostPanel[];
  /** View types plugins registered, in registration order. */
  viewTypes: string[];
}

type Kind =
  | "commands"
  | "statusItems"
  | "ribbonIcons"
  | "noteToolbarButtons"
  | "fileViews"
  | "attachmentViewers"
  | "sidebarPanels"
  | "settingsTabs";

const EMPTY: CorePluginContributions = {
  commands: [],
  statusItems: [],
  ribbonIcons: [],
  noteToolbarButtons: [],
  fileViews: [],
  attachmentViewers: [],
  sidebarPanels: [],
  settingsTabs: [],
  viewTypes: [],
};

export interface CorePluginHost {
  readonly registry: PluginRegistry<PluginApi>;
  /** Stable between changes (safe as a `useSyncExternalStore` snapshot). */
  getContributions(): CorePluginContributions;
  subscribeContributions(listener: () => void): () => void;
  /** App-side events (`file-open`, `editor-change`, …) delivered to every plugin's `events.on` handlers. */
  emit(event: PluginEvent, ...args: unknown[]): void;
  getView(type: string): ViewFactory | undefined;
  /** The file view (`ui.registerFileView`) that shows this file instead of the editor, if any. */
  findFileView(path: string, content: string): HostFileView | undefined;
  /** For renderers: run every registered post-processor over a rendered note. */
  runPostProcessors(el: HTMLElement, ctx: PostProcessorContext): void;
  init(): Promise<void>;
  dispose(): Promise<void>;
}

function report(pluginId: string, what: string, err: unknown) {
  console.error(`[core-plugin:${pluginId}] ${what}:`, err);
}

/** Direct children of `dir` (vault-relative), with folders derived from note paths. */
export function listVaultEntries(notes: NoteRef[], dir?: string): VaultEntry[] {
  const base = (dir ?? "").replace(/^\/+|\/+$/g, "");
  const prefix = base ? `${base}/` : "";
  const out: VaultEntry[] = [];
  const dirs = new Set<string>();
  for (const n of notes) {
    if (!n.path.startsWith(prefix)) continue;
    const rest = n.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      out.push({ path: n.path, name: n.name, isDir: false });
    } else {
      const name = rest.slice(0, slash);
      if (!dirs.has(name)) {
        dirs.add(name);
        out.push({ path: prefix + name, name, isDir: true });
      }
    }
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

export function createCorePluginHost(services: CorePluginHostServices): CorePluginHost {
  const { adapter } = services;
  let contributions: CorePluginContributions = EMPTY;
  const listeners = new Set<() => void>();
  const views = new Map<string, { pluginId: string; factory: ViewFactory }>();
  const postProcessors: { pluginId: string; fn: MarkdownPostProcessor }[] = [];
  const handlers = new Map<PluginEvent, Set<{ pluginId: string; fn: (...args: any[]) => void }>>();

  function changed(next: CorePluginContributions) {
    contributions = next;
    for (const l of Array.from(listeners)) l();
  }

  function upsert<K extends Kind>(kind: K, item: CorePluginContributions[K][number]) {
    const list = contributions[kind] as Owned[];
    changed({ ...contributions, [kind]: [...list.filter((x) => x.key !== item.key), item] });
  }

  function remove(kind: Kind, key: string) {
    const list = contributions[kind] as Owned[];
    if (list.some((x) => x.key === key)) changed({ ...contributions, [kind]: list.filter((x) => x.key !== key) });
  }

  function viewTypes(): string[] {
    return Array.from(views.keys());
  }

  // `vault.read`/`exists`/`list` each need the note list. A plugin scanning the vault calls them hundreds of times
  // in a row, and on web every listNotes() is a request for the whole index, so one list serves calls made within
  // NOTE_LIST_TTL_MS. Writes through the API drop it; changes made elsewhere show up once it expires.
  const NOTE_LIST_TTL_MS = 2000;
  let noteList: { at: number; notes: Promise<NoteRef[]> } | null = null;

  function listNotes(): Promise<NoteRef[]> {
    if (!noteList || Date.now() - noteList.at > NOTE_LIST_TTL_MS) {
      const notes = adapter.listNotes();
      const entry = { at: Date.now(), notes };
      noteList = entry;
      notes.catch(() => {
        if (noteList === entry) noteList = null;
      });
    }
    return noteList.notes;
  }

  async function findNote(path: string): Promise<NoteRef | undefined> {
    const notes = await listNotes();
    return notes.find((n) => n.path === path);
  }

  /** Call plugin code without letting it throw into the app. */
  function guard<A extends unknown[]>(pluginId: string, what: string, fn: (...args: A) => unknown) {
    return (...args: A) => {
      try {
        const r = fn(...args);
        if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch((e) => report(pluginId, what, e));
      } catch (e) {
        report(pluginId, what, e);
      }
    };
  }

  function createApi(pluginId: string): PluginApi {
    const key = (id: string) => `${pluginId}:${id}`;
    const panel = (p: SidebarPanel | SettingsTab, title: string): HostPanel => ({
      pluginId,
      key: key(p.id),
      id: p.id,
      title,
      icon: "icon" in p ? p.icon : undefined,
      render: p.render,
    });

    return {
      vault: {
        async read(path) {
          const ref = await findNote(path);
          return ref ? adapter.readNote(ref.id) : null;
        },
        async write(path, content) {
          const ref = await findNote(path);
          if (ref) await adapter.writeNote(ref.id, content);
          else await adapter.createNote(path, content);
          noteList = null;
          services.onVaultChanged?.();
          return true;
        },
        async edit(path, transform) {
          const ref = await findNote(path);
          if (!ref) return false;
          const changed = await (services.editNote ?? adapterNoteEditor(adapter))(ref.id, transform);
          if (changed) services.onVaultChanged?.();
          return changed;
        },
        async frontmatter() {
          const heads = adapter.frontmatterHeads
            ? await adapter.frontmatterHeads()
            : await mapLimited(await listNotes(), 8, async (ref) => ({ ref, head: (await adapter.readNote(ref.id)) ?? "" }));
          return heads.flatMap(({ ref, head }) => {
            const block = frontmatterBlock(head);
            return block ? [{ path: ref.path, block }] : [];
          });
        },
        async list(dir) {
          return listVaultEntries(await listNotes(), dir);
        },
        async exists(path) {
          if ((await findNote(path)) !== undefined) return true;
          return adapter.fileExists ? adapter.fileExists(path) : false;
        },
        async delete(path) {
          const ref = await findNote(path);
          if (!ref) return false;
          await adapter.deleteNote(ref.id);
          noteList = null;
          services.onVaultChanged?.();
          return true;
        },
        async stats() {
          if (!adapter.noteDates) return {};
          const [notes, dates] = await Promise.all([listNotes(), adapter.noteDates()]);
          const out: Record<string, { createdAt: number; modifiedAt: number }> = {};
          for (const n of notes) if (dates[n.id]) out[n.path] = dates[n.id];
          return out;
        },
        async readBatch(paths) {
          if (adapter.readBatchNotes) {
            const results = await adapter.readBatchNotes({ paths });
            const map: Record<string, string> = {};
            for (const r of results) map[r.ref.path] = r.content;
            return map;
          }
          const map: Record<string, string> = {};
          await mapLimited(paths, 8, async (p) => {
            const ref = await findNote(p);
            const content = ref ? await adapter.readNote(ref.id) : null;
            if (content !== null) map[p] = content;
          });
          return map;
        },
        async readAll() {
          if (adapter.readBatchNotes) {
            const results = await adapter.readBatchNotes({ all: true });
            return results.map((r) => ({ path: r.ref.path, content: r.content }));
          }
          const notes = await listNotes();
          const results = await mapLimited(notes, 8, async (ref) => {
            const content = await adapter.readNote(ref.id);
            return content !== null ? { path: ref.path, content } : null;
          });
          return results.filter((r): r is { path: string; content: string } => r !== null);
        },
        async saveAttachment(name, data) {
          if (!adapter.saveAttachment) throw new Error("This vault cannot store attachments");
          // A file name only: no folders, nothing that could step out of the attachments place.
          const safe = name.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "") || "attachment";
          return adapter.saveAttachment(safe, data);
        },
        async versionSources() {
          return (await adapter.historySources?.()) ?? { snapshots: false, git: false };
        },
        async snapshots(path) {
          const ref = await findNote(path);
          return ref && adapter.noteSnapshots ? adapter.noteSnapshots(ref.id) : [];
        },
        async readSnapshot(path, id) {
          const ref = await findNote(path);
          return ref && adapter.readNoteSnapshot ? adapter.readNoteSnapshot(ref.id, id) : null;
        },
        async gitLog(path) {
          const ref = await findNote(path);
          return ref && adapter.noteGitLog ? adapter.noteGitLog(ref.id) : [];
        },
        async readAtCommit(path, hash) {
          const ref = await findNote(path);
          return ref && adapter.readNoteAtCommit ? adapter.readNoteAtCommit(ref.id, hash) : null;
        },
        async resolve(ref) {
          if (!ref) return null;
          const posix = toPosixPath(ref);
          const notes = await listNotes();
          const hit = notes.find((n) => n.path === ref || n.id === ref || toPosixPath(n.id) === posix);
          return hit ? hit.path : null;
        },
        async listAttachments() {
          return adapter.listAttachments ? adapter.listAttachments() : [];
        },
        async attachmentUrl(target) {
          return target && adapter.attachmentUrl ? adapter.attachmentUrl(target) : null;
        },
        async readAttachment(target) {
          return target && adapter.readAttachment ? adapter.readAttachment(target) : null;
        },
        async getAttachmentData(target) {
          return target && adapter.getAttachmentData ? adapter.getAttachmentData(target) : null;
        },
        async setAttachmentData(target, data) {
          if (!adapter.setAttachmentData) throw new Error("This vault cannot store attachment data");
          await adapter.setAttachmentData(target, data);
        },
      },

      editor: services.editor,

      markdown: {
        registerCodeBlockProcessor: (language, processor) => registerCodeBlockProcessor(pluginId, language, processor),
        unregisterCodeBlockProcessor: (language) => unregisterCodeBlockProcessor(pluginId, language),
        registerPostProcessor: (fn) => void postProcessors.push({ pluginId, fn }),
        renderReadOnly: (source, el) => {
          if (services.renderReadOnly) return services.renderReadOnly(source, el);
          const pre = document.createElement("pre");
          pre.style.whiteSpace = "pre-wrap";
          pre.textContent = source;
          el.appendChild(pre);
          return () => pre.remove();
        },
      },

      ui: {
        addCommand: (cmd) =>
          upsert("commands", {
            pluginId,
            key: key(cmd.id),
            id: cmd.id,
            name: cmd.name,
            icon: cmd.icon,
            hotkey: cmd.hotkey,
            run: guard(pluginId, `command ${cmd.id}`, () => cmd.callback()),
          }),
        removeCommand: (id) => remove("commands", key(id)),
        addStatusBarItem: (item) =>
          upsert("statusItems", {
            pluginId,
            key: key(item.id),
            id: item.id,
            text: String(item.text ?? ""),
            title: item.title,
            onClick: item.onClick ? guard(pluginId, `status ${item.id}`, item.onClick) : undefined,
          }),
        removeStatusBarItem: (id) => remove("statusItems", key(id)),
        addSidebarPanel: (p) => upsert("sidebarPanels", panel(p, p.title)),
        removeSidebarPanel: (id) => remove("sidebarPanels", key(id)),
        toggleSidebarPanel: (id) => services.toggleSidebarPanel?.(key(id)),
        addSettingsTab: (t) => upsert("settingsTabs", panel(t, t.name)),
        removeSettingsTab: (id) => remove("settingsTabs", key(id)),
        showNotice: (message, durationMs) => services.notify(String(message), durationMs),
        registerView: (type, factory) => {
          views.set(type, { pluginId, factory });
          changed({ ...contributions, viewTypes: viewTypes() });
        },
        unregisterView: (type) => {
          if (views.get(type)?.pluginId !== pluginId) return;
          views.delete(type);
          changed({ ...contributions, viewTypes: viewTypes() });
        },
        addRibbonIcon: (icon) =>
          upsert("ribbonIcons", {
            pluginId,
            key: key(icon.id),
            id: icon.id,
            title: icon.title,
            icon: icon.icon,
            onClick: guard(pluginId, `ribbon ${icon.id}`, () => icon.onClick()),
          }),
        removeRibbonIcon: (id) => remove("ribbonIcons", key(id)),
        addNoteToolbarButton: (b) =>
          upsert("noteToolbarButtons", {
            pluginId,
            key: key(b.id),
            id: b.id,
            title: b.title,
            icon: b.icon,
            onClick: guard(pluginId, `note toolbar ${b.id}`, () => b.onClick()),
          }),
        removeNoteToolbarButton: (id) => remove("noteToolbarButtons", key(id)),
        registerFileView: (v) =>
          upsert("fileViews", {
            pluginId,
            key: key(v.id),
            id: v.id,
            match: (file) => {
              try {
                return v.match(file) === true;
              } catch (e) {
                report(pluginId, `file view ${v.id} match`, e);
                return false;
              }
            },
            mount: (container, ctx) => v.mount(container, ctx),
          }),
        unregisterFileView: (id) => remove("fileViews", key(id)),
        registerAttachmentViewer: (v) =>
          upsert("attachmentViewers", {
            pluginId,
            key: key(v.id),
            id: v.id,
            match: (file) => {
              try {
                return v.match(file) === true;
              } catch (e) {
                report(pluginId, `attachment viewer ${v.id} match`, e);
                return false;
              }
            },
            mount: (container, ctx) => v.mount(container, ctx),
          }),
        unregisterAttachmentViewer: (id) => remove("attachmentViewers", key(id)),
      },

      events: {
        on: (event, fn) => {
          if (!handlers.has(event)) handlers.set(event, new Set());
          handlers.get(event)!.add({ pluginId, fn });
        },
        off: (event, fn) => {
          const set = handlers.get(event);
          if (!set) return;
          for (const h of Array.from(set)) if (h.pluginId === pluginId && h.fn === fn) set.delete(h);
        },
        emit: (event, ...args) => host.emit(event, ...args),
      },

      workspace: {
        openFile: (path) => services.openFile(path),
        openView: (type, state) => (services.openView && views.has(type) ? services.openView(type, state ?? { path: null }) : Promise.resolve(false)),
        closeView: () => services.closeView?.(Array.from(views).filter(([, v]) => v.pluginId === pluginId).map(([type]) => type)),
      },

      settings: {
        load: () => services.loadPluginSettings(pluginId),
        save: (data) => services.savePluginSettings(pluginId, data),
      },

      app: {
        version: PLUGIN_API_VERSION,
        platform: services.platform,
        vaultPath: services.vaultPath,
        get currentFile() {
          return services.getCurrentFile();
        },
        loadSettings: () => services.loadPluginSettings(pluginId),
        saveSettings: (data) => services.savePluginSettings(pluginId, data),
      },

      i18n: {
        get locale() {
          return getLocale();
        },
        t: (key, params) => t(key, params),
      },
    };
  }

  function disposePlugin(pluginId: string) {
    const keep = <T extends Owned>(list: T[]) => list.filter((x) => x.pluginId !== pluginId);
    const ownViews = Array.from(views).filter(([, v]) => v.pluginId === pluginId).map(([type]) => type);
    if (ownViews.length) services.closeView?.(ownViews);
    for (const type of ownViews) views.delete(type);
    for (let i = postProcessors.length - 1; i >= 0; i--) if (postProcessors[i].pluginId === pluginId) postProcessors.splice(i, 1);
    for (const set of handlers.values()) for (const h of Array.from(set)) if (h.pluginId === pluginId) set.delete(h);
    unregisterAllCodeBlockProcessorsForPlugin(pluginId);
    changed({
      commands: keep(contributions.commands),
      statusItems: keep(contributions.statusItems),
      ribbonIcons: keep(contributions.ribbonIcons),
      noteToolbarButtons: keep(contributions.noteToolbarButtons),
      fileViews: keep(contributions.fileViews),
      attachmentViewers: keep(contributions.attachmentViewers),
      sidebarPanels: keep(contributions.sidebarPanels),
      settingsTabs: keep(contributions.settingsTabs),
      viewTypes: viewTypes(),
    });
  }

  const registry = new PluginRegistry<PluginApi>({
    plugins: services.plugins,
    store: services.stateStore,
    createContext: (pluginId) => {
      let disposed = false;
      return {
        api: createApi(pluginId),
        dispose: () => {
          if (disposed) return;
          disposed = true;
          disposePlugin(pluginId);
        },
      };
    },
  });

  let stopLocaleWatch: (() => void) | null = null;

  const host: CorePluginHost = {
    registry,
    getContributions: () => contributions,
    subscribeContributions(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event, ...args) {
      for (const h of Array.from(handlers.get(event) ?? [])) {
        try {
          h.fn(...args);
        } catch (e) {
          report(h.pluginId, `event ${event}`, e);
        }
      }
    },
    getView: (type) => views.get(type)?.factory,
    findFileView: (path, content) => contributions.fileViews.find((v) => v.match({ path, content })),
    runPostProcessors(el, ctx) {
      for (const p of postProcessors.slice()) {
        try {
          p.fn(el, ctx);
        } catch (e) {
          report(p.pluginId, "post-processor", e);
        }
      }
    },
    init: () => {
      stopLocaleWatch ??= onLocaleChange(() => void registry.restartRunning());
      return registry.init();
    },
    dispose: () => {
      stopLocaleWatch?.();
      stopLocaleWatch = null;
      return registry.dispose();
    },
  };
  return host;
}

/**
 * Stores on/off choices under one key of the vault settings blob, read-modify-write so other keys survive. Web uses
 * this over `VaultAdapter.getSettings/saveSettings` (vault settings live in the DB).
 */
export function settingsKeyStateStore(
  load: () => Promise<Record<string, unknown>>,
  save: (settings: Record<string, unknown>) => Promise<void>,
  key = "corePlugins"
): PluginStateStore {
  return {
    async load() {
      const value = (await load())[key];
      return value && typeof value === "object" ? (value as Record<string, boolean>) : {};
    },
    async save(state) {
      const current = await load();
      await save({ ...current, [key]: state });
    },
  };
}
