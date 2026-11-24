import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { createEmptyDrawing, isDrawingContent, isDrawingFile, serializeDrawing } from "@noteriv/core/drawing-utils";
import { reactFileView } from "../shared/react-view";
import { createKindFile } from "../shared/new-file";
import { DrawingView, type DrawingLabels } from "./DrawingView";
import { pluginT } from "../shared/i18n";

export const FILE_VIEW_ID = "drawing";

function labelsFor(api: PluginApi): DrawingLabels & { create: string; failed: string } {
  const t = pluginT(api, "drawing");
  return {
    create: t("create"),
    failed: t("failed"),
    tools: {
      select: t("tool.select"),
      pencil: t("tool.pencil"),
      rectangle: t("tool.rectangle"),
      ellipse: t("tool.ellipse"),
      line: t("tool.line"),
      arrow: t("tool.arrow"),
      text: t("tool.text"),
      eraser: t("tool.eraser"),
    },
    pickColor: t("pickColor"),
    fillOn: t("fillOn"),
    fillOff: t("fillOff"),
    resetView: t("resetView"),
    clear: t("clear"),
    confirmClear: t("confirmClear"),
    saving: t("saving"),
  };
}

/** A drawing: a `.drawing` file (desktop) or a note with `drawing: true` frontmatter (web). */
export function isDrawing(file: { path: string; content: string }): boolean {
  return isDrawingFile(file.path) || isDrawingContent(file.content);
}

/** Drawing: freehand sketches and shapes, shown in place of the editor. */
const drawing: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.registerFileView(reactFileView(FILE_VIEW_ID, isDrawing, ({ content, onChange }) => createElement(DrawingView, { content, onChange, labels: t })));
    api.ui.addCommand({
      id: "new",
      name: t.create,
      callback: async () => {
        try {
          await createKindFile(api, { base: "Drawing", desktopExt: ".drawing", marker: "drawing", body: serializeDrawing(createEmptyDrawing()) });
        } catch (e) {
          console.error("[drawing] create failed:", e);
          api.ui.showNotice(t.failed);
        }
      },
    });
  },
};

export default drawing;
