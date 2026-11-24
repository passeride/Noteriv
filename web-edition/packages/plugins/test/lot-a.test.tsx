import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { platformI18n } from "./i18n";
import type { PluginApi, VaultEntry } from "@noteriv/plugin-api";
import calendar, { collectCalendarData, openDailyNote, VIEW_TYPE as CALENDAR_VIEW } from "../src/calendar";
import templates, { freeNotePath, getTemplateVariables, processTemplate, VIEW_TYPES } from "../src/templates";
import noteComposer, { mergeNotes, sectionPath, splitByHeadings } from "../src/note-composer";
import vaultInsights, { computeDailyStreak, computeVaultInsights } from "../src/vault-insights";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** A small in-memory vault behind the parts of PluginApi these plugins use. */
function fakeApi(files: Record<string, string>, opts: { platform?: "web" | "desktop"; currentFile?: string | null; content?: string | null } = {}) {
  const notes = new Map(Object.entries(files));
  let editorContent = opts.content ?? null;
  const list = async (dir = ""): Promise<VaultEntry[]> => {
    const prefix = dir ? `${dir}/` : "";
    const out = new Map<string, VaultEntry>();
    for (const p of notes.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const i = rest.indexOf("/");
      const entry = i < 0 ? { path: p, name: rest, isDir: false } : { path: prefix + rest.slice(0, i), name: rest.slice(0, i), isDir: true };
      out.set(entry.path, entry);
    }
    return [...out.values()];
  };
  const api = {
    app: { platform: opts.platform ?? "web", vaultPath: null, currentFile: opts.currentFile ?? null },
    i18n: platformI18n(opts.platform ?? "web"),
    vault: {
      list,
      read: async (p: string) => notes.get(p) ?? null,
      exists: async (p: string) => notes.has(p),
      write: vi.fn(async (p: string, c: string) => {
        notes.set(p, c);
        return true;
      }),
      delete: vi.fn(async (p: string) => notes.delete(p)),
      stats: async () => ({}),
    },
    editor: {
      getContent: () => editorContent,
      setContent: (c: string) => void (editorContent = c),
      insertAtCursor: vi.fn(),
    },
    ui: { registerView: vi.fn(), addCommand: vi.fn(), addRibbonIcon: vi.fn(), showNotice: vi.fn() },
    workspace: { openFile: vi.fn(async () => true), openView: vi.fn(async () => true), closeView: vi.fn() },
  };
  return { api: api as unknown as PluginApi, raw: api, notes, editor: () => editorContent };
}

describe("calendar", () => {
  it("collects daily notes, due tasks and frontmatter due dates", () => {
    const data = collectCalendarData([
      { path: "Daily/2026-10-16.md", content: "# 2026-10-16\n- [ ] call @due(2026-10-20)" },
      { path: "Project.md", content: "---\ndue: 2026-10-20\n---\n- [x] done @due(2026-10-18)" },
    ]);
    expect(data.daily.get("2026-10-16")).toBe("Daily/2026-10-16.md");
    expect(data.tasksByDate.get("2026-10-20")).toBe(2);
    expect(data.tasksByDate.get("2026-10-18")).toBe(1);
    expect(data.dueTasks.map((t) => t.text)).toEqual(["call", "done"]);
  });

  it("opens today's note, creating it with a heading only when missing", async () => {
    const { api, raw, notes } = fakeApi({ "Daily/2026-10-15.md": "kept" });
    await openDailyNote(api, "2026-10-16");
    expect(notes.get("Daily/2026-10-16.md")).toBe("# 2026-10-16\n\n");
    await openDailyNote(api, "2026-10-15");
    expect(notes.get("Daily/2026-10-15.md")).toBe("kept");
    expect(raw.vault.write).toHaveBeenCalledTimes(1);
    expect(raw.workspace.openFile).toHaveBeenLastCalledWith("Daily/2026-10-15.md");
  });

  it("registers the calendar view, two commands (Mod+D for today) and two ribbon buttons", async () => {
    const { api, raw } = fakeApi({});
    await calendar.onload(api);
    expect(raw.ui.registerView).toHaveBeenCalledWith(CALENDAR_VIEW, expect.any(Function));
    expect(raw.ui.addCommand.mock.calls.map((c) => [c[0].id, c[0].hotkey])).toEqual([["open", undefined], ["today", "Mod+D"]]);
    expect(raw.ui.addRibbonIcon).toHaveBeenCalledTimes(2);
  });

  it("mounts the React view into the host container and unmounts it", async () => {
    const { api, raw } = fakeApi({ "Daily/2026-10-16.md": "# day" }, { platform: "desktop" });
    await calendar.onload(api);
    const factory = raw.ui.registerView.mock.calls[0][1] as () => { mount(el: HTMLElement, s: { path: null }): () => void };
    const el = document.createElement("div");
    document.body.appendChild(el);
    let cleanup!: () => void;
    await act(async () => {
      cleanup = factory().mount(el, { path: null });
    });
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(el.querySelector("[data-calendar-view]")).not.toBeNull();
    expect(el.textContent).toContain("Today");
    // reactView defers the unmount by one task (closing usually starts inside the view's own click handler).
    await act(async () => {
      cleanup();
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(el.childElementCount).toBe(0);
    el.remove();
  });
});

describe("templates", () => {
  it("fills variables case-insensitively and leaves unknown ones", () => {
    const vars = getTemplateVariables("Ván 1", new Date(2026, 9, 16, 9, 5));
    expect(processTemplate("# {{Title}} {{date}} {{ time }} {{weekday}} {{nope}}", vars)).toBe("# Ván 1 2026-10-16 09:05 Friday {{nope}}");
  });

  it("picks the first free name so a second note from the same template does not collide", async () => {
    const taken = new Set(["Meeting.md", "Meeting 1.md"]);
    expect(await freeNotePath("Meeting", async (p) => taken.has(p))).toBe("Meeting 2.md");
    expect(await freeNotePath("Other", async (p) => taken.has(p))).toBe("Other.md");
  });

  it("offers both create and insert on every platform; desktop keeps Ctrl+T", async () => {
    for (const platform of ["web", "desktop"] as const) {
      const { api, raw } = fakeApi({}, { platform });
      await templates.onload(api);
      expect(raw.ui.registerView.mock.calls.map((c) => c[0])).toEqual([VIEW_TYPES.create, VIEW_TYPES.insert]);
      const insert = raw.ui.addCommand.mock.calls.find((c) => c[0].id === "insert")![0];
      expect(insert.hotkey).toBe(platform === "desktop" ? "Mod+T" : "Mod+Alt+T");
    }
  });
});

describe("note composer", () => {
  it("merges with headings and splits by heading level", () => {
    expect(mergeNotes([{ name: "a.md", content: "A\n" }, { name: "b.md", content: "B" }], true)).toBe("## a\n\nA\n\n## b\n\nB\n");
    const sections = splitByHeadings("intro\n## One\n1\n### deep\n## Two\n2", 2);
    expect(sections.map((s) => s.title)).toEqual(["Preamble", "One", "Two"]);
    expect(sectionPath("Openings", "Sicilian: Najdorf?")).toBe("Openings/Sicilian-Najdorf.md");
    expect(sectionPath("", "Root")).toBe("Root.md");
  });

  it("registers one command and its view", async () => {
    const { api, raw } = fakeApi({});
    await noteComposer.onload(api);
    expect(raw.ui.registerView).toHaveBeenCalledOnce();
    expect(raw.ui.addCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "open" }));
  });
});

describe("vault insights", () => {
  const now = new Date(2026, 9, 16, 12);
  const day = (d: number) => new Date(2026, 9, d, 10).getTime();

  it("computes links, orphans, tags, words and uses dates only when known", () => {
    const data = computeVaultInsights(
      [
        { path: "a.md", content: "---\nx: 1\n---\nlinks [[b]] #chess" },
        { path: "b.md", content: "back to [[a]]" },
        { path: "c.md", content: "alone" },
      ],
      { "a.md": { createdAt: day(1), modifiedAt: day(16) }, "b.md": { createdAt: day(2), modifiedAt: day(16) } },
      now
    );
    expect(data.totalNotes).toBe(3);
    expect(data.totalLinks).toBe(2);
    expect(data.orphanNotes.map((n) => n.path)).toEqual(["c.md"]);
    expect(data.hubNotes.map((n) => n.name).sort()).toEqual(["a", "b"]);
    expect(data.tagDistribution).toEqual([{ tag: "#chess", count: 1 }]);
    expect(data.heatmap.at(-1)).toMatchObject({ date: "2026-10-16", count: 2 });
    expect(data.growthOverTime).toEqual([{ month: "2026-10", label: "Oct 2026", cumulative: 2 }]);
    expect(data.undated).toBe(1);
    expect(data.vaultHealth.withBacklinks).toBe(67);
  });

  it("resolves links as the graph does: headings, blocks, paths and same-named notes in other folders", () => {
    const data = computeVaultInsights(
      [
        { path: "a.md", content: "[[b#Plan]] [[c^x1]] [[Imported/Home|home]]" },
        { path: "b.md", content: "" },
        { path: "c.md", content: "" },
        { path: "Imported/Home.md", content: "[[Note]]" },
        { path: "Imported/Note.md", content: "" },
        { path: "Other/Note.md", content: "" },
      ],
      {},
      now
    );
    expect(data.totalLinks).toBe(4);
    expect(data.orphanNotes.map((n) => n.path)).toEqual(["Other/Note.md"]);
  });

  it("counts the daily-note streak up to yesterday or today", () => {
    expect(computeDailyStreak(["2026-10-13.md", "2026-10-14.md", "2026-10-15.md", "x.md"], now)).toEqual({ current: 3, longest: 3, lastDate: "2026-10-15" });
    expect(computeDailyStreak(["2026-10-01.md"], now).current).toBe(0);
  });

  it("registers its view, a command and a ribbon button", async () => {
    const { api, raw } = fakeApi({});
    await vaultInsights.onload(api);
    expect(raw.ui.registerView).toHaveBeenCalledOnce();
    expect(raw.ui.addCommand).toHaveBeenCalledOnce();
    expect(raw.ui.addRibbonIcon).toHaveBeenCalledOnce();
  });
});
