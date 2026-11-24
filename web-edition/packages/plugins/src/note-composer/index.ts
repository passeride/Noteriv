import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { reactView } from "../shared/react-view";
import { NoteComposer, type ComposerLabels } from "./NoteComposer";

export { mergeNotes, splitByHeadings, sanitizeFileName, sectionPath } from "./compose";

export const VIEW_TYPE = "note-composer";

function labelsFor(api: PluginApi): ComposerLabels & { command: string } {
  const t = pluginT(api, "noteComposer");
  return {
    command: t("command"),
    title: t("title"),
    merge: t("merge"),
    split: t("split"),
    noNote: t("noNote"),
    searchMerge: t("searchMerge"),
    selected: (count) => t("selected", { count }),
    noNotes: t("noNotes"),
    addHeadings: t("addHeadings"),
    // On web the source notes go to the trash; desktop deletes the files.
    deleteAfter: t(`deleteAfter.${api.app.platform}`),
    splitBy: t("splitBy"),
    noHeadings: (level) => t("noHeadings", { level }),
    exists: t("exists"),
    cancel: t("cancel"),
    merging: t("merging"),
    mergeN: (count) => t("mergeN", { count }),
    splitting: t("splitting"),
    splitN: (count) => t("splitN", { count }),
    skipped: (count) => t("skipped", { count }),
  };
}

/** Note composer: merge notes into the open one, or split the open note by its headings. */
const noteComposer: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.registerView(VIEW_TYPE, reactView(() => createElement(NoteComposer, { api, labels: t })));
    api.ui.addCommand({ id: "open", name: t.command, callback: () => void api.workspace.openView(VIEW_TYPE) });
  },
};

export default noteComposer;
