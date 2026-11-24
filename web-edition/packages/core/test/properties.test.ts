import { describe, expect, it } from "vitest";
import {
  convertLossless,
  isValidPropertyKey,
  collectVaultProperties,
  propertyTypeOf,
  coerceValue,
  deleteProperty,
  frontmatterBlock,
  inferPropertyType,
  readProperties,
  renamePropertyKey,
  writeProperty,
} from "../src/properties";

const note = [
  "---",
  "title: My plan",
  "tags:",
  "  - chess",
  "  - opening",
  "aliases: [Plan, The plan]",
  "rating: 1500",
  "done: false",
  'quote: "a: b"',
  "due: 2026-10-22",
  "meta:",
  "  owner: me",
  "  nested: true",
  "# a comment",
  "empty:",
  "---",
  "Body text",
].join("\n");

describe("readProperties", () => {
  it("reads scalars, inline and block lists, and keeps what it cannot edit as complex", () => {
    const { properties, hasBlock } = readProperties(note);
    expect(hasBlock).toBe(true);
    expect(Object.fromEntries(properties.map((p) => [p.key, p.complex ? "COMPLEX" : p.value]))).toEqual({
      title: "My plan",
      tags: ["chess", "opening"],
      aliases: ["Plan", "The plan"],
      rating: 1500,
      done: false,
      quote: "a: b",
      due: "2026-10-22",
      meta: "COMPLEX",
      empty: null,
    });
  });

  it("handles a note without front matter and Windows line ends", () => {
    expect(readProperties("Just text").hasBlock).toBe(false);
    expect(readProperties("---\r\ntags:\r\n  - x\r\n---\r\nBody").properties).toEqual([{ key: "tags", value: ["x"], complex: false }]);
  });
});

describe("writeProperty", () => {
  it("changes only that property's lines, keeping everything else as written", () => {
    const next = writeProperty(note, "rating", 1600);
    expect(next).toBe(note.replace("rating: 1500", "rating: 1600"));
  });

  it("writes lists in block form and quotes values that YAML would misread", () => {
    const next = writeProperty(note, "aliases", ["Plan", "[[Other]]", "a: b"]);
    expect(next).toContain('aliases:\n  - Plan\n  - "[[Other]]"\n  - "a: b"\nrating: 1500');
    expect(writeProperty(note, "title", "true")).toContain('title: "true"');
    expect(writeProperty(note, "title", "")).toContain("title:\ntags:");
  });

  it("adds a new property before the closing line, and creates the block when there is none", () => {
    expect(writeProperty(note, "new", "x")).toContain("empty:\nnew: x\n---\nBody text");
    expect(writeProperty("Body", "done", true)).toBe("---\ndone: true\n---\nBody");
    expect(writeProperty("", "done", true)).toBe("---\ndone: true\n---\n");
  });

  it("keeps Windows line ends", () => {
    expect(writeProperty("---\r\na: 1\r\n---\r\nB", "a", 2)).toBe("---\r\na: 2\r\n---\r\nB");
  });
});

describe("deleteProperty and renamePropertyKey", () => {
  it("removes all lines of a property", () => {
    expect(deleteProperty(note, "tags")).not.toMatch(/tags|chess|opening/);
    expect(deleteProperty(note, "meta")).not.toMatch(/owner|nested/);
  });

  it("renames a key keeping its value lines, and refuses to overwrite an existing key", () => {
    const next = renamePropertyKey(note, "tags", "topics");
    expect(next).toContain("topics:\n  - chess\n  - opening");
    expect(renamePropertyKey(note, "tags", "title")).toBe(note);
    expect(renamePropertyKey(note, "missing", "x")).toBe(note);
  });
});

describe("types", () => {
  it("infers a type from the value", () => {
    expect(inferPropertyType("tags", ["a"])).toBe("tags");
    expect(inferPropertyType("x", ["a"])).toBe("list");
    expect(inferPropertyType("x", 3)).toBe("number");
    expect(inferPropertyType("x", true)).toBe("checkbox");
    expect(inferPropertyType("x", "2026-10-22")).toBe("date");
    expect(inferPropertyType("x", "2026-10-22T09:30")).toBe("datetime");
    expect(inferPropertyType("x", "hello")).toBe("text");
  });

  it("coerces input to a type", () => {
    expect(coerceValue("number", "12.5")).toBe(12.5);
    expect(coerceValue("number", "abc")).toBeNull();
    expect(coerceValue("checkbox", "true")).toBe(true);
    expect(coerceValue("list", "a, b")).toEqual(["a", "b"]);
    expect(coerceValue("tags", ["#a", "b"])).toEqual(["a", "b"]);
    expect(coerceValue("text", ["a", "b"])).toBe("a, b");
  });
});

describe("what must never be rewritten (review findings)", () => {
  it("keeps numbers that do not round-trip as text", () => {
    const { properties } = readProperties("---\nzip: 01234\nv: 1.10\nn: 12\n---");
    expect(properties.map((p) => p.value)).toEqual(["01234", "1.10", 12]);
  });

  it("keeps a blank line inside a list or multi-line value with that value", () => {
    const text = "---\ntags:\n  - a\n\n  - b\ndesc: |\n  one\n\n  two\nafter: x\n---";
    expect(readProperties(text).properties.map((p) => [p.key, p.complex ? "C" : p.value])).toEqual([
      ["tags", ["a", "b"]],
      ["desc", "C"],
      ["after", "x"],
    ]);
    expect(deleteProperty(text, "desc")).toBe("---\ntags:\n  - a\n\n  - b\nafter: x\n---");
  });

  it("refuses keys YAML would misread, and leaves an unclosed block alone", () => {
    expect(isValidPropertyKey("my key")).toBe(true);
    expect(isValidPropertyKey("a: b")).toBe(false);
    expect(isValidPropertyKey("#x")).toBe(false);
    expect(writeProperty(note, "a: b", 1)).toBe(note);
    expect(writeProperty("---\nopen: 1\nBody", "x", 1)).toBe("---\nopen: 1\nBody");
    expect(readProperties("---\nopen: 1\nBody").unclosed).toBe(true);
  });

  it("treats a repeated key as read-only after the first and edits only the first", () => {
    const text = "---\na: 1\na: 2\n---";
    expect(readProperties(text).properties).toEqual([
      { key: "a", value: 1, complex: false },
      { key: "a", value: null, complex: true },
    ]);
    expect(writeProperty(text, "a", 5)).toBe("---\na: 5\na: 2\n---");
    expect(deleteProperty(text, "a")).toBe("---\na: 2\n---");
  });

  it("does not take unquoted links, commented items or a BOM apart", () => {
    expect(readProperties("---\nl: [[Note]]\nm:\n  - a # c\n---").properties.map((p) => p.complex)).toEqual([true, true]);
    expect(writeProperty("﻿Body", "x", 1)).toBe("﻿---\nx: 1\n---\nBody");
  });

  it("converts between types only without loss", () => {
    expect(convertLossless("text", "list", "a, b")).toEqual(["a", "b"]);
    expect(convertLossless("number", "text", 3)).toBe("3");
    expect(convertLossless("text", "checkbox", "hello")).toBeNull();
    expect(convertLossless("list", "number", ["3", "x"])).toBeNull();
    expect(convertLossless("list", "text", ["Smith, John"])).toBeNull();
  });
});

describe("collectVaultProperties and propertyTypeOf", () => {
  it("counts each property over the notes, with the vault's type or the most common inferred one", () => {
    const notes = ["---\ndue: 2026-01-01\ntags: [a]\n---", "---\ndue: soon\nrating: 3\n---", "---\ndue: 2026-02-02\n---", "No properties"];
    expect(collectVaultProperties(notes, { rating: "text" })).toEqual([
      { key: "due", count: 3, type: "date" },
      { key: "rating", count: 1, type: "text" },
      { key: "tags", count: 1, type: "tags" },
    ]);
  });

  it("gives tags its own type and otherwise prefers the vault's type", () => {
    expect(propertyTypeOf("tags", "x", { tags: "text" })).toBe("tags");
    expect(propertyTypeOf("due", "soon", { due: "date" })).toBe("date");
    expect(propertyTypeOf("due", "2026-01-01", {})).toBe("date");
  });
});

describe("frontmatterBlock", () => {
  it("returns the block as written, or an empty string", () => {
    expect(frontmatterBlock("---\na: 1\n---\nBody")).toBe("---\na: 1\n---");
    expect(frontmatterBlock("Body")).toBe("");
  });
});
