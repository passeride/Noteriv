import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCalendarMonth,
  extractFrontmatterDue,
  extractTasks,
  formatDate,
  generateMonthGrid,
  getWeekdayHeaders,
  parseDate,
} from "../src/calendar-utils";

// Dates are built with local-time constructors throughout, so these tests do not depend on the machine's time zone.

describe("formatDate / parseDate", () => {
  it("formats as zero-padded YYYY-MM-DD", () => {
    expect(formatDate(new Date(2024, 0, 5))).toBe("2024-01-05");
    expect(formatDate(new Date(2024, 11, 31))).toBe("2024-12-31");
  });
  it("parses YYYY-MM-DD into a local date", () => {
    const d = parseDate("2024-02-29")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2024, 1, 29]);
  });
  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    for (const s of ["2024-2-9", "garbage", "", "2024-02-29T10:00", "24-02-29"]) expect(parseDate(s), s).toBeNull();
  });
  // Known quirk: the digits are not range-checked, JS Date rolls them over.
  it("does not validate month or day ranges (they roll over)", () => {
    const d = parseDate("2024-13-45")!;
    expect(d).toBeInstanceOf(Date);
    expect(formatDate(d)).toBe("2025-02-14");
  });
  it("round-trips", () => {
    expect(formatDate(parseDate("2023-07-09")!)).toBe("2023-07-09");
  });
});

describe("generateMonthGrid", () => {
  it("always returns 6 rows (42 days)", () => {
    expect(generateMonthGrid(2024, 1)).toHaveLength(42);
    expect(generateMonthGrid(2026, 1, true)).toHaveLength(42);
  });
  it("starts on Sunday by default, padding with the previous month", () => {
    const g = generateMonthGrid(2024, 0); // 1 Jan 2024 is a Monday
    expect(formatDate(g[0])).toBe("2023-12-31");
    expect(formatDate(g[1])).toBe("2024-01-01");
    expect(formatDate(g[41])).toBe("2024-02-10");
  });
  it("can start on Monday", () => {
    const g = generateMonthGrid(2024, 0, true);
    expect(formatDate(g[0])).toBe("2024-01-01");
    expect(formatDate(g[41])).toBe("2024-02-11");
  });
  it("needs no leading days when the month starts on the first column", () => {
    expect(formatDate(generateMonthGrid(2026, 1)[0])).toBe("2026-02-01"); // 1 Feb 2026 is a Sunday
    expect(formatDate(generateMonthGrid(2026, 1, true)[0])).toBe("2026-01-26"); // six days of padding when weeks start Monday
  });
  it("is consecutive days throughout", () => {
    const g = generateMonthGrid(2024, 1);
    for (let i = 1; i < g.length; i++) {
      expect(g[i].getTime() - g[i - 1].getTime()).toBeGreaterThanOrEqual(23 * 3600_000); // DST days are 23-25h
      expect(g[i].getTime() - g[i - 1].getTime()).toBeLessThanOrEqual(25 * 3600_000);
    }
  });
});

describe("extractTasks", () => {
  const md = ["# Plan", "- [ ] write notes @due(2024-03-15)", "text", "  - [X] done", "* [ ] not a dash bullet", "- [x]"].join("\n");
  it("finds dash checkboxes (any indent, x or X) with 1-based lines", () => {
    expect(extractTasks(md, "/v/a.md")).toEqual([
      { text: "write notes", completed: false, dueDate: "2024-03-15", filePath: "/v/a.md", line: 2 },
      { text: "done", completed: true, dueDate: null, filePath: "/v/a.md", line: 4 },
      { text: "", completed: true, dueDate: null, filePath: "/v/a.md", line: 6 },
    ]);
  });
  it("reads the first @due and strips only the first one from the text (existing behaviour)", () => {
    const [t] = extractTasks("- [ ] x @due(2024-01-01) @due(2024-02-02)", "p");
    expect(t.dueDate).toBe("2024-01-01");
    expect(t.text).toBe("x  @due(2024-02-02)");
  });
  it("returns nothing for content without tasks", () => {
    expect(extractTasks("just text", "p")).toEqual([]);
  });
});

describe("extractFrontmatterDue", () => {
  it("reads a due date, with or without quotes", () => {
    expect(extractFrontmatterDue("---\ndue: 2024-05-01\n---\n")).toBe("2024-05-01");
    expect(extractFrontmatterDue('---\ntitle: x\ndue: "2024-05-01"\n---\n')).toBe("2024-05-01");
  });
  it("is null without frontmatter or with a non-date value", () => {
    expect(extractFrontmatterDue("no frontmatter")).toBeNull();
    expect(extractFrontmatterDue("---\ndue: tomorrow\n---\n")).toBeNull();
  });
});

describe("buildCalendarMonth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("marks today, daily notes, task and note counts, and the current month", () => {
    const cal = buildCalendarMonth(
      2024,
      0,
      new Map([["2024-01-15", "/v/daily/2024-01-15.md"]]),
      new Map([["2024-01-16", 2]]),
      new Map([["2024-01-16", 3]])
    );
    expect(cal).toMatchObject({ year: 2024, month: 0 });
    expect(cal.days).toHaveLength(42);
    const day = (n: number) => cal.days.find((d) => d.isCurrentMonth && d.dayOfMonth === n)!;
    expect(day(15)).toMatchObject({ isToday: true, hasDailyNote: true, dailyNotePath: "/v/daily/2024-01-15.md" });
    expect(day(16)).toMatchObject({ isToday: false, hasDailyNote: false, dailyNotePath: null, taskCount: 2, noteCount: 3 });
    expect(day(20)).toMatchObject({ taskCount: 0, noteCount: 0 });
    expect(cal.days[0].isCurrentMonth).toBe(false); // 31 Dec padding
  });
});

describe("getWeekdayHeaders", () => {
  it("starts on Sunday or Monday", () => {
    expect(getWeekdayHeaders()).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(getWeekdayHeaders(true)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});
