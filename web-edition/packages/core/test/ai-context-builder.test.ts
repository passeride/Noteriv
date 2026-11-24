import { describe, it, expect } from "vitest";
import {
  buildPromptWithContext,
  parsePromptContext,
  buildSystemPrompt,
} from "../src/ai-context-builder";
import type { AiContextRef } from "../src/ai-types";

describe("AI Context Builder (Zero Context Bloat)", () => {
  it("returns original prompt unchanged when context is empty", () => {
    const prompt = "Can you help me summarize this?";
    expect(buildPromptWithContext(prompt)).toBe(prompt);
    expect(buildPromptWithContext(prompt, {})).toBe(prompt);
  });

  it("injects active note reference as XML pointer", () => {
    const prompt = "Summarize the key points.";
    const ctx: AiContextRef = {
      activeNote: { path: "Projects/Roadmap.md", title: "Product Roadmap" },
    };
    const res = buildPromptWithContext(prompt, ctx);
    expect(res).toContain("Summarize the key points.");
    expect(res).toContain('<context>');
    expect(res).toContain('<active_note path="Projects/Roadmap.md" title="Product Roadmap" />');
    expect(res).toContain('</context>');
  });

  it("injects editor selection enclosed in CDATA block", () => {
    const prompt = "Rewrite this paragraph in a more concise tone.";
    const ctx: AiContextRef = {
      selection: {
        path: "Drafts/Post.md",
        text: "This is a very long and overly verbose sentence that could be shortened.",
        startLine: 12,
        endLine: 15,
      },
    };
    const res = buildPromptWithContext(prompt, ctx);
    expect(res).toContain('<editor_selection path="Drafts/Post.md" lines="12-15">');
    expect(res).toContain('<![CDATA[This is a very long and overly verbose sentence that could be shortened.]]>');
    expect(res).toContain('</editor_selection>');
  });

  it("injects @mentioned notes into mentioned_notes block", () => {
    const prompt = "Compare these two plans.";
    const ctx: AiContextRef = {
      mentionedNotes: [
        { path: "PlanA.md", title: "Plan A" },
        { path: "PlanB.md", title: "Plan B" },
      ],
    };
    const res = buildPromptWithContext(prompt, ctx);
    expect(res).toContain('<mentioned_notes>');
    expect(res).toContain('<note path="PlanA.md" title="Plan A" />');
    expect(res).toContain('<note path="PlanB.md" title="Plan B" />');
  });

  it("parses prompt context back from formatted string", () => {
    const prompt = "Please check the spelling.";
    const ctx: AiContextRef = {
      activeNote: { path: "Essay.md", title: "My Essay" },
      selection: {
        path: "Essay.md",
        text: "Teh quick brown fox.",
        startLine: 5,
        endLine: 5,
      },
      cursor: {
        path: "Essay.md",
        line: 5,
      },
    };
    const formatted = buildPromptWithContext(prompt, ctx);
    const parsed = parsePromptContext(formatted);

    expect(parsed.cleanPrompt).toBe("Please check the spelling.");
    expect(parsed.context.activeNote?.path).toBe("Essay.md");
    expect(parsed.context.activeNote?.title).toBe("My Essay");
    expect(parsed.context.selection?.text).toBe("Teh quick brown fox.");
    expect(parsed.context.selection?.startLine).toBe(5);
    expect(parsed.context.cursor?.line).toBe(5);
  });

  it("builds system prompt with persona, guidelines and memory", () => {
    const sys = buildSystemPrompt({
      customInstructions: "Always answer in Vietnamese.",
      memoryContent: "User prefers concise bullet points.",
    });

    expect(sys).toContain("Noteriv AI");
    expect(sys).toContain("vault_overview");
    expect(sys).toContain("User prefers concise bullet points.");
  });

  it("injects and parses comprehensive vault overview map", () => {
    const prompt = "vault có bao nhiêu file?";
    const ctx: AiContextRef = {
      vaultOverview: {
        name: "Perf 2000",
        totalNotes: 3,
        folders: ["Openings", "Tactics"],
        notes: [
          { path: "Openings/Note 001 tốt.md", name: "Note 001 tốt" },
          { path: "Tactics/Pin.md", name: "Pin" },
          { path: "Tactics/Fork.md", name: "Fork" },
        ],
      },
      activeNote: {
        path: "Openings/Note 001 tốt.md",
        title: "Note 001 tốt",
        content: "# Giới thiệu cờ vua",
      },
    };

    const formatted = buildPromptWithContext(prompt, ctx);
    expect(formatted).toContain('<vault_overview name="Perf 2000" total_notes="3">');
    expect(formatted).toContain('<folder path="Openings" />');
    expect(formatted).toContain('<note path="Openings/Note 001 tốt.md" name="Note 001 tốt" />');
    expect(formatted).toContain('<![CDATA[\n# Giới thiệu cờ vua\n]]>');

    const parsed = parsePromptContext(formatted);
    expect(parsed.cleanPrompt).toBe("vault có bao nhiêu file?");
    expect(parsed.context.vaultOverview?.name).toBe("Perf 2000");
    expect(parsed.context.vaultOverview?.totalNotes).toBe(3);
    expect(parsed.context.vaultOverview?.folders).toEqual(["Openings", "Tactics"]);
    expect(parsed.context.vaultOverview?.notes).toHaveLength(3);
    expect(parsed.context.activeNote?.path).toBe("Openings/Note 001 tốt.md");
    expect(parsed.context.activeNote?.content).toBe("# Giới thiệu cờ vua");
  });
});
