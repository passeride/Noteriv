import { act } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@noteriv/plugin-api";
import { cleanFolder, createUniqueNote, uniqueName } from "../src/unique-note";
import { FootnotesPanel, type FootnotesLabels } from "../src/footnotes/FootnotesPanel";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("unique note creator", () => {
  const at = new Date(2026, 9, 23, 14, 30, 5);

  it("names a note by the time, with the default or a chosen format", () => {
    expect(uniqueName(at, "YYYYMMDDHHmm")).toBe("202610231430");
    expect(uniqueName(at, "YYYY-MM-DD HHmmss note")).toBe("2026-10-23 143005 note");
    expect(uniqueName(at, "")).toBe("202610231430");
    // Characters a file name or a link cannot hold are dropped.
    expect(uniqueName(at, "YYYY/MM:DD#")).toBe("20261023");
  });

  it("cleans the folder setting into a vault path", () => {
    expect(cleanFolder(" /Zettel//inbox/ ")).toBe("Zettel/inbox");
    expect(cleanFolder("..\\x\\.")).toBe("x");
    expect(cleanFolder("")).toBe("");
    // Windows: no trailing dots or spaces, no drive colon, no device names.
    expect(cleanFolder("notes. /C:/con")).toBe("notes/C/con_");
  });

  it("keeps [bracketed] text as is and makes names Windows accepts", () => {
    expect(uniqueName(at, "YYYYMMDD [Summary]")).toBe("20261023 Summary");
    expect(uniqueName(at, "[NUL]")).toBe("NUL_");
    expect(uniqueName(at, "YYYY...")).toBe("2026");
  });

  it("creates the note in the folder, numbered when the name is taken, and opens it", async () => {
    const files = new Set(["Zettel/202610231430.md"]);
    const api = {
      settings: { load: async () => ({ folder: "Zettel/", format: "YYYYMMDDHHmm" }) },
      vault: { exists: async (p: string) => files.has(p), write: vi.fn(async (p: string) => void files.add(p)) },
      workspace: { openFile: vi.fn(async () => true) },
    } as unknown as PluginApi;
    expect(await createUniqueNote(api, at)).toBe("Zettel/202610231430 2.md");
    expect(api.workspace.openFile).toHaveBeenCalledWith("Zettel/202610231430 2.md");
  });
});

describe("footnotes panel", () => {
  const labels: FootnotesLabels = {
    noNote: "No note",
    none: "None",
    count: (n) => `${n} footnotes`,
    inline: "inline",
    noDefinition: "No definition",
    unused: "Not referred to",
    goToRef: (n) => `Reference ${n}`,
  };

  function mount(content: string | null) {
    const handlers = new Map<string, (x?: unknown) => void>();
    const setCursor = vi.fn();
    const api = {
      editor: { getContent: () => content, setCursor },
      events: { on: (e: string, h: (x?: unknown) => void) => handlers.set(e, h), off: () => {} },
    } as unknown as PluginApi;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(FootnotesPanel, { api, labels })));
    return { host, root, setCursor, handlers };
  }

  it("lists the footnotes, goes to a definition or a reference, and follows edits", () => {
    const { host, root, setCursor, handlers } = mount("A[^1] B[^1] C[^x].\n\n[^1]: One.\n[^spare]: Two.");
    expect(host.querySelector(".fn-count")?.textContent).toBe("3 footnotes");
    const items = [...host.querySelectorAll(".fn-item")].map((li) => li.textContent);
    expect(items).toEqual(["1One.↑1↑2", "xNo definition↑", "spareTwo.Not referred to"]);
    act(() => host.querySelector<HTMLButtonElement>(".fn-main")!.click());
    expect(setCursor).toHaveBeenLastCalledWith({ line: 2, ch: 0 });
    act(() => host.querySelectorAll<HTMLButtonElement>(".fn-ref")[1].click());
    expect(setCursor).toHaveBeenLastCalledWith({ line: 0, ch: 7 });

    act(() => handlers.get("editor-change")!("No notes here."));
    expect(host.textContent).toBe("None");
    act(() => root.unmount());
  });

  it("says when no note is open", () => {
    const { host, root } = mount(null);
    expect(host.textContent).toBe("No note");
    act(() => root.unmount());
  });
});
