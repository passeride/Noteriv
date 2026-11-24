import { describe, expect, it } from "vitest";
import { importNotion, parseCsv } from "../src/importers/notion";
import type { InputFile } from "../src/importers/types";
import { readProperties } from "@noteriv/core/properties";
import { parseViewSpec } from "@noteriv/core/views";

const enc = new TextEncoder();
const file = (path: string, text: string): InputFile => ({ path, text: async () => text, bytes: async () => enc.encode(text) });

// A sample laid out like Notion's "Markdown & CSV" export (not a real workspace).
const A = "0123456789abcdef0123456789abcdef";
const B = "fedcba9876543210fedcba9876543210";
const DB = "11112222333344445555666677778888";
const R1 = "aaaabbbbccccddddeeeeffff00001111";
const FILES = [
  file(`Home ${A}.md`, `# Home\n\nSee [Projects](Home%20${A}/Projects%20${B}.md) and [the tasks](Home%20${A}/Tasks%20${DB}.csv).\n\n![Logo](Home%20${A}/logo%20big.png)\n\n[web](https://example.com) [jump](https://www.notion.so/Projects-${B})\n`),
  file(`Home ${A}/Projects ${B}.md`, `# Projects\n\nBack [Home](../Home%20${A}.md).\n`),
  file(`Home ${A}/logo big.png`, "PNG"),
  file(`Home ${A}/Tasks ${DB}.csv`, "Name,Status\nOld view row,Done\n"),
  file(`Home ${A}/Tasks ${DB}_all.csv`, '﻿Name,Status,Tags,Done\nWrite report,In progress,"work, urgent",No\n"Plan, trip",Done,,Yes\n'),
  file(`Home ${A}/Tasks ${DB}/Write report ${R1}.md`, "# Write report\n\nStatus: In progress\nTags: work, urgent\nDone: No\n\nThe body.\n"),
];

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and line breaks inside quotes", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["multi\nline", "2"],
    ]);
  });
});

describe("importNotion", () => {
  it("drops the ids, turns page links into wiki-links and files into attachments", async () => {
    const r = await importNotion(FILES, "Notion");
    expect(r.notes.map((n) => n.path).sort()).toEqual(["Notion/Home.md", "Notion/Home/Projects.md", "Notion/Home/Tasks.md", "Notion/Home/Tasks/Write report.md"]);
    expect(r.attachments.map((a) => a.path)).toEqual(["Notion/_resources/logo-big.png"]);
    const home = r.notes.find((n) => n.path === "Notion/Home.md")!.content;
    expect(home).toBe(
      "# Home\n\nSee [[Notion/Home/Projects]] and [[Notion/Home/Tasks|the tasks]].\n\n![Logo](Notion/_resources/logo-big.png)\n\n[web](https://example.com) [[Notion/Home/Projects|jump]]\n"
    );
    expect(r.notes.find((n) => n.path === "Notion/Home/Projects.md")!.content).toBe("# Projects\n\nBack [[Notion/Home]].\n");
  });

  it("makes a database a folder of notes with properties from the CSV, and a note with a view of them", async () => {
    const r = await importNotion(FILES, "Notion");
    const row = r.notes.find((n) => n.path === "Notion/Home/Tasks/Write report.md")!.content;
    const props = Object.fromEntries(readProperties(row).properties.map((p) => [p.key, p.value]));
    expect(props).toEqual({ Status: "In progress", Tags: ["work", "urgent"], Done: false });
    expect(row.endsWith("---\n# Write report\n\nThe body.\n")).toBe(true);

    const index = r.notes.find((n) => n.path === "Notion/Home/Tasks.md")!.content;
    const spec = parseViewSpec(index.replace(/^```view\n|```\n$/g, ""));
    expect(spec.spec).toMatchObject({ from: ["Notion/Home/Tasks"], layout: "table", columns: ["file", "Status", "Tags", "Done"] });
  });
});

describe("review findings", () => {
  const X = "99998888777766665555444433332222";
  const Y = "12341234123412341234123412341234";
  const D = "abcdabcdabcdabcdabcdabcdabcdabcd";

  it("gives rows with the same title their own properties, and matches the view's columns to them", async () => {
    const r = await importNotion(
      [
        file(`T ${D}.csv`, "Name,Status,Priority #\nA,Done,1\nA,Todo,2\n"),
        file(`T ${D}/A ${X}.md`, "# A\n\nStatus: Done\nPriority #: 1\n\nfirst"),
        file(`T ${D}/A ${Y}.md`, "# A\n\nStatus: Todo\nPriority #: 2\n\nsecond"),
      ],
      "N"
    );
    const props = (p: string) => Object.fromEntries(readProperties(r.notes.find((n) => n.path === p)!.content).properties.map((x) => [x.key, x.value]));
    expect([props("N/T/A.md"), props("N/T/A 2.md")]).toEqual([
      { Status: "Done", Priority: "1" },
      { Status: "Todo", Priority: "2" },
    ]);
    expect(parseViewSpec(r.notes.at(-1)!.content.replace(/^```view\n|```\n$/g, "")).spec?.columns).toEqual(["file", "Status", "Priority"]);
  });

  it("follows links whose names hold parentheses, and leaves taken vault paths alone", async () => {
    const r = await importNotion(
      [file(`Home ${X}.md`, `[d](My%20(draft)%20${Y}.md)`), file(`My (draft) ${Y}.md`, "x")],
      "N",
      { taken: ["N/Home.md"] }
    );
    expect(r.notes.map((n) => n.path)).toEqual(["N/Home 2.md", "N/My (draft).md"]);
    expect(r.notes[0].content).toBe("[[N/My (draft)|d]]");
  });
});
