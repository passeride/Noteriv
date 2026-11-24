import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryVaultAdapter } from "@noteriv/core/memory-vault-adapter";
import { PropertiesEditor, PropertiesView } from "../src/panels";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(element: ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

async function setInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(el: Element, k: string) {
  await act(async () => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
}

const NOTE = "---\ntitle: Plan\ntags:\n  - chess\ndone: false\nrating: 3\nmeta:\n  a: 1\n---\nBody";

describe("PropertiesEditor", () => {
  function setup(content = NOTE) {
    const onChange = vi.fn();
    const onTypeChange = vi.fn();
    const props = { content, onChange, types: {}, onTypeChange, collapsed: false, onToggleCollapse: vi.fn() };
    return { onChange, onTypeChange, props };
  }

  it("shows each property with a control for its type, nested YAML read-only", async () => {
    const { props } = setup();
    const el = await render(createElement(PropertiesEditor, props));
    const rows = Array.from(el.querySelectorAll(".fm-property"));
    expect(rows.map((r) => [text(r.querySelector(".fm-property-key")), r.getAttribute("data-type")])).toEqual([
      ["title", "text"],
      ["tags", "tags"],
      ["done", "checkbox"],
      ["rating", "number"],
      ["meta", "text"],
    ]);
    expect(text(rows[1].querySelector(".fm-chip"))).toBe("#chess×");
    expect(rows[4].querySelector(".fm-complex")).not.toBeNull();
  });

  it("writes only the edited property, keeping the block lists of the others", async () => {
    const { props, onChange } = setup();
    const el = await render(createElement(PropertiesEditor, props));
    const done = el.querySelector<HTMLInputElement>(".fm-property[data-type=checkbox] input")!;
    await act(async () => done.click());
    expect(onChange).toHaveBeenLastCalledWith(NOTE.replace("done: false", "done: true"));

    const chipInput = el.querySelector<HTMLInputElement>(".fm-property[data-type=tags] .fm-chip-input")!;
    await setInput(chipInput, "endgame");
    await key(chipInput, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(NOTE.replace("  - chess\n", "  - chess\n  - endgame\n"));
  });

  it("changing a type sets it for the vault and converts the value when it converts cleanly", async () => {
    const { props, onChange, onTypeChange } = setup();
    const el = await render(createElement(PropertiesEditor, props));
    const select = el.querySelectorAll<HTMLSelectElement>(".fm-type-select")[0];
    await act(async () => {
      select.value = "list";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onTypeChange).toHaveBeenCalledWith("title", "list");
    expect(onChange).toHaveBeenLastCalledWith(NOTE.replace("title: Plan", "title:\n  - Plan"));
  });
});

describe("PropertiesView", () => {
  it("lists the vault's properties with counts and renames one in every note through the host's editor", async () => {
    const adapter = new MemoryVaultAdapter({
      "a.md": "---\nstatus: draft\ntags: [x]\n---\nA",
      "b.md": "---\nstatus: done\n---\nB",
      "c.md": "No properties",
    });
    const writes: Record<string, string> = {};
    const editNote = vi.fn(async (id: string, transform: (t: string) => string | null) => {
      const next = transform((await adapter.readNote(id))!);
      if (next === null) return false;
      writes[id] = next;
      return true;
    });
    const onTypeRename = vi.fn();
    const el = await render(
      createElement(PropertiesView, {
        adapter,
        types: { status: "text" },
        onTypeChange: vi.fn(),
        onTypeRename,
        onNoteOpen: vi.fn(),
        onClose: vi.fn(),
        editNote,
      })
    );
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const rows = Array.from(el.querySelectorAll(".pv-row"));
    expect(rows.map((r) => text(r.querySelector(".pv-key")))).toEqual(["status2", "tags1"]);

    await act(async () => rows[0].querySelector<HTMLElement>(".bl-link-btn")!.click());
    const input = el.querySelector<HTMLInputElement>(".pv-rename")!;
    await setInput(input, "state");
    await key(input, "Enter");
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(writes).toEqual({ "a.md": "---\nstate: draft\ntags: [x]\n---\nA", "b.md": "---\nstate: done\n---\nB" });
    expect(onTypeRename).toHaveBeenCalledWith("status", "state");
    expect(text(el.querySelector(".pv-notice"))).toBe("Renamed in 2 notes");
  });
});
