import { describe, expect, it, vi } from "vitest";
import type { VaultApi } from "@noteriv/plugin-api";
import type { ViewNote } from "@noteriv/core/views";
import { createViewFileView, createViewProcessor, createViewSource } from "../src/views";

const PENDING = "data-nrv-pending";
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function settled(el: HTMLElement) {
  for (let i = 0; i < 100 && (el.querySelector(`[${PENDING}]`) || !el.querySelector(".nv-header, .nv-error")); i++) await tick(5);
}

const NOTES: Record<string, string> = {
  "Projects/Alpha.md": "---\nstatus: active\nrating: 4\ndone: false\n---\nA",
  "Projects/Beta.md": "---\nstatus: done\nrating: 2\n---\nB",
  "Inbox.md": "No properties",
};

function fakeVault(files: Record<string, string> = { ...NOTES }) {
  const vault = {
    list: async (dir?: string) => {
      const prefix = dir ? `${dir}/` : "";
      const entries = new Map<string, boolean>();
      for (const p of Object.keys(files).filter((p) => p.startsWith(prefix))) {
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf("/");
        entries.set(prefix + (slash < 0 ? rest : rest.slice(0, slash)), slash >= 0);
      }
      return [...entries].map(([path, isDir]) => ({ path, name: path.split("/").pop()!, isDir }));
    },
    frontmatter: vi.fn(async () =>
      Object.entries(files)
        .filter(([, c]) => c.startsWith("---"))
        .map(([path, c]) => ({ path, block: c.slice(0, c.indexOf("\n---", 3) + 4) }))
    ),
    stats: async () => ({}),
    read: vi.fn(),
  };
  return { vault: vault as unknown as VaultApi, files };
}

function harness(files?: Record<string, string>) {
  const { vault, files: f } = fakeVault(files);
  const source = createViewSource(vault);
  const open = vi.fn();
  const edit = vi.fn(async (path: string, transform: (t: string) => string | null) => {
    const next = transform(f[path]);
    if (next === null) return false;
    f[path] = next;
    return true;
  });
  const processor = createViewProcessor(source, { open, edit });
  const render = async (text: string) => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    processor(text, el, { source: text, language: "view", sourcePath: null });
    await settled(el);
    return el;
  };
  return { vault, files: f, open, edit, render, processor };
}

/** A drop of one of the view's kanban cards. */
function dropOf(path: string) {
  const drop = new Event("drop", { bubbles: true }) as Event & { dataTransfer: unknown };
  drop.dataTransfer = { types: ["text/x-noteriv-view-card"], getData: () => path };
  return drop;
}

const cells = (el: HTMLElement) => [...el.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));

describe("views plugin", () => {
  it("reads every note's properties in one front matter request and shows a sorted table", async () => {
    const { vault, render, open } = harness();
    const el = await render("from: Projects\ncolumns: [file, status, rating]\nsort: rating desc");
    expect(vault.frontmatter).toHaveBeenCalledTimes(1);
    expect(vault.read).not.toHaveBeenCalled();
    expect(el.querySelector(".nv-header")?.textContent).toBe("2 notes");
    expect(cells(el)).toEqual([
      ["Alpha", "active", "4"],
      ["Beta", "done", "2"],
    ]);
    el.querySelector<HTMLElement>(".nv-link")!.click();
    expect(open).toHaveBeenCalledWith("Projects/Alpha.md");
  });

  it("edits a cell in place: the property is written in that note with its type, and the view redraws", async () => {
    const { render, files, edit } = harness();
    const el = await render("from: Projects\ncolumns: [file, rating, done]\nsort: file.name");
    el.querySelectorAll<HTMLElement>(".nv-editable")[0].click();
    const input = el.querySelector<HTMLInputElement>(".nv-input")!;
    input.value = "5";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await tick(20);
    expect(edit).toHaveBeenCalledWith("Projects/Alpha.md", expect.any(Function));
    expect(files["Projects/Alpha.md"]).toBe("---\nstatus: active\nrating: 5\ndone: false\n---\nA");
    await settled(el);
    expect(cells(el)[0]).toEqual(["Alpha", "5", ""]);

    el.querySelector<HTMLInputElement>(".nv-check")!.click();
    await tick(20);
    expect(files["Projects/Alpha.md"]).toContain("done: true");
  });

  it("leaves a cell alone when the value did not change", async () => {
    const { render, edit } = harness();
    const el = await render("from: Projects\ncolumns: [file, status]");
    el.querySelector<HTMLElement>(".nv-editable")!.click();
    el.querySelector<HTMLInputElement>(".nv-input")!.dispatchEvent(new Event("blur"));
    await tick(10);
    expect(edit).not.toHaveBeenCalled();
  });

  it("kanban: columns by the group property; dropping a card on another column sets it", async () => {
    const { render, files } = harness();
    const el = await render("layout: kanban\ngroup: status\nfrom: Projects");
    expect([...el.querySelectorAll(".nv-column-title")].map((c) => c.textContent)).toEqual(["active · 1", "done · 1"]);
    const doneColumn = el.querySelectorAll<HTMLElement>(".nv-column")[1];
    doneColumn.dispatchEvent(dropOf("Projects/Alpha.md"));
    await tick(20);
    expect(files["Projects/Alpha.md"]).toContain("status: done");
  });

  it("kanban on a list: moving a card swaps that item and keeps the others; other drags are ignored", async () => {
    const { render, files, edit } = harness({
      "a.md": "---\ntags:\n  - todo\n  - work\n---\nA",
      "b.md": "---\ntags:\n  - done\n---\nB",
    });
    const el = await render("layout: kanban\ngroup: tags");
    const columns = [...el.querySelectorAll<HTMLElement>(".nv-column")];
    expect(columns.map((c) => c.dataset.key)).toEqual(["done", "todo"]);
    const notACard = new Event("drop", { bubbles: true }) as Event & { dataTransfer: unknown };
    notACard.dataTransfer = { types: ["Files"], getData: () => "a.md" };
    columns[0].dispatchEvent(notACard);
    await tick(10);
    expect(edit).not.toHaveBeenCalled();
    columns[0].dispatchEvent(dropOf("a.md"));
    await tick(20);
    expect(files["a.md"]).toBe("---\ntags:\n  - done\n  - work\n---\nA");
  });

  it("never writes a typo over a number, and a refused edit restores the cell", async () => {
    const { render, files, edit } = harness();
    const el = await render("from: Projects\ncolumns: [file, rating]\nsort: file.name");
    el.querySelector<HTMLElement>(".nv-editable")!.click();
    const input = el.querySelector<HTMLInputElement>(".nv-input")!;
    input.value = "four";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await settled(el);
    expect(edit).not.toHaveBeenCalled();
    expect(files["Projects/Alpha.md"]).toContain("rating: 4");
    expect(el.querySelector(".nv-input")).toBeNull();

    edit.mockImplementationOnce(async () => false);
    el.querySelector<HTMLElement>(".nv-editable")!.click();
    const again = el.querySelector<HTMLInputElement>(".nv-input")!;
    again.value = "3";
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await tick(20);
    await settled(el);
    expect(el.querySelector(".nv-input")).toBeNull();
    expect(cells(el)[0]).toEqual(["Alpha", "4"]);
  });

  it("explains a wrong setting instead of drawing", async () => {
    const { render } = harness();
    const el = await render("layout: kanban");
    expect(el.querySelector(".nv-error")?.textContent).toBe('Check the "group" setting.');
  });

  it("source: notes without front matter are listed too, with no properties", async () => {
    const { vault } = fakeVault();
    const notes: ViewNote[] = await createViewSource(vault).get();
    expect(notes.map((n) => [n.path, Object.keys(n.properties).length])).toEqual([
      ["Projects/Alpha.md", 3],
      ["Projects/Beta.md", 2],
      ["Inbox.md", 0],
    ]);
  });
});

describe("view files", () => {
  const texts = { layouts: { table: "Table", cards: "Cards", list: "List", kanban: "Kanban" }, hint: "Edit in source mode" };

  async function mountFile(content: string, files?: Record<string, string>) {
    const h = harness(files);
    const view = createViewFileView(h.processor, texts);
    const el = document.createElement("div");
    document.body.appendChild(el);
    const setContent = vi.fn();
    const instance = view.mount(el, { path: "Tasks.md", content, setContent }) || {};
    await settled(el);
    return { ...h, view, el, setContent, instance };
  }

  it("shows a note marked view: true as its view, and leaves that note out of the list", async () => {
    const content = "---\nview: true\n---\ncolumns: [file, status]\nsort: file";
    const files = { ...NOTES, "Tasks.md": content };
    const { view, el } = await mountFile(content, files);
    expect(view.match({ path: "Tasks.md", content })).toBe(true);
    expect(view.match({ path: "Board.view", content: "" })).toBe(true);
    expect(view.match({ path: "Alpha.md", content: NOTES["Projects/Alpha.md"] })).toBe(false);
    expect(cells(el)).toEqual([
      ["Alpha", "active"],
      ["Beta", "done"],
      ["Inbox", ""],
    ]);
    expect(el.querySelector(".nv-layout.nv-active")?.textContent).toBe("Table");
  });

  it("switches the layout by rewriting the file, and draws again when the file changes elsewhere", async () => {
    const { el, setContent, instance } = await mountFile("from: Projects\nlayout: table\ncolumns: [file, status]");
    const cards = [...el.querySelectorAll<HTMLButtonElement>(".nv-layout")].find((b) => b.textContent === "Cards")!;
    cards.click();
    await settled(el);
    expect(setContent).toHaveBeenCalledWith("from: Projects\nlayout: cards\ncolumns: [file, status]");
    expect(el.querySelectorAll(".nv-card")).toHaveLength(2);
    expect(el.querySelector(".nv-layout.nv-active")?.textContent).toBe("Cards");

    instance.update?.("from: Projects\nlayout: list");
    await settled(el);
    expect(el.querySelectorAll(".nv-list li")).toHaveLength(2);
    expect(el.querySelector(".nv-layout.nv-active")?.textContent).toBe("List");
  });
});
