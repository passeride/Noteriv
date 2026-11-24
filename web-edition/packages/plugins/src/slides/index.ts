import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { reactView } from "../shared/react-view";
import { SlidePresentation, type SlideLabels } from "./SlidePresentation";

export const VIEW_TYPE = "slides";

function labelsFor(api: PluginApi): SlideLabels & { command: string; title: string; noNote: string } {
  const t = pluginT(api, "slides");
  return {
    command: t("command"),
    title: t("title"),
    noNote: t("noNote"),
    exit: t("exit"),
    notes: t("notes"),
    overview: t("overview"),
    print: t("print"),
    speakerNotes: t("speakerNotes"),
    overviewTitle: (count) => t("overviewTitle", { count }),
    closeOverview: t("closeOverview"),
    separatorHint: t("separatorHint"),
  };
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M8 11.5V14M5.5 14h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

/** Slides: present the open note full screen, one slide per `---` section. */
const slides: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    // The note as it was when the presentation started; the view is not live.
    let content = "";
    api.ui.registerView(
      VIEW_TYPE,
      reactView(() => createElement(SlidePresentation, { content, labels: t, onClose: () => api.workspace.closeView() }))
    );
    const present = () => {
      const current = api.editor.getContent();
      if (current === null) {
        api.ui.showNotice(t.noNote);
        return;
      }
      content = current;
      void api.workspace.openView(VIEW_TYPE);
    };
    api.ui.addCommand({ id: "present", name: t.command, callback: present });
    api.ui.addRibbonIcon({ id: "present", title: t.title, icon: ICON, onClick: present });
    api.ui.addNoteToolbarButton({ id: "present", title: t.title, icon: ICON, onClick: present });
  },
};

export default slides;
