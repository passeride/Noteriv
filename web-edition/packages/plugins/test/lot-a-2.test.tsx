import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { platformI18n } from "./i18n";
import type { PluginApi } from "@noteriv/plugin-api";
import { lintMarkdown } from "@noteriv/core/markdown-lint";
import markdownLint, { groupWarnings, PANEL_ID } from "../src/markdown-lint";
import audioRecorder, { audioMarkdown, formatDuration, generateRecordingFilename, saveErrorMessage, VIEW_TYPE } from "../src/audio-recorder";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function fakeApi(content: string | null, platform: "web" | "desktop" = "web") {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const api = {
    app: { platform, vaultPath: null, currentFile: content === null ? null : "a.md" },
    i18n: platformI18n(platform),
    vault: { list: async () => [{ path: "Other.md", name: "Other.md", isDir: false }] },
    editor: { getContent: () => content, setCursor: vi.fn() },
    events: {
      on: (e: string, h: (...a: unknown[]) => void) => (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h),
      off: (e: string, h: (...a: unknown[]) => void) => handlers.get(e)?.delete(h),
    },
    ui: { addSidebarPanel: vi.fn(), addCommand: vi.fn(), addRibbonIcon: vi.fn(), registerView: vi.fn(), toggleSidebarPanel: vi.fn() },
    workspace: { openView: vi.fn() },
  };
  return { api: api as unknown as PluginApi, raw: api, handlers };
}

describe("markdown lint", () => {
  it("groups the core lint warnings by severity", () => {
    const g = groupWarnings(lintMarkdown("# A\n#### skipped level\n[[Missing]]", "", ["Other"]));
    expect(g.errors.length + g.warns.length + g.infos.length).toBeGreaterThan(0);
    expect([...g.errors, ...g.warns, ...g.infos].every((w) => ["error", "warning", "info"].includes(w.type))).toBe(true);
  });

  it("registers a sidebar panel and a Mod+Shift+L command that toggles it", async () => {
    const { api, raw } = fakeApi("x");
    await markdownLint.onload(api);
    expect(raw.ui.addSidebarPanel).toHaveBeenCalledWith(expect.objectContaining({ id: PANEL_ID, title: "Lint" }));
    const cmd = raw.ui.addCommand.mock.calls[0][0];
    expect(cmd.hotkey).toBe("Mod+Shift+L");
    cmd.callback();
    expect(raw.ui.toggleSidebarPanel).toHaveBeenCalledWith(PANEL_ID);
  });

  it("renders the open note's problems and jumps to the line on click (0-based for the editor)", async () => {
    const { api, raw } = fakeApi("# Title\n\nSee [[Nowhere]] here", "desktop");
    await markdownLint.onload(api);
    const panel = raw.ui.addSidebarPanel.mock.calls[0][0] as { render(el: HTMLElement): () => void };
    const el = document.createElement("div");
    document.body.appendChild(el);
    let cleanup!: () => void;
    await act(async () => {
      cleanup = panel.render(el);
    });
    await act(async () => new Promise((r) => setTimeout(r, 700)));
    const item = el.querySelector<HTMLButtonElement>(".lint-item");
    expect(item).not.toBeNull();
    const line = Number(item!.querySelector(".lint-line")!.textContent!.slice(1));
    await act(async () => item!.click());
    expect(raw.editor.setCursor).toHaveBeenCalledWith(expect.objectContaining({ line: line - 1 }));
    await act(async () => {
      cleanup();
      await new Promise((r) => setTimeout(r, 5));
    });
    el.remove();
  });

  it("says so when no note is open", async () => {
    const { api, raw } = fakeApi(null);
    await markdownLint.onload(api);
    const el = document.createElement("div");
    await act(async () => void (raw.ui.addSidebarPanel.mock.calls[0][0] as { render(el: HTMLElement): void }).render(el));
    expect(el.textContent).toContain("Chưa mở ghi chú");
  });
});

describe("audio recorder", () => {
  it("names recordings by local time and inserts them as before", () => {
    expect(generateRecordingFilename(new Date(2026, 9, 16, 9, 5, 7))).toBe("recording-2026-10-16-090507.webm");
    expect(formatDuration(75)).toBe("01:15");
    expect(audioMarkdown("attachments/r.webm")).toBe("![Audio](attachments/r.webm)");
    expect(saveErrorMessage({ body: { message: "Quota exceeded" } }, "x")).toBe("Quota exceeded");
    expect(saveErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });

  it("registers its view, a command and a ribbon button", async () => {
    const { api, raw } = fakeApi("x");
    await audioRecorder.onload(api);
    expect(raw.ui.registerView).toHaveBeenCalledWith(VIEW_TYPE, expect.any(Function));
    expect(raw.ui.addCommand).toHaveBeenCalledOnce();
    expect(raw.ui.addRibbonIcon).toHaveBeenCalledOnce();
  });
});
