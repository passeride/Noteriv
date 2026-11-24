import { describe, expect, it } from "vitest";
// Quick note (stage 4, session 4.7): the server's naming rules and the sign-in redirect. Both modules have no imports.
import { quickNoteFolder, quickNoteName } from "../../../web/server/src/lib/quickNoteName";
import { safeNext } from "../../../web/src/lib/safe-next";

describe("quickNoteName", () => {
  it("uses the first non-empty line without Markdown markers", () => {
    expect(quickNoteName("\n\n# Call the bank\nabout the card", "x")).toBe("Call the bank");
    expect(quickNoteName("- [ ] buy milk", "x")).toBe("buy milk");
    expect(quickNoteName("> a quote", "x")).toBe("a quote");
    expect(quickNoteName("1. first", "x")).toBe("first");
  });

  it("replaces characters a file name or a link cannot hold", () => {
    expect(quickNoteName("a/b: c? [[d]] #e", "x")).toBe("a b c d e");
    expect(quickNoteName("...hidden", "x")).toBe("hidden");
  });

  it("cuts long lines at a word when it can", () => {
    const name = quickNoteName("word ".repeat(30), "x");
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith("word")).toBe(true);
    expect(quickNoteName("x".repeat(80), "y")).toHaveLength(60);
  });

  it("falls back when there is nothing usable", () => {
    expect(quickNoteName("   \n  ", "Ghi nhanh 2026-10-18 1530")).toBe("Ghi nhanh 2026-10-18 1530");
    expect(quickNoteName("###", "Quick note 2026-10-18 1530")).toBe("Quick note 2026-10-18 1530");
    expect(quickNoteName("", "")).toBe("Quick note");
  });
});

describe("quickNoteFolder", () => {
  it("defaults to Inbox and normalises slashes", () => {
    expect(quickNoteFolder(undefined)).toBe("Inbox");
    expect(quickNoteFolder(" /Inbox/Phone/ ")).toBe("Inbox/Phone");
    expect(quickNoteFolder("Inbox\\Phone")).toBe("Inbox/Phone");
    expect(quickNoteFolder("/")).toBe("");
  });

  it("refuses paths that leave the vault or cannot be folder names", () => {
    expect(quickNoteFolder("../secret")).toBeNull();
    expect(quickNoteFolder("a//b")).toBeNull();
    expect(quickNoteFolder("a/./b")).toBeNull();
    expect(quickNoteFolder("bad:name")).toBeNull();
  });
});

describe("safeNext", () => {
  it("accepts a path on this site", () => {
    expect(safeNext("/quick")).toBe("/quick");
    expect(safeNext("/vaults/abc?x=1")).toBe("/vaults/abc?x=1");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of [null, "", "quick", "//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/a\nb"]) {
      expect(safeNext(bad)).toBe("/vaults");
    }
  });
});
