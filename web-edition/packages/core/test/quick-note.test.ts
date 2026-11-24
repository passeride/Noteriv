import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { quickNoteFolder, quickNoteName } from "../src/quick-note";

describe("quickNoteName", () => {
  it("names the note by its first line, without Markdown markers or characters a file name cannot hold", () => {
    expect(quickNoteName("\n\n# Call Ann: re/plan?\nmore", "x")).toBe("Call Ann re plan");
    expect(quickNoteName("- [ ] buy milk", "x")).toBe("buy milk");
    expect(quickNoteName("   \n", "Quick note 2026-10-26 0930")).toBe("Quick note 2026-10-26 0930");
    expect(quickNoteName("a ".repeat(50), "x").length).toBeLessThanOrEqual(60);
    // 60 characters, never half an emoji (which would make the name impossible to encode).
    const emoji = quickNoteName("a" + "\u{1F600}".repeat(70), "x");
    expect(Array.from(emoji)).toHaveLength(60);
    expect(() => encodeURIComponent(emoji)).not.toThrow();
    expect(quickNoteName(" .. hidden", "x")).toBe("hidden");
  });

  it("files into Inbox by default and refuses paths that leave the vault", () => {
    expect(quickNoteFolder(undefined)).toBe("Inbox");
    expect(quickNoteFolder(" /Inbox/Phone/ ")).toBe("Inbox/Phone");
    expect(quickNoteFolder("")).toBe("");
    expect(quickNoteFolder("../x")).toBeNull();
  });

  it("is the same code as the server's copy", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const code = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n").replace(/^(\/\/[^\n]*\n)+\n/, "");
    expect(code("packages/core/src/quick-note.ts")).toBe(code("web/server/src/lib/quickNoteName.ts"));
  });
});
