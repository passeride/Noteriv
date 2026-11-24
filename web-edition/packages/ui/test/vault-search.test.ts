import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NoteSearchHit, VaultAdapter } from "@noteriv/core/vault-adapter";
import { VaultSearch } from "../src/panels";
import { setLocale } from "../src/i18n";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const ref = (path: string) => ({ id: `id:${path}`, path, name: path.split("/").pop()! });

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("VaultSearch", () => {
  it("re-renders its text when the language changes, and an app label still wins", async () => {
    const adapter = { searchNotes: async () => [] } as unknown as VaultAdapter;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(VaultSearch, { adapter, onOpen: vi.fn(), onClose: vi.fn(), labels: { hint: "App hint" } })));
    const input = host.querySelector("input")!;
    expect(input.placeholder).toBe("Search across all notes…");
    await act(async () => setLocale("vi"));
    expect(input.placeholder).toBe("Tìm trong nội dung các note…");
    expect(host.textContent).toContain("App hint");
    await act(async () => setLocale("en"));
    expect(input.placeholder).toBe("Search across all notes…");
  });

  it("searches as you type, lists matching lines and opens the chosen one at its line", async () => {
    const hits: NoteSearchHit[] = [
      { ref: ref("a.md"), snippet: "x", matches: [{ line: 3, text: "hello world" }, { line: 9, text: "world again" }] },
      { ref: ref("b.md"), snippet: "<b>world</b> in b" }, // no line info: one row with the snippet
    ];
    const search = vi.fn(async () => hits);
    const onOpen = vi.fn();
    const onClose = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(createElement(VaultSearch, { adapter: { search } as unknown as VaultAdapter, onOpen, onClose, debounceMs: 0 }))
    );

    const input = host.querySelector("input")!;
    await typeInto(input, "world");
    await act(async () => new Promise((r) => setTimeout(r, 10)));

    expect(search).toHaveBeenCalledWith("world");
    const options = host.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toContain(":3");
    expect(options[2].textContent).toContain("world in b"); // <b> tags stripped

    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onOpen).toHaveBeenCalledWith(hits[0].ref, 9);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("VaultSearch with operators and replace", () => {
  const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

  async function mount(files: Record<string, string>, editNote?: (id: string, f: (t: string) => string | null) => Promise<boolean>) {
    const { MemoryVaultAdapter } = await import("@noteriv/core/memory-vault-adapter");
    const adapter = new MemoryVaultAdapter(files);
    const search = vi.spyOn(adapter, "search");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(VaultSearch, { adapter, onOpen: vi.fn(), onClose: vi.fn(), debounceMs: 0, editNote })));
    return { adapter, search, input: host.querySelector<HTMLInputElement>("input.palette-input")! };
  }

  it("evaluates operators here, listing the matching lines", async () => {
    const { input, search } = await mount({
      "Projects/Plan.md": "Meeting with Ann\nother",
      "Journal/Day.md": "Meeting cancelled",
    });
    await typeInto(input, "meeting path:projects");
    await settle();
    expect(search).not.toHaveBeenCalled();
    const options = [...host!.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(["Plan:1Meeting with Ann"]);
  });

  it("explains a query it cannot read", async () => {
    const { input } = await mount({ "a.md": "x" });
    await typeInto(input, '"open');
    await settle();
    expect(host!.textContent).toContain("Check the search: a quote is not closed");
  });

  it("replaces in every matching note after a second click, through the host's editor", async () => {
    const edits: Record<string, string> = {};
    const files = { "a.md": "old text, old", "b.md": "nothing", "c.md": "OLD here" };
    const editNote = vi.fn(async (id: string, f: (t: string) => string | null) => {
      const next = f(files[id as keyof typeof files]);
      if (next === null) return false;
      edits[id] = next;
      return true;
    });
    const { input } = await mount(files, editNote);
    await act(async () => host!.querySelector<HTMLElement>(".search-replace-toggle")!.click());
    await typeInto(input, '"old"');
    await settle();
    await typeInto(host!.querySelector<HTMLInputElement>(".search-replace-input")!, "new");
    const button = host!.querySelector<HTMLButtonElement>(".search-replace-btn")!;
    await act(async () => button.click());
    expect(editNote).not.toHaveBeenCalled(); // first click only asks
    expect(button.textContent).toBe("Click again to replace in 2 notes");
    await act(async () => button.click());
    await settle();
    expect(edits).toEqual({ "a.md": "new text, new", "c.md": "new here" });
    expect(host!.textContent).toContain("Replaced in 2 notes");
  });
});
