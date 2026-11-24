import { describe, expect, it } from "vitest";
import {
  extractHeadings,
  generateTocBlock,
  generateTocMarkdown,
  hasTocBlock,
  insertTocPlaceholder,
  renderTocHTML,
  slugify,
  updateTocBlocks,
} from "../src/toc-utils";

describe("slugify", () => {
  it("lower-cases, drops punctuation and joins words with dashes", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("  Many   spaces  ")).toBe("many-spaces");
    expect(slugify("--edge--")).toBe("edge");
  });
  it("drops characters outside [a-z0-9_ -], including accented letters", () => {
    expect(slugify("Khai cuộc Ý")).toBe("khai-cuc");
    expect(slugify("e4 e5 2. Nf3")).toBe("e4-e5-2-nf3");
  });
});

describe("extractHeadings", () => {
  it("finds ATX headings with level, text, slug and 1-based line", () => {
    const md = "# One\ntext\n## Two words\n### Three";
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: "One", slug: "one", line: 1 },
      { level: 2, text: "Two words", slug: "two-words", line: 3 },
      { level: 3, text: "Three", slug: "three", line: 4 },
    ]);
  });
  it("ignores headings inside fenced code blocks (``` and ~~~)", () => {
    const md = "# A\n```\n# not a heading\n```\n~~~\n## also not\n~~~\n## B";
    expect(extractHeadings(md).map((h) => h.text)).toEqual(["A", "B"]);
  });
  it("requires a space after the hashes and ignores 7+ hashes", () => {
    expect(extractHeadings("#nospace\n####### seven\n# ok").map((h) => h.text)).toEqual(["ok"]);
  });
  it("respects min and max level", () => {
    const md = "# a\n## b\n### c\n#### d";
    expect(extractHeadings(md, 2, 3).map((h) => h.text)).toEqual(["b", "c"]);
  });
  it("makes duplicate slugs unique with -1, -2 suffixes", () => {
    const slugs = extractHeadings("# Intro\n## Intro\n### Intro").map((h) => h.slug);
    expect(slugs).toEqual(["intro", "intro-1", "intro-2"]);
  });
  it("returns nothing for text without headings", () => {
    expect(extractHeadings("just text")).toEqual([]);
  });
});

describe("generateTocMarkdown", () => {
  const heads = extractHeadings("## A\n### B\n## C");
  it("indents relative to the shallowest level", () => {
    expect(generateTocMarkdown(heads)).toBe("- [A](#a)\n  - [B](#b)\n- [C](#c)");
  });
  it("can number every item with 1.", () => {
    expect(generateTocMarkdown(heads, true)).toBe("1. [A](#a)\n  1. [B](#b)\n1. [C](#c)");
  });
  it("is empty for no headings", () => {
    expect(generateTocMarkdown([])).toBe("");
  });
});

describe("toc blocks", () => {
  it("generateTocBlock wraps the list in markers", () => {
    expect(generateTocBlock("# A\n## B")).toBe("<!-- toc -->\n- [A](#a)\n  - [B](#b)\n<!-- /toc -->");
  });
  it("hasTocBlock looks for the opening marker only", () => {
    expect(hasTocBlock("x <!-- toc --> y")).toBe(true);
    expect(hasTocBlock("# no toc")).toBe(false);
  });
  it("updateTocBlocks rewrites an existing block with fresh headings", () => {
    const stale = "<!-- toc -->\n- [Old](#old)\n<!-- /toc -->\n\n# New\n## Child";
    const updated = updateTocBlocks(stale);
    expect(updated).toContain("- [New](#new)\n  - [Child](#child)");
    expect(updated).not.toContain("Old");
  });
  it("updateTocBlocks leaves content without a block untouched", () => {
    const md = "# A\ntext";
    expect(updateTocBlocks(md)).toBe(md);
  });
  it("insertTocPlaceholder is the literal [TOC]", () => {
    expect(insertTocPlaceholder()).toBe("[TOC]");
  });
});

describe("renderTocHTML", () => {
  it("is empty without headings", () => {
    expect(renderTocHTML("text")).toBe("");
  });
  it("renders linked, indented items and escapes heading text", () => {
    const html = renderTocHTML("# A < B\n## Child");
    expect(html).toContain('<nav class="toc-block"');
    expect(html).toContain('href="#a-b"'); // "<" is dropped and the two spaces collapse into one dash
    expect(html).toContain("A &lt; B");
    expect(html).toContain("margin-left:0px");
    expect(html).toContain("margin-left:16px");
  });
});
