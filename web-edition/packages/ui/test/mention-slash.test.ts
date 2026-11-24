import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLASH_COMMANDS,
  parseTriggerAtCursor,
  filterSlashCommands,
  filterMentionNotes,
} from "../src/chat/useMentionSlash";

describe("Mention & Slash Commands Logic (Option 2: Smart Mentions & Slash Commands)", () => {
  const sampleNotes = [
    { id: "1", path: "Guides/Architecture.md", name: "Architecture.md" },
    { id: "2", path: "Daily/2026-10-28.md", name: "2026-10-28.md" },
    { id: "3", path: "Ideas/AI-Brain.md", name: "AI-Brain.md" },
    { id: "4", path: "Projects/Noteriv.md", name: "Noteriv.md" },
  ];

  it("provides comprehensive default slash commands with prompts", () => {
    expect(DEFAULT_SLASH_COMMANDS.length).toBeGreaterThanOrEqual(5);
    const commands = DEFAULT_SLASH_COMMANDS.map((c) => c.command);
    expect(commands).toContain("/summarize");
    expect(commands).toContain("/action-items");
    expect(commands).toContain("/brainstorm");
    expect(commands).toContain("/qa");
    expect(commands).toContain("/mindmap");
  });

  it("detects slash command triggers at the start of input or line", () => {
    expect(parseTriggerAtCursor("/sum", 4)).toEqual({
      mode: "slash",
      query: "sum",
    });

    expect(parseTriggerAtCursor("line 1\n/act", 11)).toEqual({
      mode: "slash",
      query: "act",
    });

    // Not a slash command if in the middle of a word or regular path
    expect(parseTriggerAtCursor("http://example.com/test", 23)).toEqual({
      mode: null,
      query: "",
    });
  });

  it("detects mention triggers with @", () => {
    expect(parseTriggerAtCursor("@arch", 5)).toEqual({
      mode: "mention",
      query: "arch",
    });

    expect(parseTriggerAtCursor("Hãy xem ghi chú @note", 22)).toEqual({
      mode: "mention",
      query: "note",
    });

    // Space after @ cancels mention query
    expect(parseTriggerAtCursor("@noteriv and more", 17)).toEqual({
      mode: null,
      query: "",
    });
  });

  it("filters slash commands by name, command or description", () => {
    const sumResults = filterSlashCommands(DEFAULT_SLASH_COMMANDS, "sum");
    expect(sumResults.length).toBe(1);
    expect(sumResults[0].command).toBe("/summarize");

    const actionResults = filterSlashCommands(DEFAULT_SLASH_COMMANDS, "công việc");
    expect(actionResults.length).toBe(1);
    expect(actionResults[0].command).toBe("/action-items");
  });

  it("filters notes by name or path", () => {
    const results = filterMentionNotes(
      sampleNotes,
      "arch",
      (n) => n.name,
      (n) => n.path
    );
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Architecture.md");

    const folderResults = filterMentionNotes(
      sampleNotes,
      "ideas",
      (n) => n.name,
      (n) => n.path
    );
    expect(folderResults.length).toBe(1);
    expect(folderResults[0].path).toBe("Ideas/AI-Brain.md");
  });
});
