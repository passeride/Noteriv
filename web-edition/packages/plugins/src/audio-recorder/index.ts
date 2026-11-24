import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { reactView } from "../shared/react-view";
import { AudioRecorder, type RecorderLabels } from "./AudioRecorder";

export { generateRecordingFilename, formatDuration, audioMarkdown, saveErrorMessage } from "./recording";

export const VIEW_TYPE = "audio-recorder";

function labelsFor(api: PluginApi): RecorderLabels & { command: string } {
  const t = pluginT(api, "audioRecorder");
  return {
    command: t("command"),
    title: t("title"),
    close: t("close"),
    idle: t("idle"),
    requesting: t("requesting"),
    recording: t("recording"),
    recorded: t("recorded"),
    saving: t("saving"),
    start: t("start"),
    stop: t("stop"),
    discard: t("discard"),
    save: t("save"),
    denied: t("denied"),
    noMic: (message) => t("noMic", { message }),
    // Only web has a storage quota to mention.
    saveFailed: t(`saveFailed.${api.app.platform}`),
    savedNoNote: (time) => t("savedNoNote", { time }),
  };
}

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 7.5a5 5 0 0010 0M8 12.5V15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

/** Audio recorder: record from the microphone and insert the recording into the open note. */
const audioRecorder: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.registerView(VIEW_TYPE, reactView(() => createElement(AudioRecorder, { api, labels: t })));
    const open = () => void api.workspace.openView(VIEW_TYPE);
    api.ui.addCommand({ id: "record", name: t.command, callback: open });
    api.ui.addRibbonIcon({ id: "record", title: t.title, icon: ICON, onClick: open });
  },
};

export default audioRecorder;
