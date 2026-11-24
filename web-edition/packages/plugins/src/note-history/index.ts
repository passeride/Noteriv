import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { reactView } from "../shared/react-view";
import { GitHistory } from "./GitHistory";
import { labelsFor } from "./labels";
import { TimeScrubber } from "./TimeScrubber";

export const GIT_VIEW = "note-history-git";
export const SCRUBBER_VIEW = "note-history-scrubber";
/** Command id the app's File Recovery dialog runs to switch to the scrubber (`note-history:scrubber`). */
export const SCRUBBER_COMMAND = "scrubber";

const GIT_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4.5" cy="4" r="1.8" stroke="currentColor" stroke-width="1.2"/><circle cx="4.5" cy="12" r="1.8" stroke="currentColor" stroke-width="1.2"/><circle cx="11.5" cy="6.5" r="1.8" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 5.8v4.4M11.5 8.3c0 2-2.5 2.2-5.4 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
// A timeline with a playhead (File Recovery, in the app, already uses the clock).
const SCRUBBER_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 11.5h13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M3.5 10v3M7 10v3M12.5 10v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9.5 3v10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4 3.2v4.6L7.5 5.5z" fill="currentColor"/></svg>';

/** How long a "does this vault have git history" answer is reused (web asks the server). */
const SOURCES_TTL_MS = 60_000;

/** Note history: git versions of the open note (diff, restore) and the snapshot Time scrubber. */
const noteHistory: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    // What the open view shows, captured when it opens.
    let target = { path: "", content: "" };

    const restore = (content: string) => {
      api.editor.setContent(content);
      api.workspace.closeView();
      api.ui.showNotice(t.restored);
    };
    const close = () => api.workspace.closeView();

    api.ui.registerView(
      GIT_VIEW,
      reactView(() =>
        createElement(GitHistory, { vault: api.vault, path: target.path, currentContent: target.content, onRestore: restore, onClose: close, labels: t })
      )
    );
    api.ui.registerView(
      SCRUBBER_VIEW,
      reactView(() =>
        createElement(TimeScrubber, {
          vault: api.vault,
          markdown: api.markdown,
          path: target.path,
          currentContent: target.content,
          onRestore: restore,
          onClose: close,
          labels: t,
        })
      )
    );

    const open = (view: string) => () => {
      const path = api.app.currentFile;
      const content = api.editor.getContent();
      if (!path || content === null) {
        api.ui.showNotice(t.noNote);
        return;
      }
      target = { path, content };
      void api.workspace.openView(view);
    };
    const openGit = open(GIT_VIEW);
    const openScrubber = open(SCRUBBER_VIEW);

    api.ui.addCommand({ id: "git", name: t.gitCommand, callback: openGit });
    api.ui.addCommand({ id: SCRUBBER_COMMAND, name: t.scrubberCommand, hotkey: "Mod+Shift+H", callback: openScrubber });
    api.ui.addNoteToolbarButton({ id: SCRUBBER_COMMAND, title: t.scrubberTitle, icon: SCRUBBER_ICON, onClick: openScrubber });

    // The git button only where git history can exist (web: a git sync connection that has run).
    let checkedAt = 0;
    const refreshGitButton = async () => {
      if (Date.now() - checkedAt < SOURCES_TTL_MS) return;
      checkedAt = Date.now();
      const { git } = await api.vault.versionSources().catch(() => ({ git: false }));
      if (git) api.ui.addNoteToolbarButton({ id: "git", title: t.gitTitle, icon: GIT_ICON, onClick: openGit });
      else api.ui.removeNoteToolbarButton("git");
    };
    void refreshGitButton();
    api.events.on("file-open", () => void refreshGitButton());
  },
};

export default noteHistory;
