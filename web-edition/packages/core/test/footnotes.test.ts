import { describe, expect, it } from "vitest";
import { listFootnotes } from "../src/footnotes";

describe("listFootnotes", () => {
  it("lists footnotes by first reference, with their definitions and every reference", () => {
    const note = [
      "Intro[^b] and more[^a].", // 0
      "Again[^b].", // 1
      "", // 2
      "[^a]: First note.", // 3
      "[^b]: Second note", // 4
      "    goes on here.", // 5
    ].join("\n");
    expect(listFootnotes(note)).toEqual([
      { id: "b", text: "Second note goes on here.", definition: { line: 4, ch: 0 }, refs: [{ line: 0, ch: 5 }, { line: 1, ch: 5 }] },
      { id: "a", text: "First note.", definition: { line: 3, ch: 0 }, refs: [{ line: 0, ch: 18 }] },
    ]);
  });

  it("marks a reference without a definition and a definition nothing refers to", () => {
    const list = listFootnotes("See[^gone].\n\n[^spare]: Not used.");
    expect(list.map((f) => [f.id, f.text, f.refs.length])).toEqual([
      ["gone", null, 1],
      ["spare", "Not used.", 0],
    ]);
  });

  it("includes inline footnotes where they are, and skips front matter and code", () => {
    const note = ["---", "x: '[^fm]'", "---", "A^[inline text] and[^1].", "```", "[^code]", "```", "`[^span]`", "[^1]: One"].join("\n");
    const list = listFootnotes(note);
    expect(list.map((f) => f.id)).toEqual([null, "1"]);
    expect(list[0]).toEqual({ id: null, text: "inline text", definition: { line: 3, ch: 1 }, refs: [{ line: 3, ch: 1 }] });
  });

  it("reads CRLF notes and keeps the first of two definitions of a label", () => {
    const list = listFootnotes("x[^1]\r\n\r\n[^1]: first\r\n[^1]: second\r\n");
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe("first");
  });
});

describe("review findings", () => {
  it("reads definitions in quotes, lists and indented, and references just before a colon", () => {
    const list = listFootnotes("A[^q] B[^l] C[^s]: and so on.\n\n> [^q]: In a quote\n- [^l]: In a list\n   [^s]: Indented");
    expect(list.map((f) => [f.id, f.text, f.definition?.ch, f.refs.length])).toEqual([
      ["q", "In a quote", 2, 1],
      ["l", "In a list", 2, 1],
      ["s", "Indented", 3, 1],
    ]);
  });

  it("keeps brackets inside an inline footnote, and paragraphs of a definition after a blank line", () => {
    expect(listFootnotes("x^[see [[Note]] here] y")[0].text).toBe("see [[Note]] here");
    expect(listFootnotes("x[^a]\n\n[^a]: para one\n\n    para two\nNext")[0].text).toBe("para one para two");
  });

  it("does not close a fence on ```js, and skips URLs, escapes and a BOM", () => {
    const note = "```\n```js\n[^b]\n```\nafter[^c]\n\n[^c]: C";
    expect(listFootnotes(note).map((f) => f.id)).toEqual(["c"]);
    expect(listFootnotes("[link](https://e.com/[^a]) \\[^b] <https://x.y/[^c]>")).toEqual([]);
    expect(listFootnotes("﻿[^a]: def")[0]).toMatchObject({ id: "a", text: "def", definition: { line: 0, ch: 1 } });
  });
});
