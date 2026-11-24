import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConflictBanner } from "../src/panels";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(props: Parameters<typeof ConflictBanner>[0]): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ConflictBanner, props));
  });
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const button = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement;
const click = (b: HTMLButtonElement) => act(async () => b.click());

describe("ConflictBanner", () => {
  it("renders nothing for an ordinary note", async () => {
    const el = await render({ path: "a.md", content: "x", loadOriginal: async () => "y", onKeepOriginal: vi.fn(), onUseThisVersion: vi.fn() });
    expect(el.querySelector("[data-testid=conflict-banner]")).toBeNull();
  });

  it("explains the copy, compares it with the original and resolves", async () => {
    const loadOriginal = vi.fn(async () => "# A\nWEB");
    const onKeepOriginal = vi.fn();
    const onUseThisVersion = vi.fn();
    const el = await render({
      path: "notes/a (conflict 2026-10-17 0153).md",
      content: "# A\nREMOTE",
      loadOriginal,
      onKeepOriginal,
      onUseThisVersion,
    });
    expect(loadOriginal).toHaveBeenCalledWith("notes/a.md");
    expect(el.textContent).toContain("notes/a.md");
    expect(el.textContent).toContain("2026-10-17 01:53");

    await click(button(el, "Compare"));
    const diff = el.querySelector("[data-testid=conflict-diff]")!.textContent!;
    expect(diff).toContain("− WEB");
    expect(diff).toContain("+ REMOTE");

    await click(button(el, "Use this version (replace the original)"));
    expect(onUseThisVersion).toHaveBeenCalledWith("notes/a.md");
    await click(button(el, "Keep the original (delete this copy)"));
    expect(onKeepOriginal).toHaveBeenCalled();
  });

  it("uses the host's labels and hides on keep both", async () => {
    const el = await render({
      path: "a (conflict 2026-10-17 0153).md",
      content: "x",
      loadOriginal: async () => "y",
      onKeepOriginal: vi.fn(),
      onUseThisVersion: vi.fn(),
      labels: { keepBoth: "Giữ cả hai" },
    });
    await click(button(el, "Giữ cả hai"));
    expect(el.querySelector("[data-testid=conflict-banner]")).toBeNull();
  });

  it("says so when the original is gone", async () => {
    const el = await render({ path: "a (conflict 2026-10-17 0153).md", content: "x", loadOriginal: async () => null, onKeepOriginal: vi.fn(), onUseThisVersion: vi.fn() });
    expect(el.textContent).toContain("no longer exists");
  });
});
