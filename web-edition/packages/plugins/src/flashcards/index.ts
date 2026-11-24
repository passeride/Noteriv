import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { scanVault } from "../shared/vault";
import { mountReview, type ReviewLabels } from "./view";

export { extractCards, getDueCards, gradeCard, hashCard, type Flashcard, type CardReview, type Reviews } from "./cards";
export { migrateLegacyReviews, loadReviews, saveReviews } from "./storage";
export { scanVault, type ScannedNote } from "../shared/vault";

export const VIEW_TYPE = "flashcards-review";

function labelsFor(api: PluginApi): ReviewLabels & { command: string; ribbon: string } {
  const t = pluginT(api, "flashcards");
  return {
    command: t("command"),
    ribbon: t("ribbon"),
    title: t("title"),
    cards: (count) => t("cards", { count }),
    due: (count) => t("due", { count }),
    done: (count) => t("done", { count }),
    scanning: t("scanning"),
    caughtUp: t("caughtUp"),
    noCards: t("noCards"),
    comeBack: (count) => t("comeBack", { count }),
    showAnswer: t("showAnswer"),
    close: t("close"),
    grades: [t("grade.again"), t("grade.hard"), t("grade.ok"), t("grade.good"), t("grade.easy")],
  };
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="10" height="7" rx="1.2" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="6" width="10" height="7" rx="1.2" stroke="currentColor" stroke-width="1.2" fill="var(--bg-secondary)"/><path d="M7 9.5h5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';

/** Flashcards: spaced repetition (SM-2) over Q:/A: pairs and {{cloze}} deletions found in the vault's notes. */
const flashcards: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.registerView(VIEW_TYPE, () => ({
      mount: (container) => mountReview(container, api, t, () => scanVault(api.vault)),
    }));
    const open = () => void api.workspace.openView(VIEW_TYPE);
    api.ui.addCommand({ id: "review", name: t.command, callback: open });
    api.ui.addRibbonIcon({ id: "review", title: t.ribbon, icon: ICON, onClick: open });
  },
};

export default flashcards;
