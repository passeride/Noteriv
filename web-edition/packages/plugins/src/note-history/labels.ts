import type { PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";

export interface HistoryLabels {
  gitCommand: string;
  scrubberCommand: string;
  gitTitle: string;
  scrubberTitle: string;
  noNote: string;
  close: string;
  restore: string;
  restoreHint: string;
  restored: string;
  // Git history
  loadingHistory: string;
  loadingVersion: string;
  gitEmpty: string;
  gitEmptyHint: string;
  oldest: string;
  latest: string;
  commits: string;
  noMessage: string;
  changesFrom: (hash: string) => string;
  // Time scrubber
  loadingSnapshots: string;
  scrubberEmpty: string;
  scrubberEmptyHint: string;
  now: string;
  isCurrent: string;
  play: string;
  pause: string;
  keysHint: string;
  ago: {
    justNow: string;
    seconds: (n: number) => string;
    minutes: (n: number) => string;
    hours: (n: number) => string;
    days: (n: number) => string;
  };
}

/** The history views' text. Snapshots are taken differently on each platform, which the empty-state hints say. */
export function labelsFor(api: PluginApi): HistoryLabels {
  const t = pluginT(api, "noteHistory");
  const platform = api.app.platform;
  return {
    gitCommand: t("gitCommand"),
    scrubberCommand: t("scrubberCommand"),
    gitTitle: t("gitTitle"),
    scrubberTitle: t("scrubberTitle"),
    noNote: t("noNote"),
    close: t("close"),
    restore: t("restore"),
    restoreHint: t("restoreHint"),
    restored: t("restored"),
    loadingHistory: t("loadingHistory"),
    loadingVersion: t("loadingVersion"),
    gitEmpty: t("gitEmpty"),
    gitEmptyHint: t(`gitEmptyHint.${platform}`),
    oldest: t("oldest"),
    latest: t("latest"),
    commits: t("commits"),
    noMessage: t("noMessage"),
    changesFrom: (hash) => t("changesFrom", { hash }),
    loadingSnapshots: t("loadingSnapshots"),
    scrubberEmpty: t("scrubberEmpty"),
    scrubberEmptyHint: t(`scrubberEmptyHint.${platform}`),
    now: t("now"),
    isCurrent: t("isCurrent"),
    play: t("play"),
    pause: t("pause"),
    keysHint: t("keysHint"),
    ago: {
      justNow: t("ago.justNow"),
      seconds: (count) => t("ago.seconds", { count }),
      minutes: (count) => t("ago.minutes", { count }),
      hours: (count) => t("ago.hours", { count }),
      days: (count) => t("ago.days", { count }),
    },
  };
}
