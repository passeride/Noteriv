import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { listOf, pluginT } from "../shared/i18n";
import { reactView } from "../shared/react-view";
import { VaultInsights, type InsightsLabels } from "./VaultInsights";

export { computeVaultInsights, computeDailyStreak, buildHeatmap } from "./insights";

export const VIEW_TYPE = "vault-insights";

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13V8M6.5 13V4M10 13V7M13.5 13V2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

function labelsFor(api: PluginApi): InsightsLabels & { command: string } {
  const t = pluginT(api, "vaultInsights");
  return {
    command: t("command"),
    title: t("title"),
    close: t("close"),
    loading: t("loading"),
    activity: t("activity"),
    heatTip: (date, count) => t("heatTip", { date, count }),
    less: t("less"),
    more: t("more"),
    overview: t("overview"),
    notes: t("notes"),
    words: t("words"),
    tags: t("tags"),
    links: t("links"),
    avgWords: t("avgWords"),
    streak: t("streak"),
    current: t("current"),
    longest: t("longest"),
    last: (date) => t("last", { date }),
    hubs: t("hubs"),
    noHubs: t("noHubs"),
    inOut: (incoming, outgoing) => t("inOut", { incoming, outgoing }),
    orphans: t("orphans"),
    noOrphans: t("noOrphans"),
    topTags: t("topTags"),
    noTags: t("noTags"),
    growth: t("growth"),
    noData: t("noData"),
    health: t("health"),
    withBacklinks: t("withBacklinks"),
    withTags: t("withTags"),
    withFrontmatter: t("withFrontmatter"),
    overall: t("overall"),
    undated: (count) => t("undated", { count }),
    dayLabels: listOf(t, "dayLabels"),
    months: listOf(t, "months"),
  };
}

/** Vault insights: activity heatmap, link hubs and orphans, tags, growth and a vault health score. */
const vaultInsights: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.registerView(VIEW_TYPE, reactView(() => createElement(VaultInsights, { api, labels: t })));
    const open = () => void api.workspace.openView(VIEW_TYPE);
    api.ui.addCommand({ id: "open", name: t.command, callback: open });
    api.ui.addRibbonIcon({ id: "open", title: t.title, icon: ICON, onClick: open });
  },
};

export default vaultInsights;
