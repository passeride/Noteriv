import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { countText, type TextStats } from "./count";

export { countText, type TextStats };

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

/** Word count: status bar count for the open note, plus a command and a ribbon button with full statistics. */
const wordCount: CorePlugin = {
  onload(api: PluginApi) {
    // Text lives in the shared catalog under plugins.wordCount (packages/ui/src/i18n/locales).
    const t = pluginT(api, "wordCount");
    const stats = (s: TextStats) => ({ count: s.words, characters: s.characters, minutes: s.readingMinutes });

    const update = (content?: unknown) => {
      const text = typeof content === "string" ? content : api.editor.getContent();
      if (text === null) {
        api.ui.removeStatusBarItem("count");
        return;
      }
      const counted = stats(countText(text));
      api.ui.addStatusBarItem({ id: "count", text: t("words", counted), title: t("title", counted) });
    };

    const show = () => {
      const text = api.editor.getContent();
      api.ui.showNotice(text === null ? t("noNote") : t("notice", stats(countText(text))));
    };

    update();
    api.events.on("editor-change", update);
    api.events.on("file-open", () => update());
    api.ui.addCommand({ id: "show", name: t("command"), hotkey: "Mod+Alt+W", callback: show });
    api.ui.addRibbonIcon({ id: "show", title: t("ribbon"), icon: ICON, onClick: show });
  },
};

export default wordCount;
