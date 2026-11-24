import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { CorePlugin, FileView, PluginApi, VaultApi } from "@noteriv/plugin-api";
import { createBoardContent, isBoardContent, isBoardFile } from "@noteriv/core/board-utils";
import { BoardView, type BoardLabels } from "./BoardView";
import { pluginT } from "../shared/i18n";

export const FILE_VIEW_ID = "board";

function labelsFor(api: PluginApi): BoardLabels & { create: string; failed: string } {
  const t = pluginT(api, "board");
  return {
    create: t("create"),
    failed: t("failed"),
    addCard: t("addCard"),
    deleteColumn: t("deleteColumn"),
    confirmDeleteColumn: (title, count) => t("confirmDeleteColumn", { title, count }),
    cardPlaceholder: t("cardPlaceholder"),
    addCardButton: t("addCardButton"),
    columnPlaceholder: t("columnPlaceholder"),
    add: t("add"),
    cancel: t("cancel"),
    addColumn: t("addColumn"),
  };
}

/** A board shows for `*.board.md` files and for notes whose frontmatter says `board: true` (both apps, since 2.4b). */
export function isBoard(file: { path: string; content: string }): boolean {
  return isBoardFile(file.path) || isBoardContent(file.content);
}

/** `Board.board.md`, else `Board 2.board.md`, `Board 3.board.md`… at the vault root: the first that does not exist. */
export async function newBoardPath(vault: VaultApi): Promise<string> {
  for (let n = 1; ; n++) {
    const path = n === 1 ? "Board.board.md" : `Board ${n}.board.md`;
    if (!(await vault.exists(path))) return path;
  }
}

const boardView = (labels: BoardLabels): FileView => ({
  id: FILE_VIEW_ID,
  match: isBoard,
  mount(container, ctx) {
    const root = createRoot(container);
    let content = ctx.content;
    const onChange = (next: string) => {
      content = next;
      ctx.setContent(next);
    };
    const render = () => root.render(createElement(BoardView, { content, onChange, labels }));
    render();
    return {
      update(next) {
        content = next;
        render();
      },
      // Unmount may be asked for while React is dispatching one of the board's own events: wait a tick.
      destroy: () => void setTimeout(() => root.unmount(), 0),
    };
  },
});

/** Board: Kanban boards stored as markdown, shown in place of the editor. */
const board: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.registerFileView(boardView(t));
    api.ui.addCommand({
      id: "new",
      name: t.create,
      callback: async () => {
        try {
          const path = await newBoardPath(api.vault);
          await api.vault.write(path, createBoardContent());
          await api.workspace.openFile(path);
        } catch (e) {
          console.error("[board] create failed:", e);
          api.ui.showNotice(t.failed);
        }
      },
    });
  },
};

export default board;
