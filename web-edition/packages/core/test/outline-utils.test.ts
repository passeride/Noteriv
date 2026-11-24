import { describe, expect, it } from "vitest";
import { extractOutline } from "../src/outline-utils";

describe("extractOutline", () => {
  it("returns level, text and 1-based line for each heading", () => {
    expect(extractOutline("# One\ntext\n## Two\n###### Six")).toEqual([
      { level: 1, text: "One", line: 1 },
      { level: 2, text: "Two", line: 3 },
      { level: 6, text: "Six", line: 4 },
    ]);
  });
  it("skips headings inside fenced code blocks", () => {
    expect(extractOutline("```\n# not a heading\n```\n# real")).toEqual([{ level: 1, text: "real", line: 4 }]);
  });
  it("drops a closing # sequence but keeps inner ones", () => {
    expect(extractOutline("## Title ##\n# C# notes")).toEqual([
      { level: 2, text: "Title", line: 1 },
      { level: 1, text: "C# notes", line: 2 },
    ]);
  });
  it("needs a space after the hashes, at most six hashes, and a non-empty text", () => {
    expect(extractOutline("#tag\n####### seven\n# \n#")).toEqual([]);
  });
  it("handles empty input", () => {
    expect(extractOutline("")).toEqual([]);
  });
});
