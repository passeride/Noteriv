import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../src/panels";
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
  await setLocale("en");
});

const names = (el: HTMLElement) => [...el.querySelectorAll(".palette-item-name")].map((n) => n.textContent);
const categories = (el: HTMLElement) => [...el.querySelectorAll(".cmd-category")].map((n) => n.textContent);

describe("CommandPalette text", () => {
  it("names the apps' actions and categories from the catalog, in the current language", async () => {
    const hotkeys = [
      { action: "save", label: "Save now", keys: "Ctrl+S", category: "File" },
      { action: "somethingNew", label: "Table text", keys: "", category: "Labs" },
    ];
    const extraItems = [{ action: "core:x", label: "Calendar: open", keys: "", category: "Core plugin" }];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(createElement(CommandPalette, { hotkeys, extraItems, platform: "web", onExecute: vi.fn(), onClose: vi.fn() }))
    );
    // A known action takes the catalog's name; an unknown one keeps its table text; plugin rows are as given.
    expect(names(host)).toEqual(["Save", "Table text", "Calendar: open"]);
    expect(categories(host)).toEqual(["File", "Labs", "Core plugin"]);

    await act(async () => setLocale("vi"));
    expect(names(host)).toEqual(["Lưu ngay", "Table text", "Calendar: open"]);
    expect(categories(host)).toEqual(["File", "Labs", "Core plugin"]);
  });
});
