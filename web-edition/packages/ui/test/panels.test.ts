import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryVaultAdapter } from "@noteriv/core/memory-vault-adapter";
import { BacklinksPanel, BookmarksPanel, CommandPalette, OutgoingLinksPanel, QuickOpen, TagPane } from "../src/panels";

// Panels are rendered for real (react-dom + jsdom) against the in-memory vault, so what is asserted is what a user
// would see and click, not component internals.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout, hence no scrollIntoView; the lists call it to keep the active row visible.
  Element.prototype.scrollIntoView = () => {};
});

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(element: ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function text(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(el: Element, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

const note = (path: string) => ({ id: path, path, name: path.split("/").pop()! });

describe("BookmarksPanel", () => {
  it("lists bookmarks with the host's labels, selects and removes", async () => {
    const onNoteSelect = vi.fn();
    const onBookmarkRemove = vi.fn();
    const el = await render(
      createElement(BookmarksPanel, {
        notes: [note("a/One.md"), note("Two.md")],
        currentNoteId: "Two.md",
        onNoteSelect,
        onBookmarkRemove,
        labels: { title: "Dấu trang", remove: "Bỏ" },
      })
    );
    expect(text(el.querySelector(".bm-header-label"))).toBe("Dấu trang");
    expect(text(el.querySelector(".bm-header-count"))).toBe("2");
    expect(el.querySelectorAll(".bm-item")).toHaveLength(2);
    expect(el.querySelector(".bm-item-active")?.getAttribute("title")).toBe("Two.md");

    await act(async () => (el.querySelectorAll<HTMLElement>(".bm-item")[0]).click());
    expect(onNoteSelect).toHaveBeenCalledWith("a/One.md");

    await act(async () => (el.querySelector<HTMLElement>(".bm-remove-btn[title='Bỏ']"))!.click());
    expect(onBookmarkRemove).toHaveBeenCalledWith("a/One.md");
    expect(onNoteSelect).toHaveBeenCalledTimes(1); // removing does not also select
  });

  it("shows the empty state, and a close button only when onClose is given", async () => {
    let el = await render(
      createElement(BookmarksPanel, { notes: [], currentNoteId: null, onNoteSelect: vi.fn(), onBookmarkRemove: vi.fn(), labels: { empty: "Nothing yet" } })
    );
    expect(text(el.querySelector(".bm-empty"))).toContain("Nothing yet");
    expect(el.querySelector(".titlebar-btn")).toBeNull();

    await act(async () => root?.unmount());
    host?.remove();
    const onClose = vi.fn();
    el = await render(
      createElement(BookmarksPanel, { notes: [], currentNoteId: null, onNoteSelect: vi.fn(), onBookmarkRemove: vi.fn(), onClose })
    );
    await act(async () => el.querySelector<HTMLElement>(".titlebar-btn")!.click());
    expect(onClose).toHaveBeenCalled();
  });
});

describe("QuickOpen", () => {
  const entries = [note("Chess/Endgames.md"), note("Chess/Openings.md"), note("Journal.md")];

  it("loads through the host's lister, filters by name or path, and opens on Enter", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const el = await render(createElement(QuickOpen, { load: async () => entries, onSelect, onClose }));
    expect(el.querySelectorAll(".palette-item")).toHaveLength(3);

    const input = el.querySelector("input")!;
    await type(input, "chess/open");
    expect([...el.querySelectorAll(".palette-item-name")].map(text)).toEqual(["Openings.md"]);

    await press(input, "Enter");
    expect(onSelect).toHaveBeenCalledWith("Chess/Openings.md");
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the supplied empty-state label", async () => {
    const el = await render(createElement(QuickOpen, { load: async () => [], onSelect: vi.fn(), onClose: vi.fn(), labels: { empty: "No files found" } }));
    expect(text(el.querySelector(".palette-empty"))).toBe("No files found");
  });
});

describe("CommandPalette", () => {
  const hotkeys = [
    { action: "save", label: "Save now", keys: "Ctrl+S", category: "File" },
    { action: "newNote", label: "New Note", keys: "Ctrl+N", category: "File" },
    { action: "toggleSidebar", label: "Toggle Sidebar", keys: "Ctrl+B", category: "View" },
  ] as const;

  it("groups by category, formats keys for the platform, and executes the chosen action", async () => {
    const onExecute = vi.fn();
    const onRecent = vi.fn();
    const onClose = vi.fn();
    const el = await render(
      createElement(CommandPalette<(typeof hotkeys)[number]["action"]>, { hotkeys: [...hotkeys], platform: "darwin", onExecute, onRecent, onClose })
    );
    expect([...el.querySelectorAll(".cmd-category")].map(text)).toEqual(["File", "View"]);
    expect(text(el.querySelector(".cmd-keys"))).toBe("⌘S");

    const input = el.querySelector("input")!;
    await type(input, "sidebar");
    await press(input, "Enter");
    expect(onExecute).toHaveBeenCalledWith("toggleSidebar");
    expect(onRecent).toHaveBeenCalledWith("toggleSidebar");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows recent actions first when there is no query, and plugin commands from extraItems", async () => {
    const el = await render(
      createElement(CommandPalette, {
        hotkeys: [...hotkeys],
        extraItems: [{ action: "plugin:1:hello", label: "Say hello", keys: "", category: "Plugin · demo" }],
        recentActions: ["newNote"],
        platform: "web",
        onExecute: vi.fn(),
        onClose: vi.fn(),
        labels: { recent: "Gần đây" },
      })
    );
    expect(text(el.querySelector(".cmd-category-recent"))).toBe("Gần đây");
    expect(text(el.querySelector(".palette-item"))).toContain("New Note");
    expect([...el.querySelectorAll(".palette-item-name")].map(text)).toContain("Say hello");
  });
});

describe("panels over a VaultAdapter", () => {
  const vault = () =>
    new MemoryVaultAdapter({
      "A.md": "start #chess #endgame\nsee [[B]]",
      "dir/B.md": "back to [[A]] #chess",
      "C.md": "no links here",
    });

  it("BacklinksPanel lists the notes linking to a note, with line numbers when the adapter has them", async () => {
    const onNoteOpen = vi.fn();
    const el = await render(createElement(BacklinksPanel, { adapter: vault(), noteId: "A.md", onNoteOpen, onClose: vi.fn() }));
    expect(text(el.querySelector(".bl-count"))).toBe("1 link");
    expect(text(el.querySelector(".bl-file-name"))).toBe("B");
    expect(text(el.querySelector(".bl-line-num"))).toBe("L1");

    await act(async () => el.querySelector<HTMLElement>(".bl-file-header")!.click());
    expect(onNoteOpen).toHaveBeenCalledWith("dir/B.md");
  });

  it("BacklinksPanel lists unlinked mentions and links one through the host's editor", async () => {
    const adapter = new MemoryVaultAdapter({ "A.md": "", "C.md": "mentions a here, and `A` in code" });
    const edits: string[] = [];
    const editNote = vi.fn(async (id: string, transform: (text: string) => string | null) => {
      const next = transform((await adapter.readNote(id))!);
      if (next === null) return false;
      edits.push(next);
      await adapter.writeNote(id, next);
      return true;
    });
    const el = await render(createElement(BacklinksPanel, { adapter, noteId: "A.md", onNoteOpen: vi.fn(), onClose: vi.fn(), editNote }));
    const section = el.querySelector(".bl-unlinked")!;
    expect(text(section.querySelector(".bl-section span"))).toBe("Unlinked mentions");
    expect(text(section.querySelector(".bl-section .bl-count"))).toBe("1");
    expect(text(section.querySelector(".bl-snippet-text"))).toBe("mentions a here, and `A` in code");

    await act(async () => section.querySelector<HTMLElement>(".bl-link-btn")!.click());
    expect(editNote).toHaveBeenCalledWith("C.md", expect.any(Function));
    expect(edits).toEqual(["mentions [[a]] here, and `A` in code"]);
    expect(text(el.querySelector(".bl-unlinked .bl-section-empty"))).toBe("No other note names this one without a link.");
  });

  it("OutgoingLinksPanel follows the editor text: links (unresolved dimmed) and names to link", async () => {
    const onNoteOpen = vi.fn();
    const adapter = vault();
    const editNote = vi.fn(async () => true);
    const props = { adapter, noteId: "A.md", onNoteOpen, onClose: vi.fn(), editNote };
    const el = await render(createElement(OutgoingLinksPanel, { ...props, content: "see [[B]] and [[Nowhere]], about C" }));
    await act(async () => new Promise((r) => setTimeout(r, 450))); // unlinked mentions wait for typing to pause
    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>(".bl-list > .bl-file-header"));
    expect(rows.map((r) => text(r))).toEqual(["L1B", "L1Nowhere"]);
    expect(rows[1].disabled).toBe(true);
    await act(async () => rows[0].click());
    expect(onNoteOpen).toHaveBeenCalledWith("dir/B.md");
    expect(text(el.querySelector(".bl-unlinked .bl-snippet-text"))).toBe("C");

    await act(async () => el.querySelector<HTMLElement>(".bl-unlinked .bl-link-btn")!.click());
    const transform = (editNote.mock.calls[0] as unknown as [string, (t: string) => string | null])[1];
    expect(transform("see [[B]] and [[Nowhere]], about C")).toBe("see [[B]] and [[Nowhere]], about [[C]]");
  });

  it("TagPane aggregates tags across the vault and lists the notes of the chosen tag", async () => {
    const onNoteSelect = vi.fn();
    const el = await render(createElement(TagPane, { adapter: vault(), onTagClick: vi.fn(), onNoteSelect, visible: true }));
    const rows = [...el.querySelectorAll(".tag-tree-row")].map(text);
    expect(rows).toContain("#chess2");
    expect(rows).toContain("#endgame1");

    await act(async () => [...el.querySelectorAll<HTMLElement>(".tag-tree-row")].find((r) => text(r).startsWith("#chess"))!.click());
    expect([...el.querySelectorAll(".tag-file-name")].map(text).sort()).toEqual(["A", "B"]);
  });

  it("TagPane renders nothing until visible", async () => {
    const el = await render(createElement(TagPane, { adapter: vault(), onTagClick: vi.fn(), onNoteSelect: vi.fn(), visible: false }));
    expect(el.querySelector(".tag-pane")).toBeNull();
  });
});
