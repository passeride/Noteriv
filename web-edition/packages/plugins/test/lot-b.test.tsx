import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { platformI18n } from "./i18n";
import type { PluginApi, ViewFactory } from "@noteriv/plugin-api";
import graph, { loadLinkGraph, VIEW_TYPE as GRAPH_VIEW } from "../src/graph";
import slides, { VIEW_TYPE as SLIDES_VIEW } from "../src/slides";
import noteHistory, { GIT_VIEW, SCRUBBER_VIEW } from "../src/note-history";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const NOTES: Record<string, string> = {
  "A.md": "links to [[B]] and [[Nowhere]]",
  "sub/B.md": "back to [[A]]",
  "C.md": "alone",
};

function fakeApi(opts: { content?: string | null; git?: boolean; platform?: "web" | "desktop" } = {}) {
  const { content = "one\ntwo", git = false, platform = "web" } = opts;
  const views = new Map<string, ViewFactory>();
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const api = {
    app: { platform, vaultPath: null, currentFile: content === null ? null : "A.md" },
    i18n: platformI18n(platform),
    vault: {
      list: async (dir?: string) => {
        const base = dir ? `${dir}/` : "";
        const out = new Map<string, { path: string; name: string; isDir: boolean }>();
        for (const p of Object.keys(NOTES)) {
          if (!p.startsWith(base)) continue;
          const rest = p.slice(base.length);
          const i = rest.indexOf("/");
          const name = i < 0 ? rest : rest.slice(0, i);
          out.set(name, { path: base + name, name, isDir: i >= 0 });
        }
        return [...out.values()];
      },
      read: async (p: string) => NOTES[p] ?? null,
      versionSources: vi.fn(async () => ({ snapshots: true, git })),
      snapshots: vi.fn(async () => [
        { id: "s2", timestamp: Date.now() - 60_000, size: 3 },
        { id: "s1", timestamp: Date.now() - 120_000, size: 3 },
      ]),
      readSnapshot: vi.fn(async (_p: string, id: string) => `snapshot ${id}`),
      gitLog: vi.fn(async () => [{ hash: "abcdef1234", author: "me", date: "2026-10-01T10:00:00Z", message: "first" }]),
      readAtCommit: vi.fn(async () => "one\nold"),
    },
    editor: { getContent: () => content, setContent: vi.fn() },
    markdown: { renderReadOnly: vi.fn(() => () => {}) },
    events: {
      on: (e: string, h: (...a: unknown[]) => void) => (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h),
      off: vi.fn(),
    },
    ui: {
      addCommand: vi.fn(),
      addRibbonIcon: vi.fn(),
      addNoteToolbarButton: vi.fn(),
      removeNoteToolbarButton: vi.fn(),
      showNotice: vi.fn(),
      registerView: vi.fn((type: string, f: ViewFactory) => void views.set(type, f)),
    },
    workspace: { openView: vi.fn(async () => true), closeView: vi.fn(), openFile: vi.fn(async () => true) },
  };
  return { api: api as unknown as PluginApi, raw: api, views, handlers };
}

/** Mounts a registered view the way the host does; returns the element and an unmount. */
async function mount(views: Map<string, ViewFactory>, type: string) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  let cleanup: void | (() => void);
  await act(async () => {
    cleanup = views.get(type)!().mount(el, { path: null });
  });
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return {
    el,
    async unmount() {
      await act(async () => {
        cleanup?.();
        await new Promise((r) => setTimeout(r, 5));
      });
      el.remove();
    },
  };
}

const key = (k: string) => act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

describe("graph", () => {
  it("builds nodes from every note (folders included) and edges between notes that link", async () => {
    const { api } = fakeApi();
    const g = await loadLinkGraph(api.vault);
    expect(g.notes.map((n) => n.path).sort()).toEqual(["A.md", "C.md", "sub/B.md"]);
    expect(g.edges).toEqual([{ source: "A.md", target: "sub/B.md", reciprocal: true }]);
    expect(g.connections.get("C.md")).toBeUndefined();
  });

  it("registers a Mod+G command, a ribbon button and a view that shows the counts", async () => {
    const { api, raw, views } = fakeApi();
    await graph.onload(api);
    const cmd = raw.ui.addCommand.mock.calls[0][0];
    expect(cmd.hotkey).toBe("Mod+G");
    cmd.callback();
    expect(raw.workspace.openView).toHaveBeenCalledWith(GRAPH_VIEW);
    expect(raw.ui.addRibbonIcon).toHaveBeenCalledOnce();
    const v = await mount(views, GRAPH_VIEW);
    expect(v.el.querySelector(".graph-stats")?.textContent).toContain("3note");
    expect(v.el.querySelector(".graph-stats")?.textContent).toContain("1liên kết");
    await v.unmount();
  });
});

describe("slides", () => {
  it("tells the user to open a note when none is open", async () => {
    const { api, raw } = fakeApi({ content: null });
    await slides.onload(api);
    raw.ui.addCommand.mock.calls[0][0].callback();
    expect(raw.ui.showNotice).toHaveBeenCalled();
    expect(raw.workspace.openView).not.toHaveBeenCalled();
  });

  it("presents the open note from the command, the ribbon or the note toolbar", async () => {
    const { api, raw, views } = fakeApi({ content: "# One\n\n---\n\n# Two" });
    await slides.onload(api);
    expect(raw.ui.addRibbonIcon).toHaveBeenCalledOnce();
    raw.ui.addNoteToolbarButton.mock.calls[0][0].onClick();
    expect(raw.workspace.openView).toHaveBeenCalledWith(SLIDES_VIEW);
    const v = await mount(views, SLIDES_VIEW);
    expect(v.el.querySelector(".slide-counter")?.textContent).toContain("1 / 2");
    await key("ArrowRight");
    expect(v.el.querySelector(".slide-counter")?.textContent).toContain("2 / 2");
    await v.unmount();
  });

  it("Escape closes the overview first, without reaching the host, then the presentation", async () => {
    const { api, raw, views } = fakeApi({ content: "# One\n\n---\n\n# Two" });
    await slides.onload(api);
    raw.ui.addCommand.mock.calls[0][0].callback();
    const v = await mount(views, SLIDES_VIEW);
    const hostEscape = vi.fn();
    window.addEventListener("keydown", hostEscape);
    await key("o");
    expect(v.el.querySelector(".slide-overview-overlay")).not.toBeNull();
    await key("Escape");
    expect(v.el.querySelector(".slide-overview-overlay")).toBeNull();
    expect(raw.workspace.closeView).not.toHaveBeenCalled();
    expect(hostEscape).not.toHaveBeenCalled();
    await key("Escape");
    expect(raw.workspace.closeView).toHaveBeenCalled();
    window.removeEventListener("keydown", hostEscape);
    await v.unmount();
  });
});

describe("note history", () => {
  it("registers both commands, the scrubber hotkey and toolbar buttons; the git button only with git history", async () => {
    const withoutGit = fakeApi();
    await noteHistory.onload(withoutGit.api);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(withoutGit.raw.ui.addCommand.mock.calls.map((c) => c[0].id)).toEqual(["git", "scrubber"]);
    expect(withoutGit.raw.ui.addCommand.mock.calls[1][0].hotkey).toBe("Mod+Shift+H");
    expect(withoutGit.raw.ui.addNoteToolbarButton.mock.calls.map((c) => c[0].id)).toEqual(["scrubber"]);

    const withGit = fakeApi({ git: true });
    await noteHistory.onload(withGit.api);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(withGit.raw.ui.addNoteToolbarButton.mock.calls.map((c) => c[0].id)).toEqual(["scrubber", "git"]);
  });

  it("git view: diff from the chosen commit to now, restore writes it into the editor", async () => {
    const { api, raw, views } = fakeApi({ git: true });
    await noteHistory.onload(api);
    raw.ui.addCommand.mock.calls[0][0].callback();
    expect(raw.workspace.openView).toHaveBeenCalledWith(GIT_VIEW);
    const v = await mount(views, GIT_VIEW);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(raw.vault.gitLog).toHaveBeenCalledWith("A.md");
    expect(v.el.querySelector(".nh-stat-add")?.textContent).toBe("+1");
    expect(v.el.querySelector(".nh-stat-remove")?.textContent).toBe("-1");
    await act(async () => v.el.querySelector<HTMLButtonElement>(".nh-restore-btn")!.click());
    expect(raw.editor.setContent).toHaveBeenCalledWith("one\nold");
    expect(raw.workspace.closeView).toHaveBeenCalled();
    await v.unmount();
  });

  it("scrubber: starts on now, steps back through snapshots oldest-first and restores one", async () => {
    const { api, raw, views } = fakeApi();
    await noteHistory.onload(api);
    raw.ui.addCommand.mock.calls[1][0].callback();
    expect(raw.workspace.openView).toHaveBeenCalledWith(SCRUBBER_VIEW);
    const v = await mount(views, SCRUBBER_VIEW);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(raw.markdown.renderReadOnly).toHaveBeenLastCalledWith("one\ntwo", expect.any(HTMLElement));
    expect(v.el.textContent).toContain("3 / 3");
    await key("ArrowLeft");
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(raw.vault.readSnapshot).toHaveBeenLastCalledWith("A.md", "s2");
    expect(raw.markdown.renderReadOnly).toHaveBeenLastCalledWith("snapshot s2", expect.any(HTMLElement));
    await act(async () => v.el.querySelector<HTMLButtonElement>("[data-scrubber-restore]")!.click());
    expect(raw.editor.setContent).toHaveBeenCalledWith("snapshot s2");
    await v.unmount();
  });
});
