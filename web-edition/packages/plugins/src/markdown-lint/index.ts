import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { LintPanel, type LintLabels } from "./LintPanel";

export { groupWarnings } from "./LintPanel";

export const PANEL_ID = "lint";

function labelsFor(api: PluginApi): LintLabels & { title: string; command: string } {
  const t = pluginT(api, "markdownLint");
  return {
    title: t("title"),
    command: t("command"),
    errors: (count) => t("errors", { count }),
    warnings: (count) => t("warnings", { count }),
    infos: (count) => t("infos", { count }),
    ok: t("ok"),
    none: t("none"),
    noNote: t("noNote"),
    groupErrors: t("groupErrors"),
    groupWarnings: t("groupWarnings"),
    groupInfos: t("groupInfos"),
    line: (line) => t("line", { line }),
  };
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h7M3 8h5M3 12h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 10.5l1.5 1.5 3-3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Markdown lint: a right-hand panel listing problems in the open note (broken links, heading levels, …). */
const markdownLint: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.addSidebarPanel({
      id: PANEL_ID,
      title: t.title,
      icon: ICON,
      render(container) {
        const root = createRoot(container);
        root.render(createElement(LintPanel, { api, labels: t }));
        // Deferred like reactView: closing can start inside a React event of the app.
        return () => void setTimeout(() => root.unmount(), 0);
      },
    });
    api.ui.addCommand({ id: "toggle", name: t.command, hotkey: "Mod+Shift+L", callback: () => api.ui.toggleSidebarPanel(PANEL_ID) });
  },
};

export default markdownLint;
