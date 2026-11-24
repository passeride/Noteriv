import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CorePlugin, FileViewContext, PluginApi } from "@noteriv/plugin-api";
import { MemoryVaultAdapter } from "@noteriv/core/memory-vault-adapter";
import type { CorePluginDef, PluginStateStore } from "@noteriv/core/plugin-registry";
import { getCodeBlockProcessor } from "@noteriv/core/markdown-code-block-registry";
import {
  createCorePluginHost,
  CorePluginsSection,
  CorePluginAttachmentViewer,
  CorePluginFileView,
  CorePluginNoteToolbarButtons,
  matchAttachmentViewer,
  CorePluginSidePanels,
  matchFileView,
  CorePluginViewOverlay,
  listVaultEntries,
  settingsKeyStateStore,
  matchesHotkey,
  useCorePluginHost,
  useCorePluginHotkeys,
  useCorePlugins,
  type CorePluginHost,
  type CorePluginHostConfig,
} from "../src/plugins";
import { setLocale } from "../src/i18n";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function memoryStore(initial: Record<string, boolean> = {}): PluginStateStore {
  let state = { ...initial };
  return { load: async () => ({ ...state }), save: async (s) => void (state = { ...s }) };
}

const editor = {
  getContent: () => "hello world",
  setContent: vi.fn(),
  insertAtCursor: vi.fn(),
  getSelection: () => "",
  replaceSelection: vi.fn(),
  getCursorPosition: () => ({ line: 1, ch: 0 }),
  setCursor: vi.fn(),
};

function makeHost(plugins: CorePluginDef<PluginApi>[], opts: { adapter?: MemoryVaultAdapter; store?: PluginStateStore } = {}) {
  const notify = vi.fn();
  const settings: Record<string, Record<string, unknown>> = {};
  const host = createCorePluginHost({
    adapter: opts.adapter ?? new MemoryVaultAdapter(),
    platform: "web",
    vaultPath: null,
    editor,
    getCurrentFile: () => "a.md",
    openFile: async () => true,
    notify,
    loadPluginSettings: async (id) => settings[id] ?? {},
    savePluginSettings: async (id, data) => void (settings[id] = data),
    stateStore: opts.store ?? memoryStore(),
    plugins,
  });
  return { host, notify, settings };
}

function def(id: string, plugin: CorePlugin): CorePluginDef<PluginApi> {
  return { id, name: id, description: `${id} plugin`, load: async () => ({ default: plugin }) };
}

describe("core plugin host", () => {
  it("gives plugins the app's language and reloads running plugins when it changes", async () => {
    const seen: string[] = [];
    const { host } = makeHost([
      { ...def("words", {
        onload(api) {
          seen.push(api.i18n.locale);
          api.ui.addCommand({ id: "show", name: api.i18n.t("plugins.wordCount.command"), callback: () => undefined });
        },
      }), defaultEnabled: true },
    ]);
    await host.init();
    expect(host.getContributions().commands[0].name).toBe("Word count: show note statistics");
    await setLocale("vi");
    await vi.waitFor(() => expect(host.getContributions().commands[0]?.name).toBe("Đếm từ: thống kê ghi chú"));
    expect(seen).toEqual(["en", "vi"]);
    expect(host.getContributions().commands.map((c) => c.name)).toEqual(["Đếm từ: thống kê ghi chú"]);
    await host.dispose();
    await setLocale("en");
    expect(seen).toEqual(["en", "vi"]); // no reload after dispose
  });

  it("collects a plugin's contributions under namespaced keys and removes them all on disable", async () => {
    const ran = vi.fn();
    const { host } = makeHost([
      def("demo", {
        onload(api) {
          api.ui.addCommand({ id: "go", name: "Go", hotkey: "Mod+G", callback: ran });
          api.ui.addStatusBarItem({ id: "s", text: "3 words" });
          api.ui.addRibbonIcon({ id: "r", title: "Ribbon", onClick: ran });
          api.ui.registerView("demo-view", () => ({ mount: () => undefined }));
          api.ui.addSidebarPanel({ id: "p", title: "Panel", icon: "x", render: () => undefined });
          api.markdown.registerCodeBlockProcessor("demo-lang", () => undefined);
        },
      }),
    ]);
    await host.registry.setEnabled("demo", true);
    const c = host.getContributions();
    expect(c.commands.map((x) => [x.key, x.hotkey])).toEqual([["demo:go", "Mod+G"]]);
    expect(c.statusItems.map((x) => x.text)).toEqual(["3 words"]);
    expect(c.ribbonIcons.map((x) => x.key)).toEqual(["demo:r"]);
    expect(c.sidebarPanels.map((x) => x.key)).toEqual(["demo:p"]);
    expect(c.viewTypes).toEqual(["demo-view"]);
    expect(getCodeBlockProcessor("demo-lang")?.pluginId).toBe("demo");
    c.commands[0].run();
    c.ribbonIcons[0].onClick();
    expect(ran).toHaveBeenCalledTimes(2);

    await host.registry.setEnabled("demo", false);
    const after = host.getContributions();
    expect([after.commands, after.statusItems, after.ribbonIcons, after.sidebarPanels, after.viewTypes].every((l) => l.length === 0)).toBe(true);
    expect(host.getView("demo-view")).toBeUndefined();
    expect(getCodeBlockProcessor("demo-lang")).toBeUndefined();
  });

  it("delivers app events only while the plugin runs, and isolates handler errors", async () => {
    const seen: unknown[] = [];
    const { host } = makeHost([
      def("bad", {
        onload(api) {
          api.events.on("file-open", () => {
            throw new Error("handler boom");
          });
        },
      }),
      def("good", {
        onload(api) {
          api.events.on("file-open", (p) => seen.push(p));
        },
      }),
    ]);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await host.registry.setEnabled("bad", true);
    await host.registry.setEnabled("good", true);
    host.emit("file-open", "a.md");
    await host.registry.setEnabled("good", false);
    host.emit("file-open", "b.md");
    expect(seen).toEqual(["a.md"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("implements the vault API by path on top of the VaultAdapter", async () => {
    const adapter = new MemoryVaultAdapter({ "notes/a.md": "A", "notes/deep/b.md": "B", "root.md": "R" });
    let api!: PluginApi;
    const { host } = makeHost([def("v", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("v", true);
    expect(await api.vault.read("notes/a.md")).toBe("A");
    expect(await api.vault.read("missing.md")).toBeNull();
    expect(await api.vault.exists("root.md")).toBe(true);
    await api.vault.write("notes/a.md", "A2");
    expect(await api.vault.read("notes/a.md")).toBe("A2");
    await api.vault.write("new.md", "N");
    expect(await api.vault.read("new.md")).toBe("N");
    expect(await api.vault.list("notes")).toEqual([
      { path: "notes/deep", name: "deep", isDir: true },
      { path: "notes/a.md", name: "a.md", isDir: false },
    ]);
    expect(await api.vault.delete("root.md")).toBe(true);
    expect(await api.vault.delete("root.md")).toBe(false);
  });

  it("serves a vault scan from one note list, and drops it after a write", async () => {
    const adapter = new MemoryVaultAdapter({ "a.md": "A", "b.md": "B", "c/d.md": "D" });
    const listNotes = vi.spyOn(adapter, "listNotes");
    let api!: PluginApi;
    const { host } = makeHost([def("v", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("v", true);
    await api.vault.list();
    await Promise.all(["a.md", "b.md", "c/d.md"].map((p) => api.vault.read(p)));
    expect(listNotes).toHaveBeenCalledTimes(1);
    await api.vault.write("e.md", "E");
    expect(await api.vault.exists("e.md")).toBe(true);
    expect(listNotes.mock.calls.length).toBeGreaterThan(1);
  });

  it("supports readBatch and readAll with adapter.readBatchNotes delegation and fallback", async () => {
    const adapter = new MemoryVaultAdapter({ "a.md": "Content A", "b.md": "Content B", "c.md": "Content C" });
    const spy = vi.spyOn(adapter, "readBatchNotes");
    let api!: PluginApi;
    const { host } = makeHost([def("v", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("v", true);

    // Test readBatch
    const batch = await api.vault.readBatch!(["a.md", "c.md"]);
    expect(batch).toEqual({ "a.md": "Content A", "c.md": "Content C" });
    expect(spy).toHaveBeenCalledWith({ paths: ["a.md", "c.md"] });

    // Test readAll
    const all = await api.vault.readAll!();
    expect(all).toEqual(
      expect.arrayContaining([
        { path: "a.md", content: "Content A" },
        { path: "b.md", content: "Content B" },
        { path: "c.md", content: "Content C" },
      ])
    );
    expect(spy).toHaveBeenCalledWith({ all: true });

    // Test fallback when adapter does not have readBatchNotes
    const legacyAdapter = new MemoryVaultAdapter({ "x.md": "X", "y.md": "Y" });
    delete (legacyAdapter as any).readBatchNotes;
    let legacyApi!: PluginApi;
    const { host: legacyHost } = makeHost([def("v2", { onload: (a) => void (legacyApi = a) })], { adapter: legacyAdapter });
    await legacyHost.registry.setEnabled("v2", true);

    const fallbackBatch = await legacyApi.vault.readBatch!(["x.md"]);
    expect(fallbackBatch).toEqual({ "x.md": "X" });

    const fallbackAll = await legacyApi.vault.readAll!();
    expect(fallbackAll).toEqual(
      expect.arrayContaining([
        { path: "x.md", content: "X" },
        { path: "y.md", content: "Y" },
      ])
    );
  });

  it("gives note dates by path and tells the app after a plugin changes the vault", async () => {
    const adapter = new MemoryVaultAdapter({ "a.md": "A", "b.md": "B" });
    adapter.setDates("a.md", { createdAt: 1, modifiedAt: 2 });
    const onVaultChanged = vi.fn();
    let api!: PluginApi;
    const host = createCorePluginHost({
      adapter,
      platform: "web",
      vaultPath: null,
      editor,
      getCurrentFile: () => null,
      openFile: async () => true,
      notify: vi.fn(),
      loadPluginSettings: async () => ({}),
      savePluginSettings: async () => undefined,
      stateStore: memoryStore(),
      plugins: [def("v", { onload: (a) => void (api = a) })],
      onVaultChanged,
    });
    await host.registry.setEnabled("v", true);
    expect(await api.vault.stats()).toEqual({ "a.md": { createdAt: 1, modifiedAt: 2 } });
    await api.vault.write("Daily/2026-10-16.md", "# day");
    await api.vault.delete("b.md");
    expect(onVaultChanged).toHaveBeenCalledTimes(2);
  });

  it("passes editor, settings, notices and app info through", async () => {
    let api!: PluginApi;
    const { host, notify, settings } = makeHost([def("x", { onload: (a) => void (api = a) })]);
    await host.registry.setEnabled("x", true);
    expect(api.editor.getContent()).toBe("hello world");
    api.ui.showNotice("hi", 100);
    expect(notify).toHaveBeenCalledWith("hi", 100);
    await api.settings.save({ theme: "dark" });
    expect(settings.x).toEqual({ theme: "dark" });
    expect(await api.app.loadSettings()).toEqual({ theme: "dark" });
    expect(api.app.platform).toBe("web");
    expect(api.app.currentFile).toBe("a.md");
    expect(await api.workspace.openView("none")).toBe(false);
  });

  it("removes contributions made before onload failed", async () => {
    const { host } = makeHost([
      def("half", {
        onload(api) {
          api.ui.addCommand({ id: "c", name: "C", callback: () => undefined });
          throw new Error("late failure");
        },
      }),
    ]);
    await host.registry.setEnabled("half", true);
    expect(host.registry.list()[0].status).toBe("error");
    expect(host.getContributions().commands).toEqual([]);
  });
});

describe("listVaultEntries", () => {
  it("lists the vault root with folders first", () => {
    const notes = [
      { id: "1", path: "z.md", name: "z.md" },
      { id: "2", path: "a/b.md", name: "b.md" },
    ];
    expect(listVaultEntries(notes)).toEqual([
      { path: "a", name: "a", isDir: true },
      { path: "z.md", name: "z.md", isDir: false },
    ]);
  });
});

describe("settingsKeyStateStore", () => {
  it("keeps the other settings keys when saving", async () => {
    let blob: Record<string, unknown> = { theme: "dark" };
    const store = settingsKeyStateStore(async () => blob, async (s) => void (blob = s));
    expect(await store.load()).toEqual({});
    await store.save({ "word-count": true });
    expect(blob).toEqual({ theme: "dark", corePlugins: { "word-count": true } });
    expect(await store.load()).toEqual({ "word-count": true });
  });
});

describe("CorePluginsSection with useCorePlugins", () => {
  function Harness({ host }: { host: CorePluginHost }) {
    const { plugins, contributions, setEnabled } = useCorePlugins(host);
    return createElement(
      "div",
      null,
      createElement(CorePluginsSection, { plugins, onToggle: (id, on) => void setEnabled(id, on) }),
      createElement("output", null, contributions.statusItems.map((s) => s.text).join(","))
    );
  }

  it("toggles a plugin from the switch and re-renders its contributions", async () => {
    const { host } = makeHost([
      def("wc", {
        onload(api) {
          api.ui.addStatusBarItem({ id: "n", text: "42 words" });
        },
      }),
    ]);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(createElement(Harness, { host })));
    const toggle = el.querySelector<HTMLButtonElement>('[data-core-plugin="wc"] button[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(el.querySelector("output")!.textContent).toBe("");

    await act(async () => {
      toggle.click();
      await host.registry.setEnabled("wc", true); // wait for the queued enable to settle
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(el.querySelector("output")!.textContent).toBe("42 words");

    await act(async () => {
      toggle.click();
      await host.registry.setEnabled("wc", false);
    });
    expect(el.querySelector("output")!.textContent).toBe("");
    await act(async () => root.unmount());
    el.remove();
  });
});

describe("plugin views (useCorePluginHost + CorePluginViewOverlay)", () => {
  it("opens a plugin view over the page, closes it on request, on Escape, and when the plugin is turned off", async () => {
    let api!: PluginApi;
    const cleanup = vi.fn();
    const plugin: CorePlugin = {
      onload(a) {
        api = a;
        a.ui.registerView("demo-view", () => ({
          mount(container, state) {
            const p = document.createElement("p");
            p.textContent = `view for ${state.path}`;
            container.appendChild(p);
            return cleanup;
          },
        }));
      },
    };
    const config: CorePluginHostConfig = {
      adapter: new MemoryVaultAdapter(),
      platform: "web",
      vaultPath: null,
      plugins: [{ ...def("demo", plugin), defaultEnabled: true }],
      storage: { stateStore: memoryStore(), loadPluginSettings: async () => ({}), savePluginSettings: async () => undefined },
    };
    let hostRef: CorePluginHost | null = null;
    function Harness() {
      const h = useCorePluginHost(config, { editor, getCurrentFile: () => null, openFile: () => true });
      hostRef = h.host;
      return createElement(CorePluginViewOverlay, { host: h.host, view: h.activeView, onClose: h.closeView });
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(createElement(Harness)));
    await act(async () => void (await hostRef!.registry.setEnabled("demo", true)));

    await act(async () => void (await api.workspace.openView("demo-view", { path: "a.md" })));
    expect(el.querySelector('[data-core-view="demo-view"] p')?.textContent).toBe("view for a.md");
    await act(async () => api.workspace.closeView());
    expect(el.querySelector("[data-core-view]")).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);

    await act(async () => void (await api.workspace.openView("demo-view")));
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(el.querySelector("[data-core-view]")).toBeNull();

    await act(async () => void (await api.workspace.openView("demo-view")));
    await act(async () => void (await hostRef!.registry.setEnabled("demo", false)));
    expect(el.querySelector("[data-core-view]")).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
    el.remove();
  });
});

describe("plugin sidebar panels (CorePluginSidePanels)", () => {
  it("toggles a panel from the plugin, shows it on the right with its own DOM, and drops it when the plugin stops", async () => {
    let api!: PluginApi;
    const cleanup = vi.fn();
    const config: CorePluginHostConfig = {
      adapter: new MemoryVaultAdapter(),
      platform: "web",
      vaultPath: null,
      plugins: [
        {
          ...def("p", {
            onload(a) {
              api = a;
              a.ui.addSidebarPanel({
                id: "side",
                title: "Side",
                icon: "S",
                render(el) {
                  el.textContent = "panel body";
                  return cleanup;
                },
              });
            },
          }),
          defaultEnabled: true,
        },
      ],
      storage: { stateStore: memoryStore(), loadPluginSettings: async () => ({}), savePluginSettings: async () => undefined },
    };
    let hostRef: CorePluginHost | null = null;
    function Harness() {
      const h = useCorePluginHost(config, { editor, getCurrentFile: () => null, openFile: () => true });
      const { contributions } = useCorePlugins(h.host);
      hostRef = h.host;
      return createElement(CorePluginSidePanels, { panels: contributions.sidebarPanels, open: h.openPanels, onClose: h.togglePanel });
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(createElement(Harness)));
    await act(async () => void (await hostRef!.registry.setEnabled("p", true)));
    expect(el.querySelector("[data-core-panel]")).toBeNull();

    await act(async () => api.ui.toggleSidebarPanel("side"));
    expect(el.querySelector('[data-core-panel="p:side"]')?.textContent).toContain("panel body");
    await act(async () => el.querySelector<HTMLButtonElement>(".core-panel-close")!.click());
    expect(el.querySelector("[data-core-panel]")).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);

    await act(async () => api.ui.toggleSidebarPanel("side"));
    await act(async () => void (await hostRef!.registry.setEnabled("p", false)));
    expect(el.querySelector("[data-core-panel]")).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    el.remove();
  });

  it("stores attachments through the adapter under a plain file name", async () => {
    const adapter = new MemoryVaultAdapter();
    let api!: PluginApi;
    const { host } = makeHost([def("a", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("a", true);
    const target = await api.vault.saveAttachment("../evil/rec:1.webm", new Blob(["x"], { type: "audio/webm" }));
    // Separators and reserved characters become "_", leading dots go: the name can never leave attachments/.
    expect(target).toBe("attachments/_evil_rec_1.webm");
    expect(adapter.attachments.has(target)).toBe(true);
  });
});

describe("attachment viewers and attachment data (2.5c)", () => {
  it("finds the first matching viewer, a throwing match counts as no, off means gone; mounts and closes", async () => {
    const close = vi.fn();
    const cleanup = vi.fn();
    const plugin: CorePlugin = {
      onload: (api) => {
        api.ui.registerAttachmentViewer({ id: "bad", match: () => { throw new Error("boom"); }, mount: () => {} });
        api.ui.registerAttachmentViewer({
          id: "pdf",
          match: (f) => f.name.endsWith(".pdf"),
          mount: (el, ctx) => {
            el.textContent = `viewing ${ctx.name}`;
            el.onclick = () => ctx.close();
            return cleanup;
          },
        });
      },
    };
    const { host } = makeHost([def("p", plugin)]);
    await host.registry.setEnabled("p", true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const viewer = matchAttachmentViewer(host.getContributions().attachmentViewers, { target: "t", name: "a.pdf" })!;
    errSpy.mockRestore();
    expect(viewer.key).toBe("p:pdf");
    expect(matchAttachmentViewer(host.getContributions().attachmentViewers, { target: "t", name: "a.png" })).toBeUndefined();

    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(createElement(CorePluginAttachmentViewer, { viewer, target: "t", name: "a.pdf", onClose: close })));
    expect(el.textContent).toBe("viewing a.pdf");
    (el.querySelector('[data-core-attachment-viewer] > div') as HTMLElement).click();
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(cleanup).toHaveBeenCalledOnce();

    await host.registry.setEnabled("p", false);
    expect(host.getContributions().attachmentViewers).toEqual([]);
  });

  it("reads attachment bytes and keeps data with an attachment through the adapter", async () => {
    const adapter = new MemoryVaultAdapter();
    const target = await adapter.saveAttachment("doc.pdf", new Blob(["%PDF"]));
    let api!: PluginApi;
    const { host } = makeHost([def("p", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("p", true);
    expect(new TextDecoder().decode((await api.vault.readAttachment(target))!)).toBe("%PDF");
    expect(await api.vault.readAttachment("nope")).toBeNull();
    expect(await api.vault.getAttachmentData(target)).toBeNull();
    await api.vault.setAttachmentData(target, [{ id: "a" }]);
    expect(await api.vault.getAttachmentData(target)).toEqual([{ id: "a" }]);
  });
});

describe("references, attachments and non-note files (2.5b)", () => {
  it("resolves a vault path, an adapter id and a Windows-style id to the note's vault path", async () => {
    const adapter = new MemoryVaultAdapter({ "Notes/a.md": "A" });
    // Desktop-like ids: absolute paths. The memory adapter's ids are vault paths, so wrap listNotes.
    const listNotes = adapter.listNotes.bind(adapter);
    adapter.listNotes = async () => (await listNotes()).map((n) => ({ ...n, id: `C:\\vault\\${n.path.replace(/\//g, "\\")}` }));
    adapter.readNote = async () => "A";
    let api!: PluginApi;
    const { host } = makeHost([def("c", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("c", true);
    expect(await api.vault.resolve("Notes/a.md")).toBe("Notes/a.md");
    expect(await api.vault.resolve("C:\\vault\\Notes\\a.md")).toBe("Notes/a.md");
    expect(await api.vault.resolve("C:/vault/Notes/a.md")).toBe("Notes/a.md");
    expect(await api.vault.resolve("missing")).toBeNull();
  });

  it("lists attachments and gives display URLs through the adapter", async () => {
    const adapter = new MemoryVaultAdapter();
    await adapter.saveAttachment("pic.png", new Blob(["x"]));
    let api!: PluginApi;
    const { host } = makeHost([def("c", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("c", true);
    expect(await api.vault.listAttachments()).toEqual([{ target: "attachments/pic.png", name: "pic.png" }]);
    expect(await api.vault.attachmentUrl("attachments/pic.png")).toBe("memory://attachments/pic.png");
    expect(await api.vault.attachmentUrl("")).toBeNull();
  });

  it("exists also sees files that are not notes (a .canvas) when the adapter can tell", async () => {
    const adapter = new MemoryVaultAdapter({ "a.md": "A" });
    adapter.files.add("Board.canvas");
    let api!: PluginApi;
    const { host } = makeHost([def("c", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("c", true);
    expect(await api.vault.exists("a.md")).toBe(true);
    expect(await api.vault.exists("Board.canvas")).toBe(true);
    expect(await api.vault.exists("Other.canvas")).toBe(false);
  });
});

describe("note toolbar buttons, history and read-only rendering", () => {
  it("collects note toolbar buttons, renders them and drops them when the plugin is turned off", async () => {
    const onClick = vi.fn();
    const plugin: CorePlugin = {
      onload: (api) => {
        api.ui.addNoteToolbarButton({ id: "present", title: "Present", icon: "P", onClick });
        api.ui.addNoteToolbarButton({ id: "tmp", title: "Tmp", icon: "T", onClick });
        api.ui.removeNoteToolbarButton("tmp");
      },
    };
    const { host } = makeHost([def("s", plugin)]);
    await host.registry.setEnabled("s", true);
    expect(host.getContributions().noteToolbarButtons.map((b) => b.key)).toEqual(["s:present"]);

    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(createElement(CorePluginNoteToolbarButtons, { buttons: host.getContributions().noteToolbarButtons })));
    await act(async () => el.querySelector<HTMLButtonElement>('[data-core-note-button="s:present"]')!.click());
    expect(onClick).toHaveBeenCalledOnce();
    await act(async () => root.unmount());

    await host.registry.setEnabled("s", false);
    expect(host.getContributions().noteToolbarButtons).toEqual([]);
  });

  it("reads snapshots and commits of a note by path through the adapter", async () => {
    const adapter = new MemoryVaultAdapter({ "n.md": "now" });
    adapter.snapshots.set("n.md", [{ id: "s1", timestamp: 5, size: 3, content: "then" }]);
    let api!: PluginApi;
    const { host } = makeHost([def("h", { onload: (a) => void (api = a) })], { adapter });
    await host.registry.setEnabled("h", true);
    expect(await api.vault.versionSources()).toEqual({ snapshots: true, git: false });
    expect(await api.vault.snapshots("n.md")).toEqual([{ id: "s1", timestamp: 5, size: 3 }]);
    expect(await api.vault.readSnapshot("n.md", "s1")).toBe("then");
    expect(await api.vault.snapshots("missing.md")).toEqual([]);

    adapter.commits.set("n.md", [{ hash: "abc", author: "a", date: "2026-10-16", message: "m", content: "old" }]);
    expect((await api.vault.versionSources()).git).toBe(true);
    expect(await api.vault.gitLog("n.md")).toEqual([{ hash: "abc", author: "a", date: "2026-10-16", message: "m" }]);
    expect(await api.vault.readAtCommit("n.md", "abc")).toBe("old");
  });

  it("without history methods in the adapter there is simply no history", async () => {
    const adapter = new MemoryVaultAdapter({ "n.md": "now" });
    const bare = Object.assign(Object.create(Object.getPrototypeOf(adapter)), adapter, {
      historySources: undefined,
      noteSnapshots: undefined,
      noteGitLog: undefined,
    });
    let api!: PluginApi;
    const { host } = makeHost([def("h", { onload: (a) => void (api = a) })], { adapter: bare });
    await host.registry.setEnabled("h", true);
    expect(await api.vault.versionSources()).toEqual({ snapshots: false, git: false });
    expect(await api.vault.snapshots("n.md")).toEqual([]);
    expect(await api.vault.gitLog("n.md")).toEqual([]);
  });

  it("renders markdown read-only as plain text when the app gives no renderer", async () => {
    let api!: PluginApi;
    const { host } = makeHost([def("r", { onload: (a) => void (api = a) })]);
    await host.registry.setEnabled("r", true);
    const el = document.createElement("div");
    const cleanup = api.markdown.renderReadOnly("# Title", el);
    expect(el.textContent).toBe("# Title");
    cleanup();
    expect(el.textContent).toBe("");
  });
});

describe("file views (registerFileView + CorePluginFileView)", () => {
  it("finds the first matching view in registration order; a throwing match counts as no; off means gone", async () => {
    const plugin: CorePlugin = {
      onload: (api) => {
        api.ui.registerFileView({ id: "broken", match: () => { throw new Error("boom"); }, mount: () => {} });
        api.ui.registerFileView({ id: "board", match: (f) => f.path.endsWith(".board.md"), mount: () => {} });
        api.ui.registerFileView({ id: "any", match: () => true, mount: () => {} });
      },
    };
    const { host } = makeHost([def("b", plugin)]);
    await host.registry.setEnabled("b", true);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(host.findFileView("x.board.md", "")?.key).toBe("b:board");
    expect(matchFileView(host.getContributions().fileViews, "note.md", "")?.key).toBe("b:any");
    errSpy.mockRestore();
    await host.registry.setEnabled("b", false);
    expect(host.findFileView("x.board.md", "")).toBeUndefined();
  });

  it("mounts once per file, sends outside changes through update but not its own writes, and cleans up", async () => {
    const update = vi.fn();
    const destroy = vi.fn();
    let ctx!: FileViewContext;
    const plugin: CorePlugin = {
      onload: (api) =>
        api.ui.registerFileView({
          id: "v",
          match: () => true,
          mount: (el, c) => {
            ctx = c;
            el.textContent = `view of ${c.path}`;
            return { update, destroy };
          },
        }),
    };
    const { host } = makeHost([def("f", plugin)]);
    await host.registry.setEnabled("f", true);
    const view = host.findFileView("a.md", "one")!;

    const onChange = vi.fn();
    const el = document.createElement("div");
    const root = createRoot(el);
    const render = (path: string, content: string) =>
      act(async () => root.render(createElement(CorePluginFileView, { key: path, view, path, content, onChange })));
    await render("a.md", "one");
    expect(el.textContent).toBe("view of a.md");
    expect(ctx.content).toBe("one");

    // The view's own write reaches the app, and coming back as the new content is not echoed to it.
    act(() => ctx.setContent("two"));
    expect(onChange).toHaveBeenCalledWith("two");
    await render("a.md", "two");
    expect(update).not.toHaveBeenCalled();

    // A change from elsewhere is.
    await render("a.md", "three");
    expect(update).toHaveBeenCalledWith("three");

    // Another file: the old instance is destroyed, a new one mounted.
    await render("b.md", "x");
    expect(destroy).toHaveBeenCalledOnce();
    expect(el.textContent).toBe("view of b.md");
    await act(async () => root.unmount());
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});

describe("plugin hotkeys", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

  it("matches Mod per platform and uses the physical key", () => {
    expect(matchesHotkey(key({ ctrlKey: true, altKey: true, code: "KeyW", key: "w" }), "Mod+Alt+W", false)).toBe(true);
    expect(matchesHotkey(key({ metaKey: true, altKey: true, code: "KeyW", key: "∑" }), "Mod+Alt+W", true)).toBe(true);
    expect(matchesHotkey(key({ ctrlKey: true, code: "KeyW", key: "w" }), "Mod+Alt+W", false)).toBe(false);
    expect(matchesHotkey(key({ ctrlKey: true, shiftKey: true, altKey: true, code: "KeyW", key: "W" }), "Mod+Alt+W", false)).toBe(false);
  });

  it("runs a command unless the app already handled the key", async () => {
    const run = vi.fn();
    const commands = [{ pluginId: "p", key: "p:c", id: "c", name: "C", hotkey: "Ctrl+Alt+W", run }];
    function Harness() {
      useCorePluginHotkeys(commands);
      return null;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(createElement(Harness)));
    window.dispatchEvent(key({ ctrlKey: true, altKey: true, code: "KeyW", key: "w" }));
    await new Promise((r) => setTimeout(r, 5));
    expect(run).toHaveBeenCalledOnce();
    const handled = key({ ctrlKey: true, altKey: true, code: "KeyW", key: "w" });
    handled.preventDefault();
    window.dispatchEvent(handled);
    await new Promise((r) => setTimeout(r, 5));
    expect(run).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("takes the key from the browser (Ctrl+D bookmark) when it runs, after the app's own listeners", () => {
    const run = vi.fn();
    const commands = [{ pluginId: "p", key: "p:d", id: "d", name: "Today", hotkey: "Ctrl+D", run }];
    function Harness() {
      useCorePluginHotkeys(commands);
      return null;
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(createElement(Harness)));
    // An app listener on window added after the plugin hook: it must still run first.
    const order: string[] = [];
    const appListener = () => order.push("app");
    window.addEventListener("keydown", appListener);
    run.mockImplementation(() => order.push("plugin"));
    const ev = key({ ctrlKey: true, code: "KeyD", key: "d" });
    el.dispatchEvent(ev);
    expect(order).toEqual(["app", "plugin"]);
    expect(ev.defaultPrevented).toBe(true);
    window.removeEventListener("keydown", appListener);
    act(() => root.unmount());
    el.remove();
  });

  it("wins over the editor's own keymap (CodeMirror skips prevented keys) but not over an app listener that claims it", () => {
    const run = vi.fn();
    const commands = [{ pluginId: "p", key: "p:g", id: "g", name: "Graph", hotkey: "Ctrl+G", run }];
    function Harness() {
      useCorePluginHotkeys(commands);
      return null;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(Harness)));
    // Stand-in for CodeMirror's content element: handles Mod-g (find next) unless the event is already prevented.
    const editorEl = document.createElement("div");
    document.body.appendChild(editorEl);
    const editorFindNext = vi.fn();
    editorEl.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      editorFindNext();
      e.preventDefault();
    });
    editorEl.dispatchEvent(key({ ctrlKey: true, code: "KeyG", key: "g" }));
    expect(editorFindNext).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();

    const claim = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", claim);
    editorEl.dispatchEvent(key({ ctrlKey: true, code: "KeyG", key: "g" }));
    expect(run).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", claim);

    act(() => root.unmount());
    host.remove();
    editorEl.remove();
  });
});
