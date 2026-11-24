import { describe, expect, it } from "vitest";
import { formatCell, isViewFile, parseViewSpec, runView, setViewLayout, viewFileSettings, VIEW_FILE_TEMPLATE, type ViewNote } from "../src/views";

const notes: ViewNote[] = [
  { path: "Projects/Alpha.md", properties: { status: "active", due: "2026-11-01", rating: 4, tags: ["work"] }, created: 1, modified: 5 },
  { path: "Projects/Beta.md", properties: { status: "done", due: "2026-10-01", rating: 2, tags: ["work", "old"] }, created: 2, modified: 4 },
  { path: "Projects/Gamma.md", properties: { status: "active", rating: 5 }, created: 3, modified: 3 },
  { path: "Personal/Delta.md", properties: { status: "active", tags: ["home"] }, created: 4, modified: 2 },
  { path: "Inbox.md", properties: {}, created: 5, modified: 1 },
];

describe("parseViewSpec", () => {
  it("reads the block's settings with defaults", () => {
    expect(parseViewSpec("from: Projects\nwhere: status != done\nlayout: cards\ncolumns: [file, status]\nsort: rating desc\nlimit: 2")).toEqual({
      spec: {
        from: ["Projects"],
        where: [{ field: "status", op: "!=", value: "done" }],
        layout: "cards",
        columns: ["file", "status"],
        sort: [{ field: "rating", desc: true }],
        group: null,
        limit: 2,
      },
    });
    expect(parseViewSpec("")).toEqual({
      spec: { from: [], where: [], layout: "table", columns: ["file"], sort: [], group: null, limit: null },
    });
  });

  it("accepts several conditions, tags as sources, and reports mistakes", () => {
    const { spec } = parseViewSpec('from: ["#work", Personal]\nwhere:\n  - rating >= 3\n  - "tags contains work"\n  - due exists') as { spec: NonNullable<ReturnType<typeof parseViewSpec>["spec"]> };
    expect(spec.from).toEqual(["#work", "Personal"]);
    expect(spec.where).toEqual([
      { field: "rating", op: ">=", value: 3 },
      { field: "tags", op: "contains", value: "work" },
      { field: "due", op: "exists", value: null },
    ]);
    expect(parseViewSpec("layout: pie")).toEqual({ error: "layout" });
    expect(parseViewSpec("where: rating >>> 3")).toEqual({ error: "where" });
    expect(parseViewSpec("layout: kanban")).toEqual({ error: "group" });
  });
});

describe("runView", () => {
  const run = (text: string) => {
    const parsed = parseViewSpec(text);
    if (!parsed.spec) throw new Error(parsed.error);
    return runView(parsed.spec, notes);
  };

  it("filters by folder or tag and conditions, then sorts", () => {
    const r = run("from: Projects\nwhere: status = active\nsort: rating desc\ncolumns: [file, rating]");
    expect(r.groups).toEqual([{ key: null, rows: [notes[2], notes[0]] }]);
    expect(r.total).toBe(2);
    expect(run("from: \"#work\"\nsort: file.name").groups[0].rows.map((n) => n.path)).toEqual(["Projects/Alpha.md", "Projects/Beta.md"]);
  });

  it("compares numbers, dates and missing values sensibly", () => {
    expect(run("where: rating > 3").groups[0].rows.map((n) => n.path)).toEqual(["Projects/Alpha.md", "Projects/Gamma.md"]);
    expect(run("where: due < 2026-10-15").groups[0].rows.map((n) => n.path)).toEqual(["Projects/Beta.md"]);
    expect(run("where: due !exists").total).toBe(3);
    expect(run("sort: due").groups[0].rows.map((n) => n.path).slice(0, 2)).toEqual(["Projects/Beta.md", "Projects/Alpha.md"]);
  });

  it("groups by a property (missing values last) and applies the limit after sorting", () => {
    const r = run("group: status\nsort: file.name");
    expect(r.groups.map((g) => [g.key, g.rows.length])).toEqual([
      ["active", 3],
      ["done", 1],
      [null, 1],
    ]);
    expect(run("sort: file.created desc\nlimit: 2").groups[0].rows.map((n) => n.path)).toEqual(["Inbox.md", "Personal/Delta.md"]);
  });
});

describe("review findings", () => {
  const extra: ViewNote[] = [
    { path: "a.md", properties: { "trạng_thái": "xong", priority: 0, tags: ["project/a"] }, created: 0, modified: 0 },
    { path: "b.md", properties: { tags: [] }, created: 0, modified: 0 },
    { path: "c.md", properties: { priority: 2, tags: ["project"] }, created: 0, modified: 0 },
  ];
  const run = (text: string) => {
    const parsed = parseViewSpec(text);
    if (!parsed.spec) throw new Error(parsed.error);
    return runView(parsed.spec, extra).groups[0].rows.map((n) => n.path);
  };

  it("accepts field names with accents", () => {
    expect(run("where: trạng_thái = xong")).toEqual(["a.md"]);
  });

  it("does not take a missing field for 0, and != keeps notes without it", () => {
    expect(run("where: priority = 0")).toEqual(["a.md"]);
    expect(run("where: priority != 0")).toEqual(["b.md", "c.md"]);
  });

  it("matches nested tags with contains, and keeps empty lists last when sorting descending", () => {
    expect(run('where: tags contains project')).toEqual(["a.md", "c.md"]);
    expect(run("sort: tags desc")).toEqual(["a.md", "c.md", "b.md"]);
  });
});

describe("formatCell", () => {
  it("shows values as text", () => {
    expect(formatCell(notes[0], "file")).toBe("Alpha");
    expect(formatCell(notes[0], "file.folder")).toBe("Projects");
    expect(formatCell(notes[0], "tags")).toBe("work");
    expect(formatCell(notes[1], "tags")).toBe("work, old");
    expect(formatCell(notes[2], "due")).toBe("");
  });
});

describe("view files", () => {
  const web = "---\nview: true\n---\nfrom: Projects\nlayout: table\n";

  it("knows a .view file and a note marked view: true, and nothing else", () => {
    expect(isViewFile({ path: "Tasks.view", content: "from: Projects" })).toBe(true);
    expect(isViewFile({ path: "Tasks.md", content: web })).toBe(true);
    expect(isViewFile({ path: "Tasks.md", content: "---\nview: false\n---\nx" })).toBe(false);
    expect(isViewFile({ path: "Tasks.md", content: "---\nviewer: true\n---\nx" })).toBe(false);
    expect(isViewFile({ path: "Tasks.md", content: "view: true" })).toBe(false);
  });

  it("reads the settings after the front matter, the same as a ```view block", () => {
    expect(viewFileSettings(web)).toBe("from: Projects\nlayout: table\n");
    expect(viewFileSettings("from: Projects")).toBe("from: Projects");
    expect(viewFileSettings(web.replace(/\n/g, "\r\n"))).toBe("from: Projects\r\nlayout: table\r\n");
    const parsed = parseViewSpec(VIEW_FILE_TEMPLATE);
    expect(parsed.error).toBeUndefined();
    expect(parsed.spec?.columns).toEqual(["file", "status", "tags"]);
  });

  it("changes the layout setting, or adds it, keeping the rest", () => {
    expect(setViewLayout(web, "cards")).toBe("---\nview: true\n---\nfrom: Projects\nlayout: cards\n");
    expect(setViewLayout("from: Projects", "list")).toBe("from: Projects\nlayout: list\n");
    expect(setViewLayout("", "list")).toBe("layout: list\n");
    expect(setViewLayout("from: x\r\n", "kanban")).toBe("from: x\r\nlayout: kanban\r\ngroup: status\r\n");
    // A line that only mentions layout further in is not the setting.
    expect(setViewLayout("where: layout = x\nlayout: table", "cards")).toBe("where: layout = x\nlayout: cards");
  });

  it("review findings: kanban gets a group, every layout line changes, BOM, CRLF, front matter in a .view file", () => {
    expect(setViewLayout(VIEW_FILE_TEMPLATE, "kanban")).toContain("layout: kanban\n");
    expect(setViewLayout(VIEW_FILE_TEMPLATE, "kanban")).toContain("group: status\n");
    expect(parseViewSpec(setViewLayout("columns: [file, stage]", "kanban")).spec?.group).toBe("stage");
    expect(setViewLayout("layout: table\ngroup: area", "kanban")).toBe("layout: kanban\ngroup: area");
    expect(setViewLayout("layout: table\nlayout: list", "cards")).toBe("layout: cards\nlayout: cards");
    expect(setViewLayout("from: x\r\nlayout: table\r\n", "list")).toBe("from: x\r\nlayout: list\r\n");
    const bom = "﻿---\nview: true\n---\nlayout: list";
    expect(isViewFile({ path: "T.md", content: bom })).toBe(true);
    expect(viewFileSettings(bom)).toBe("layout: list");
    expect(viewFileSettings("---\ntags: x\n---\nfrom: Projects")).toBe("from: Projects");
    expect(isViewFile({ path: "T.md", content: '---\nview: "true"\n---\nx' })).toBe(false);
  });
});
