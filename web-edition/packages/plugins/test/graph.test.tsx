import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import type { VaultApi } from "@noteriv/plugin-api";
import { GraphView, type GraphLabels } from "../src/graph/GraphView";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

const LABELS: GraphLabels = {
  filter: "Filter",
  close: "Close",
  zoomIn: "+",
  zoomOut: "-",
  building: "Building",
  notes: "notes",
  connections: "connections",
  connectionCount: (n) => `${n}`,
  oneWay: "one-way",
  reciprocal: "reciprocal",
  legend: "legend",
  allNotes: "All notes",
  thisNote: "This note",
  noNote: "Open a note first",
  depth: "Depth",
  colorByFolder: "Color by folder",
  rootFolder: "(root)",
};

// A → B → C → D, and E alone, in two folders.
const FILES: Record<string, string> = {
  "A.md": "[[B]]",
  "Work/B.md": "[[C#Plan]]",
  "Work/C.md": "[[D]]",
  "D.md": "",
  "E.md": "",
};

function fakeVault(): VaultApi {
  return {
    list: async (dir?: string) => {
      const prefix = dir ? `${dir}/` : "";
      const entries = new Map<string, boolean>();
      for (const p of Object.keys(FILES).filter((p) => p.startsWith(prefix))) {
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf("/");
        entries.set(prefix + (slash < 0 ? rest : rest.slice(0, slash)), slash >= 0);
      }
      return [...entries].map(([path, isDir]) => ({ path, name: path.split("/").pop()!, isDir }));
    },
    read: async (path: string) => FILES[path] ?? null,
  } as unknown as VaultApi;
}

async function mount(props: { currentPath: string | null; local?: boolean }) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(GraphView, { vault: fakeVault(), labels: LABELS, onClose: () => {}, onNoteSelect: () => {}, ...props }));
  });
  await wait(20);
  const stats = () => [...host.querySelectorAll(".graph-stat-value")].map((e) => e.textContent);
  const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>(".graph-scope-btn")].find((b) => b.textContent === name)!;
  return { host, root, stats, button };
}

describe("graph view: local graph", () => {
  it("opens on the open note's links when asked, and the depth widens it", async () => {
    const { host, stats, root } = await mount({ currentPath: "Work/B.md", local: true });
    // B, with A and C (links in either direction; a link to a heading counts).
    expect(stats()).toEqual(["3", "2"]);
    const select = host.querySelector<HTMLSelectElement>(".graph-depth select")!;
    await act(async () => {
      select.value = "2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(stats()).toEqual(["4", "3"]);
    act(() => root.unmount());
  });

  it("switches between all notes and this note; This note is off without an open note", async () => {
    const one = await mount({ currentPath: "D.md" });
    expect(one.stats()).toEqual(["5", "3"]);
    await act(async () => one.button("This note").click());
    expect(one.stats()).toEqual(["2", "1"]);
    await act(async () => one.button("All notes").click());
    expect(one.stats()).toEqual(["5", "3"]);
    act(() => one.root.unmount());

    const none = await mount({ currentPath: null, local: true });
    expect(none.button("This note").getAttribute("aria-disabled")).toBe("true");
    expect(none.stats()).toEqual(["5", "3"]);
    act(() => none.root.unmount());

    // A file that is not a note of the graph (a canvas): the whole vault, and This note off.
    const canvas = await mount({ currentPath: "Board.canvas", local: true });
    expect(canvas.button("This note").getAttribute("aria-disabled")).toBe("true");
    expect(canvas.stats()).toEqual(["5", "3"]);
    await act(async () => canvas.button("This note").click());
    expect(canvas.stats()).toEqual(["5", "3"]);
    act(() => canvas.root.unmount());
  });

  it("lists the folders with their colours when colouring by folder", async () => {
    const { host, root } = await mount({ currentPath: null });
    const toggle = host.querySelector<HTMLInputElement>(".graph-color-toggle input")!;
    await act(async () => toggle.click());
    expect([...host.querySelectorAll(".graph-folder-legend li")].map((li) => li.textContent)).toEqual(["(root)", "Work"]);
    act(() => root.unmount());
  });
});
