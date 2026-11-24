import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { reactView } from "../shared/react-view";
import { GraphView, type GraphLabels } from "./GraphView";

export { loadLinkGraph } from "./GraphView";

export const VIEW_TYPE = "graph";
/** The same view, opened on the local graph of the open note. */
export const LOCAL_VIEW_TYPE = "graph-local";

function labelsFor(api: PluginApi): GraphLabels & { command: string; localCommand: string; title: string } {
  const t = pluginT(api, "graph");
  return {
    command: t("command"),
    localCommand: t("localCommand"),
    title: t("title"),
    filter: t("filter"),
    close: t("close"),
    zoomIn: t("zoomIn"),
    zoomOut: t("zoomOut"),
    building: t("building"),
    notes: t("notes"),
    connections: t("connections"),
    connectionCount: (count) => t("connectionCount", { count }),
    oneWay: t("oneWay"),
    reciprocal: t("reciprocal"),
    legend: t("legend"),
    allNotes: t("allNotes"),
    thisNote: t("thisNote"),
    noNote: t("noNote"),
    depth: t("depth"),
    colorByFolder: t("colorByFolder"),
    rootFolder: t("rootFolder"),
  };
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="4" r="2" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M6 7.2l4-2.4M6 8.8l4 2.4" stroke="currentColor" stroke-width="1.2"/></svg>';

/**
 * Graph view: every note and the wiki-links between them, as a force-directed canvas; or the local graph of the open
 * note (its links and theirs, to a chosen depth).
 */
const graph: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    const view = (local: boolean) =>
      reactView(() =>
        createElement(GraphView, {
          vault: api.vault,
          currentPath: api.app.currentFile,
          labels: t,
          local,
          onClose: () => api.workspace.closeView(),
          onNoteSelect: (path) => {
            api.workspace.closeView();
            void api.workspace.openFile(path);
          },
        })
      );
    api.ui.registerView(VIEW_TYPE, view(false));
    api.ui.registerView(LOCAL_VIEW_TYPE, view(true));
    const open = () => void api.workspace.openView(VIEW_TYPE);
    api.ui.addCommand({ id: "open", name: t.command, hotkey: "Mod+G", callback: open });
    api.ui.addCommand({ id: "open-local", name: t.localCommand, callback: () => void api.workspace.openView(LOCAL_VIEW_TYPE) });
    api.ui.addRibbonIcon({ id: "open", title: t.title, icon: ICON, onClick: open });
  },
};

export default graph;
