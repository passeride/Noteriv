import { describe, expect, it } from "vitest";
import { anchorLine, extractEmbed, parseLinkTarget, stripBlockIds } from "../src/note-embed";

const note = [
  "---",
  "tags: [a]",
  "---",
  "# Title",
  "Intro line.",
  "",
  "## Goals",
  "Win more. ^goal",
  "",
  "### Detail",
  "Deep.",
  "",
  "## Next",
  "- one",
  "  - one child",
  "- two ^item2",
  "- three",
  "",
  "A paragraph",
  "on two lines.",
  "^para",
  "",
  "```",
  "## Not a heading",
  "```",
].join("\n");

describe("parseLinkTarget", () => {
  it("splits note, heading, block and alias", () => {
    expect(parseLinkTarget("Plan#Goals|g")).toEqual({ note: "Plan", heading: "Goals", block: null, alias: "g" });
    expect(parseLinkTarget("folder/Plan.md#^abc")).toEqual({ note: "folder/Plan.md", heading: null, block: "abc", alias: null });
    expect(parseLinkTarget("#Goals")).toEqual({ note: "", heading: "Goals", block: null, alias: null });
    expect(parseLinkTarget(" Plan ")).toEqual({ note: "Plan", heading: null, block: null, alias: null });
  });
});

describe("extractEmbed", () => {
  it("takes the whole note without its front matter", () => {
    expect(extractEmbed(note, { heading: null, block: null })?.startsWith("# Title\nIntro line.")).toBe(true);
  });

  it("takes a heading's section, down to the next heading of the same or a higher level", () => {
    expect(extractEmbed(note, { heading: "goals", block: null })).toBe("## Goals\nWin more. ^goal\n\n### Detail\nDeep.\n");
  });

  it("ignores headings inside code blocks and returns null for a missing anchor", () => {
    expect(extractEmbed(note, { heading: "Not a heading", block: null })).toBeNull();
    expect(extractEmbed(note, { heading: null, block: "nope" })).toBeNull();
  });

  it("takes the block an id marks: a paragraph line, a list item with its children, or the block above a lone marker", () => {
    expect(extractEmbed(note, { heading: null, block: "goal" })).toBe("Win more. ^goal");
    expect(extractEmbed(note, { heading: null, block: "item2" })).toBe("- two ^item2");
    expect(extractEmbed(note, { heading: null, block: "para" })).toBe("A paragraph\non two lines.");
  });
});

describe("extractEmbed – block ids written apart", () => {
  it("takes the block above a lone marker separated by a blank line, a whole code block, and a whole paragraph", () => {
    const text = "- a\n- b\n\n^list\n\n```js\nx()\n```\n^code\n\nFirst line\nlast line ^p\n\n## C#\nsharp";
    expect(extractEmbed(text, { heading: null, block: "list" })).toBe("- a\n- b");
    expect(extractEmbed(text, { heading: null, block: "code" })).toBe("```js\nx()\n```");
    expect(extractEmbed(text, { heading: null, block: "p" })).toBe("First line\nlast line ^p");
    expect(extractEmbed(text, { heading: "C#", block: null })).toBe("## C#\nsharp");
  });
});

describe("anchorLine", () => {
  it("gives the 1-based line of a heading or block, or null", () => {
    expect(anchorLine(note, { heading: "Next", block: null })).toBe(13);
    expect(anchorLine(note, { heading: null, block: "item2" })).toBe(16);
    expect(anchorLine(note, { heading: null, block: "para" })).toBe(19);
    expect(anchorLine(note, { heading: "Missing", block: null })).toBeNull();
  });
});

describe("stripBlockIds", () => {
  it("removes block id markers but leaves other carets alone", () => {
    expect(stripBlockIds("Win more. ^goal\n^para\nx^2 is fine")).toBe("Win more.\n\nx^2 is fine");
  });
});
