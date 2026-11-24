import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { PluginApi } from "@noteriv/plugin-api";
import {
  buildCalendarMonth,
  extractFrontmatterDue,
  extractTasks,
  formatDate,
  type CalendarDay,
  type TaskItem,
} from "@noteriv/core/calendar-utils";
import { scanVault, noteTitle, type ScannedNote } from "../shared/vault";
import { openDailyNote } from "./daily";

export interface CalendarLabels {
  months: string[];
  weekdays: string[];
  today: string;
  dailyNote: string;
  dueTasks: string;
  notes: string;
  tasksDue: string;
  nothing: string;
  createDaily: string;
  loading: string;
  close: string;
  previousMonth: string;
  nextMonth: string;
}

/** What the calendar shows, computed once per opening from a single vault scan. */
export interface CalendarData {
  /** date -> path of its daily note */
  daily: Map<string, string>;
  /** date -> number of tasks / frontmatter `due:` falling on it */
  tasksByDate: Map<string, number>;
  notesByDate: Map<string, number>;
  /** tasks with a due date */
  dueTasks: TaskItem[];
  /** every note path, for "notes of this day" (names starting with the date) */
  paths: string[];
}

export function collectCalendarData(notes: ScannedNote[]): CalendarData {
  const daily = new Map<string, string>();
  const tasksByDate = new Map<string, number>();
  const notesByDate = new Map<string, number>();
  const dueTasks: TaskItem[] = [];
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const note of notes) {
    const name = note.path.split("/").pop() ?? note.path;
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\.(md|markdown)$/i);
    if (m) {
      daily.set(m[1], note.path);
      bump(notesByDate, m[1]);
    }
    for (const task of extractTasks(note.content, note.path)) {
      if (task.dueDate) {
        bump(tasksByDate, task.dueDate);
        dueTasks.push(task);
      }
    }
    const fmDue = extractFrontmatterDue(note.content);
    if (fmDue) bump(tasksByDate, fmDue);
  }
  return { daily, tasksByDate, notesByDate, dueTasks, paths: notes.map((n) => n.path) };
}

/** Month grid with daily notes and due tasks; double-click a day to open (or create) its daily note. */
export function CalendarView({ api, labels }: { api: PluginApi; labels: CalendarLabels }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(formatDate(now));
  const [data, setData] = useState<CalendarData | null>(null);

  useEffect(() => {
    let cancelled = false;
    scanVault(api.vault)
      .then((notes) => !cancelled && setData(collectCalendarData(notes)))
      .catch((err) => console.error("[calendar] scan failed:", err));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const calendar = useMemo(
    () => buildCalendarMonth(year, month, data?.daily ?? new Map(), data?.tasksByDate ?? new Map(), data?.notesByDate ?? new Map()),
    [year, month, data]
  );
  const dayTasks = useMemo(() => data?.dueTasks.filter((t) => t.dueDate === selectedDate) ?? [], [data, selectedDate]);
  const dayNotes = useMemo(
    () => (data?.paths ?? []).filter((p) => noteTitle(p).startsWith(selectedDate)).map((p) => ({ path: p, name: noteTitle(p) })),
    [data, selectedDate]
  );

  const shift = useCallback(
    (delta: number) => {
      const d = new Date(year, month + delta, 1);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
    },
    [year, month]
  );

  const open = (path: string) => {
    void api.workspace.openFile(path);
    api.workspace.closeView();
  };
  const openDaily = (date: string) => {
    void openDailyNote(api, date);
    api.workspace.closeView();
  };
  const onDayDouble = (day: CalendarDay) => (day.dailyNotePath ? open(day.dailyNotePath) : openDaily(formatDate(day.date)));

  return (
    <div
      data-calendar-view=""
      style={{
        background: "var(--bg-primary)",
        borderRadius: 12,
        border: "1px solid var(--bg-tertiary)",
        width: 720,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "80vh",
        display: "flex",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <button onClick={() => shift(-1)} style={navBtn} aria-label={labels.previousMonth}>&lt;</button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 600 }}>
              {labels.months[month]} {year}
            </span>
            <button
              onClick={() => {
                const t = new Date();
                setYear(t.getFullYear());
                setMonth(t.getMonth());
                setSelectedDate(formatDate(t));
              }}
              style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", fontSize: 11, cursor: "pointer" }}
            >
              {labels.today}
            </button>
          </div>
          <button onClick={() => shift(1)} style={navBtn} aria-label={labels.nextMonth}>&gt;</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
          {labels.weekdays.map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, color: "var(--text-secondary)", padding: 4, fontWeight: 600 }}>
              {d}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {calendar.days.map((day, i) => {
            const dateStr = formatDate(day.date);
            const selected = dateStr === selectedDate;
            return (
              <button
                key={i}
                data-date={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                onDoubleClick={() => onDayDouble(day)}
                style={{
                  aspectRatio: "1",
                  border: "none",
                  borderRadius: 6,
                  background: selected ? "var(--border)" : day.isToday ? "var(--bg-tertiary)" : "transparent",
                  color: !day.isCurrentMonth ? "var(--text-muted)" : day.isToday ? "var(--accent)" : "var(--text-primary)",
                  fontSize: 13,
                  fontWeight: day.isToday ? 700 : 400,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  outline: selected ? "2px solid var(--accent)" : "none",
                  outlineOffset: -2,
                }}
              >
                {day.dayOfMonth}
                <div style={{ display: "flex", gap: 2 }}>
                  {day.hasDailyNote && <span style={dot("var(--accent)")} />}
                  {day.taskCount > 0 && <span style={dot("var(--green)")} />}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "var(--text-secondary)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={dot("var(--accent)", 6)} /> {labels.dailyNote}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={dot("var(--green)", 6)} /> {labels.dueTasks}
          </span>
          {!data && <span>{labels.loading}</span>}
        </div>
      </div>

      <div style={{ width: 240, borderLeft: "1px solid var(--bg-tertiary)", padding: 16, overflowY: "auto", background: "var(--bg-secondary)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{selectedDate}</span>
          <button
            onClick={() => api.workspace.closeView()}
            aria-label={labels.close}
            title={labels.close}
            style={{ border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        {dayNotes.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={sectionTitle}>{labels.notes}</div>
            {dayNotes.map((n) => (
              <button key={n.path} onClick={() => open(n.path)} style={linkBtn}>
                {n.name}
              </button>
            ))}
          </div>
        )}

        {dayTasks.length > 0 && (
          <div>
            <div style={sectionTitle}>{labels.tasksDue}</div>
            {dayTasks.map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  padding: "4px 0",
                  fontSize: 12,
                  color: t.completed ? "var(--text-muted)" : "var(--text-primary)",
                  textDecoration: t.completed ? "line-through" : "none",
                }}
              >
                <span style={{ color: t.completed ? "var(--green)" : "var(--yellow)" }}>{t.completed ? "✓" : "○"}</span>
                <span>{t.text}</span>
              </div>
            ))}
          </div>
        )}

        {data && dayNotes.length === 0 && dayTasks.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            {labels.nothing}
            <button onClick={() => openDaily(selectedDate)} style={{ ...linkBtn, padding: "4px 0", marginTop: 8 }}>
              {labels.createDaily}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const navBtn: CSSProperties = {
  width: 32,
  height: 32,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-primary)",
  fontSize: 14,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const sectionTitle: CSSProperties = { fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 600 };
const linkBtn: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "4px 8px",
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "var(--accent)",
  fontSize: 12,
  cursor: "pointer",
};
const dot = (color: string, size = 4): CSSProperties => ({ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block" });
