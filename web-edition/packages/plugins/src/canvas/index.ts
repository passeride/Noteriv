import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { isCanvasContent, serializeCanvas } from "@noteriv/core/canvas-utils";
import { reactFileView } from "../shared/react-view";
import { createKindFile } from "../shared/new-file";
import { CanvasView } from "./CanvasView";
import { pluginCanvasServices, type CanvasLabels } from "./services";

export { pluginCanvasServices, type CanvasServices, type CanvasLabels } from "./services";

export const FILE_VIEW_ID = "canvas";

function labelsFor(api: PluginApi): CanvasLabels & { create: string; failed: string } {
  const t = pluginT(api, "canvas");
  return {
    create: t("create"),
    failed: t("failed"),
    searchNotes: t("searchNotes"),
    noMatchingNotes: t("noMatchingNotes"),
    noteNotFound: t("noteNotFound"),
    pickImage: t("pickImage"),
    upload: t("upload"),
    uploading: t("uploading"),
    noImages: t("noImages"),
    loading: t("loading"),
    group: t("group"),
    select: t("select"),
    addText: t("addText"),
    addSticky: t("addSticky"),
    addImage: t("addImage"),
    addFile: t("addFile"),
    addGroup: t("addGroup"),
    draw: t("draw"),
    zoomIn: t("zoomIn"),
    zoomOut: t("zoomOut"),
    resetZoom: t("resetZoom"),
    zoomToFit: t("zoomToFit"),
    deleteSelected: t("deleteSelected"),
    menu: {
      duplicate: t("menu.duplicate"),
      stickyColor: t("menu.stickyColor"),
      color: t("menu.color"),
      delete: t("menu.delete"),
      addText: t("menu.addText"),
      addSticky: t("menu.addSticky"),
      addImage: t("menu.addImage"),
    },
  };
}

/** A canvas: a `.canvas` file (desktop) or a note with `canvas: true` frontmatter (web). */
export function isCanvas(file: { path: string; content: string }): boolean {
  return file.path.endsWith(".canvas") || isCanvasContent(file.content);
}

/** Canvas: boards of text, note, sticky, image and group nodes joined by edges, shown in place of the editor. */
const canvas: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    const services = pluginCanvasServices(api);
    api.ui.registerFileView(
      reactFileView(FILE_VIEW_ID, isCanvas, ({ content, onChange }) => createElement(CanvasView, { content, onChange, services, labels: t }))
    );
    api.ui.addCommand({
      id: "new",
      name: t.create,
      callback: async () => {
        try {
          await createKindFile(api, { base: "Canvas", desktopExt: ".canvas", marker: "canvas", body: serializeCanvas({ nodes: [], edges: [] }) });
        } catch (e) {
          console.error("[canvas] create failed:", e);
          api.ui.showNotice(t.failed);
        }
      },
    });
  },
};

export default canvas;
