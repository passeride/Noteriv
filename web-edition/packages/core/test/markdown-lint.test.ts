import { describe, expect, it } from "vitest";
import { lintMarkdown } from "../src/markdown-lint";

const rules = (md: string, files?: string[]) => lintMarkdown(md, "/v", files).map((w) => w.rule);

describe("lintMarkdown", () => {
  it("has nothing to say about empty or whitespace-only content", () => {
    expect(lintMarkdown("", "/v")).toEqual([]);
    expect(lintMarkdown("  \n\n", "/v")).toEqual([]);
  });

  it("is quiet for a clean note", () => {
    expect(lintMarkdown("# Title\n\nSome text with a [[Note]].\n", "/v", ["Note"])).toEqual([]);
  });

  it("reports a missing H1 as info on line 1", () => {
    expect(lintMarkdown("## Sub\ntext", "/v")).toEqual([
      { line: 1, column: 1, type: "info", message: "Document has no H1 heading", rule: "missing-title" },
    ]);
  });

  it("flags an empty heading (warning at column level+1)", () => {
    const w = lintMarkdown("# Title\n##", "/v");
    expect(w).toEqual([{ line: 2, column: 3, type: "warning", message: "Empty heading", rule: "empty-heading" }]);
  });

  it("flags duplicate headings of the same level, case-insensitively, pointing at the first one", () => {
    const w = lintMarkdown("# A\n## B\n## b\n### B", "/v");
    expect(w).toEqual([
      { line: 3, column: 1, type: "warning", message: 'Duplicate heading "b" (same as line 2)', rule: "duplicate-heading" },
    ]);
  });

  it("checks wiki-links only when a file list is given", () => {
    const md = "# T\n[[Exists]] [[Missing|alias]]";
    expect(rules(md)).toEqual([]);
    expect(lintMarkdown(md, "/v", ["exists"])).toEqual([
      { line: 2, column: 12, type: "error", message: "Broken wiki-link: [[Missing]]", rule: "broken-wikilink" },
    ]);
  });

  it("matches wiki-link targets case-insensitively", () => {
    expect(rules("# T\n[[ITALIAN]]", ["Italian"])).toEqual([]);
  });

  it("reports repeated tags as info, with the first line", () => {
    const w = lintMarkdown("# T\ntext #chess and #Chess", "/v");
    expect(w).toEqual([
      { line: 2, column: 16, type: "info", message: "Duplicate tag #Chess (first used on line 2)", rule: "duplicate-tag" },
    ]);
  });

  it("flags an unclosed code fence at the line of the last opening fence", () => {
    const w = lintMarkdown("# T\n```js\ncode", "/v");
    expect(w).toEqual([{ line: 2, column: 1, type: "error", message: "Unclosed code block", rule: "unclosed-code-block" }]);
  });

  it("ignores everything inside a closed code block", () => {
    expect(lintMarkdown("# T\n```\n# fake\n[[nothing]]\n#tag #tag\n```", "/v", [])).toEqual([]);
  });

  it("flags only empty or '.' local image paths, not URLs or ordinary files", () => {
    expect(rules("# T\n![a](.)", [])).toEqual(["broken-image"]);
    expect(lintMarkdown("# T\n![a]( )", "/v")[0].message).toBe("Broken image path: (empty)");
    expect(rules("# T\n![a](https://x.test/y.png) ![b](data:image/png;base64,AAA) ![c](img/pic.png)")).toEqual([]);
  });

  it("sorts errors first, then warnings, then info, each by line", () => {
    const w = lintMarkdown("## sub\n[[Missing]]\n## Sub", "/v", []);
    expect(w.map((x) => `${x.type}:${x.rule}:${x.line}`)).toEqual([
      "error:broken-wikilink:2",
      "warning:duplicate-heading:3",
      "info:missing-title:1",
    ]);
  });

  // Quirk kept on purpose (both apps behaved this way): the heading pattern uses \s*, so a line that
  // starts with "#tag" counts as an H1 titled "tag", which also satisfies the "has H1" check.
  it("treats a line starting with #word as a heading (existing behaviour)", () => {
    expect(rules("#chess opening notes")).toEqual([]); // no "missing H1" warning: that line is the H1
    expect(lintMarkdown("#chess\n#chess", "/v").map((w) => w.rule).sort()).toEqual(["duplicate-heading", "duplicate-tag"]);
  });
});
