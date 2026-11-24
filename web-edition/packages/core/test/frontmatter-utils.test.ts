import { describe, expect, it } from "vitest";
import { hasFrontmatter, parseFrontmatter, serializeFrontmatter, splitFrontmatter, updateFrontmatter } from "../src/frontmatter-utils";

describe("splitFrontmatter", () => {
  it("splits the block off exactly as written, so the two parts give the content back", () => {
    const doc = '---\ncanvas: true\n---\n{"nodes":[]}';
    expect(splitFrontmatter(doc)).toEqual({ frontmatter: "---\ncanvas: true\n---\n", body: '{"nodes":[]}' });
    const crlf = "---\r\ndrawing: true\r\n---\r\n{}";
    const parts = splitFrontmatter(crlf);
    expect(parts.body).toBe("{}");
    expect(parts.frontmatter + parts.body).toBe(crlf);
  });
  it("returns everything as body when there is no block", () => {
    expect(splitFrontmatter('{"nodes":[]}')).toEqual({ frontmatter: "", body: '{"nodes":[]}' });
    expect(splitFrontmatter("")).toEqual({ frontmatter: "", body: "" });
  });
});

// These tests pin down the behaviour both apps relied on before the module moved to core.

describe("hasFrontmatter", () => {
  it("detects a block at the start", () => {
    expect(hasFrontmatter("---\ntitle: a\n---\nbody")).toBe(true);
  });
  it("ignores leading whitespace", () => {
    expect(hasFrontmatter("\n\n---\ntitle: a\n---\n")).toBe(true);
  });
  it("is false when the delimiter is not at the start or is unclosed", () => {
    expect(hasFrontmatter("text\n---\ntitle: a\n---")).toBe(false);
    expect(hasFrontmatter("---\ntitle: a\n")).toBe(false);
    expect(hasFrontmatter("")).toBe(false);
  });
  it("handles CRLF line endings", () => {
    expect(hasFrontmatter("---\r\ntitle: a\r\n---\r\n")).toBe(true);
  });
});

describe("parseFrontmatter", () => {
  it("returns null without a block", () => {
    expect(parseFrontmatter("# Heading")).toBeNull();
  });
  it("parses key/value pairs, the raw block and the body", () => {
    const r = parseFrontmatter("---\ntitle: Opening\nrating: 1800\n---\n# Body\ntext");
    expect(r).not.toBeNull();
    expect(r!.properties).toEqual({ title: "Opening", rating: "1800" });
    expect(r!.raw).toBe("---\ntitle: Opening\nrating: 1800\n---");
    expect(r!.body).toBe("# Body\ntext");
  });
  it("strips the brackets of single-line lists and keeps the items as text", () => {
    const r = parseFrontmatter("---\ntags: [chess, endgame]\n---\n");
    expect(r!.properties.tags).toBe("chess, endgame");
  });
  it("skips blank lines, comments and lines without a colon; keeps colons inside values", () => {
    const r = parseFrontmatter("---\n# comment\n\nnotakey\nurl: https://x.test/a:b\n---\n");
    expect(r!.properties).toEqual({ url: "https://x.test/a:b" });
  });
  it("tolerates leading whitespace before the block", () => {
    const r = parseFrontmatter("\n  \n---\na: 1\n---\nrest");
    expect(r!.properties).toEqual({ a: "1" });
    expect(r!.body).toBe("rest");
  });
  it("parses an empty block as no properties", () => {
    const r = parseFrontmatter("---\n\n---\nbody");
    expect(r!.properties).toEqual({});
  });
});

describe("serializeFrontmatter", () => {
  it("writes an empty block for no properties", () => {
    expect(serializeFrontmatter({})).toBe("---\n---");
  });
  it("writes plain properties as key: value", () => {
    expect(serializeFrontmatter({ title: "A", n: "2" })).toBe("---\ntitle: A\nn: 2\n---");
  });
  it("formats tags and aliases as YAML lists, trimming and dropping empty items", () => {
    expect(serializeFrontmatter({ tags: " a, b ,, c " })).toBe("---\ntags: [a, b, c]\n---");
    expect(serializeFrontmatter({ aliases: "x" })).toBe("---\naliases: [x]\n---");
  });
  it("falls back to a plain value when a list key has no items", () => {
    expect(serializeFrontmatter({ tags: " , " })).toBe("---\ntags:  , \n---");
  });
});

describe("updateFrontmatter", () => {
  it("replaces an existing block and keeps the body", () => {
    expect(updateFrontmatter("---\nold: 1\n---\nBody", { new: "2" })).toBe("---\nnew: 2\n---\nBody");
  });
  it("prepends a block to content that has none, dropping leading whitespace", () => {
    expect(updateFrontmatter("\n\nHello", { a: "1" })).toBe("---\na: 1\n---\nHello");
  });
  it("writes just the block plus a newline for empty content", () => {
    expect(updateFrontmatter("", { a: "1" })).toBe("---\na: 1\n---\n");
    expect(updateFrontmatter("   \n", { a: "1" })).toBe("---\na: 1\n---\n");
  });
  it("round-trips: parse(update(x)) gives the properties back", () => {
    const out = updateFrontmatter("text", { title: "T", tags: "a, b" });
    const back = parseFrontmatter(out);
    expect(back!.properties).toEqual({ title: "T", tags: "a, b" });
    expect(back!.body).toBe("text");
  });
});
