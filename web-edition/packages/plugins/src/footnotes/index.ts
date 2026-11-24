import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { FootnotesPanel, type FootnotesLabels } from "./FootnotesPanel";

export const PANEL_ID = "footnotes";

function labelsFor(api: PluginApi): FootnotesLabels & { title: string; command: string } {
  const t = pluginT(api, "footnotes");
  return {
    title: t("title"),
    command: t("command"),
    noNote: t("noNote"),
    none: t("none"),
    count: (count) => t("count", { count }),
    inline: t("inline"),
    noDefinition: t("noDefinition"),
    unused: t("unused"),
    goToRef: (n) => t("goToRef", { n }),
  };
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h8M3 7h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 12h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11.5 9.5v4M10 11h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

/** Footnotes: a right-hand panel listing the open note's footnotes, to jump to a definition or a reference. */
const footnotes: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.addSidebarPanel({
      id: PANEL_ID,
      title: t.title,
      icon: ICON,
      render(container) {
        const root = createRoot(container);
        root.render(createElement(FootnotesPanel, { api, labels: t }));
        // Deferred like reactView: closing can start inside a React event of the app.
        return () => void setTimeout(() => root.unmount(), 0);
      },
    });
    api.ui.addCommand({ id: "toggle", name: t.command, callback: () => api.ui.toggleSidebarPanel(PANEL_ID) });
  },
};

export default footnotes;
