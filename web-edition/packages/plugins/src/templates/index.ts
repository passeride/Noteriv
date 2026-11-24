import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { reactView } from "../shared/react-view";
import { TemplatePicker, type PickerLabels, type TemplateMode } from "./TemplatePicker";

export { getTemplateVariables, processTemplate, freeNotePath, TEMPLATES_FOLDER } from "./engine";

export const VIEW_TYPES: Record<TemplateMode, string> = { create: "templates-create", insert: "templates-insert" };

function labelsFor(api: PluginApi): PickerLabels & { create: string; insert: string } {
  const t = pluginT(api, "templates");
  return {
    create: t("create"),
    insert: t("insert"),
    search: t("search"),
    emptyTitle: t("emptyTitle"),
    emptyFolder: (folder) => t("emptyFolder", { folder }),
    emptyVariables: t("emptyVariables"),
    noMatch: t("noMatch"),
    preview: t("preview"),
    previewEmpty: t("previewEmpty"),
    enter: { create: t("enterCreate"), insert: t("enterInsert") },
    close: t("close"),
    move: t("move"),
    count: (count) => t("count", { count }),
    noNote: t("noNote"),
  };
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

/** Templates: notes in the vault's `Templates/` folder, used to start a new note or inserted at the cursor. */
const templates: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    for (const mode of ["create", "insert"] as const) {
      api.ui.registerView(VIEW_TYPES[mode], reactView(() => createElement(TemplatePicker, { api, mode, labels: t })));
    }
    const open = (mode: TemplateMode) => () => void api.workspace.openView(VIEW_TYPES[mode]);
    api.ui.addCommand({ id: "create", name: t.create, callback: open("create") });
    // Desktop keeps its Ctrl/Cmd+T; in a browser that key opens a tab and a page cannot take it, hence the Alt.
    const insertKey = api.app.platform === "desktop" ? "Mod+T" : "Mod+Alt+T";
    api.ui.addCommand({ id: "insert", name: t.insert, hotkey: insertKey, callback: open("insert") });
    api.ui.addRibbonIcon({ id: "create", title: t.create, icon: ICON, onClick: open("create") });
  },
};

export default templates;
