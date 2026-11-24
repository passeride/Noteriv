import { createElement } from "react";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { listOf, pluginT } from "../shared/i18n";
import { formatDate } from "@noteriv/core/calendar-utils";
import { reactView } from "../shared/react-view";
import { CalendarView, type CalendarLabels } from "./CalendarView";
import { openDailyNote } from "./daily";

export { collectCalendarData } from "./CalendarView";
export { dailyNotePath, openDailyNote } from "./daily";

export const VIEW_TYPE = "calendar";

type Labels = CalendarLabels & { openCalendar: string; todayNote: string; ribbonCalendar: string; ribbonDaily: string };

function labelsFor(api: PluginApi): Labels {
  const t = pluginT(api, "calendar");
  return {
    openCalendar: t("openCalendar"),
    todayNote: t("todayNote"),
    ribbonCalendar: t("ribbonCalendar"),
    ribbonDaily: t("ribbonDaily"),
    months: listOf(t, "months"),
    weekdays: listOf(t, "weekdays"),
    today: t("today"),
    dailyNote: t("dailyNote"),
    dueTasks: t("dueTasks"),
    notes: t("notes"),
    tasksDue: t("tasksDue"),
    nothing: t("nothing"),
    createDaily: t("createDaily"),
    loading: t("loading"),
    close: t("close"),
    previousMonth: t("previousMonth"),
    nextMonth: t("nextMonth"),
  };
}

const CALENDAR_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const DAILY_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="10" r="1.3" fill="currentColor"/></svg>';

/** Calendar and daily notes: a month view of daily notes and due tasks, and today's note (Ctrl/Cmd+D). */
const calendar: CorePlugin = {
  onload(api: PluginApi) {
    const t = labelsFor(api);
    api.ui.registerView(VIEW_TYPE, reactView(() => createElement(CalendarView, { api, labels: t })));
    const openCalendar = () => void api.workspace.openView(VIEW_TYPE);
    const today = () => void openDailyNote(api, formatDate(new Date()));
    api.ui.addCommand({ id: "open", name: t.openCalendar, callback: openCalendar });
    api.ui.addCommand({ id: "today", name: t.todayNote, hotkey: "Mod+D", callback: today });
    api.ui.addRibbonIcon({ id: "today", title: t.ribbonDaily, icon: DAILY_ICON, onClick: today });
    api.ui.addRibbonIcon({ id: "open", title: t.ribbonCalendar, icon: CALENDAR_ICON, onClick: openCalendar });
  },
};

export default calendar;
