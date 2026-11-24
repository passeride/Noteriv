import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { platformI18n } from "./i18n";
import type { FileView, FileViewInstance, PluginApi } from "@noteriv/plugin-api";
import { createBoardContent, parseBoard } from "@noteriv/core/board-utils";
import board, { FILE_VIEW_ID, isBoard, newBoardPath } from "../src/board";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function fakeApi(existing: string[] = []) {
  const files = new Set(existing);
  const api = {
    app: { platform: "web", vaultPath: null, currentFile: null },
    i18n: platformI18n("web"),
    vault: {
      exists: vi.fn(async (p: string) => files.has(p)),
      write: vi.fn(async (p: string) => void files.add(p)),
    },
    ui: { registerFileView: vi.fn(), addCommand: vi.fn(), showNotice: vi.fn() },
    workspace: { openFile: vi.fn(async () => true) },
  };
  return { api: api as unknown as PluginApi, raw: api };
}

describe("board plugin", () => {
  it("recognises board files by name or by frontmatter", () => {
    expect(isBoard({ path: "Plans.board.md", content: "## A\n" })).toBe(true);
    expect(isBoard({ path: "x/Plans.md", content: "---\nboard: true\n---\n## A\n" })).toBe(true);
    expect(isBoard({ path: "notes.md", content: "# Just a note" })).toBe(false);
  });

  it("creates the first free Board name at the vault root and opens it", async () => {
    const { api, raw } = fakeApi(["Board.board.md", "Board 2.board.md"]);
    expect(await newBoardPath(api.vault)).toBe("Board 3.board.md");
    await board.onload(api);
    await raw.ui.addCommand.mock.calls[0][0].callback();
    expect(raw.vault.write).toHaveBeenCalledWith("Board 3.board.md", createBoardContent());
    expect(raw.workspace.openFile).toHaveBeenCalledWith("Board 3.board.md");
  });

  it("file view: renders the columns, writes edits through setContent, redraws on update", async () => {
    const { api, raw } = fakeApi();
    await board.onload(api);
    const view = raw.ui.registerFileView.mock.calls[0][0] as FileView;
    expect(view.id).toBe(FILE_VIEW_ID);

    const el = document.createElement("div");
    document.body.appendChild(el);
    const setContent = vi.fn();
    let inst!: FileViewInstance | void;
    await act(async () => {
      inst = view.mount(el, { path: "B.board.md", content: "## Todo\n\n- [ ] first\n\n## Done\n", setContent });
    });
    expect(el.textContent).toContain("Todo");
    expect(el.textContent).toContain("first");

    // Tick the card: the board writes the new markdown back through the tab buffer.
    // The tick box is the button right before the card's text.
    const tick = [...el.querySelectorAll("button")].find((b) => b.nextElementSibling?.textContent?.includes("first"));
    expect(tick).toBeDefined();
    await act(async () => tick!.click());
    expect(setContent).toHaveBeenCalledOnce();
    expect(parseBoard(setContent.mock.calls[0][0] as string).columns[0].cards[0].completed).toBe(true);

    await act(async () => inst!.update!("## Later\n\n- [ ] second\n"));
    expect(el.textContent).toContain("Later");
    expect(el.textContent).toContain("second");

    await act(async () => {
      inst!.destroy!();
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(el.textContent).toBe("");
    el.remove();
  });
});
