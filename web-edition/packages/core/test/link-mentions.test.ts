import { describe, expect, it } from "vitest";
import { findMentions, linkMention, outgoingLinks, unlinkedMentionsIn } from "../src/link-mentions";

const files = ["Index.md", "projects/Plan.md", "projects/Notes.md", "archive/Notes.md", "img/photo.png"];

describe("outgoingLinks", () => {
  it("lists wiki, embed and markdown links once each, resolved or not", () => {
    const text = "See [[Plan]] and [[plan#Goals|goals]], ![[photo.png]], [n](projects/Notes.md) and [[Missing]].\n`[[Index]]`";
    expect(outgoingLinks(text, "Index.md", files)).toEqual([
      { target: "Plan", resolved: "projects/Plan.md", line: 1, embed: false },
      { target: "photo.png", resolved: "img/photo.png", line: 1, embed: true },
      { target: "projects/Notes.md", resolved: "projects/Notes.md", line: 1, embed: false },
      { target: "Missing", resolved: null, line: 1, embed: false },
    ]);
  });

  it("ignores links in code blocks and front matter-free web links", () => {
    expect(outgoingLinks("```\n[[Plan]]\n```\n[w](https://x.org/a.md)", "Index.md", files)).toEqual([]);
  });
});

describe("findMentions", () => {
  it("finds whole-word, case-insensitive mentions outside links, code and front matter", () => {
    const text = "---\ntitle: Plan\n---\nThe plan is a Plan. Planning [[Plan]] [p](Plan.md) `Plan`\n```\nPlan\n```\nend plan";
    const found = findMentions(text, "Plan");
    expect(found.map((m) => [m.text, m.line])).toEqual([
      ["plan", 4],
      ["Plan", 4],
      ["plan", 8],
    ]);
    expect(text.slice(found[0].start, found[0].end)).toBe("plan");
    expect(found[0].snippet).toBe("The plan is a Plan. Planning [[Plan]] [p](Plan.md) `Plan`");
  });

  it("skips front matter written with Windows line ends", () => {
    const text = "﻿---\r\ntitle: Plan\r\n---\r\nThe plan.\r\n";
    expect(findMentions(text, "Plan").map((m) => [m.text, m.line])).toEqual([["plan", 4]]);
  });

  it("skips bare URLs, #tags, HTML comments and math", () => {
    const text = "https://x.org/plan #plan <!-- plan --> $plan$ $$\nplan\n$$ but plan.";
    expect(findMentions(text, "Plan").map((m) => m.start)).toEqual([text.lastIndexOf("plan")]);
  });

  it("matches a name written in decomposed form (macOS file names) and respects astral-plane letters", () => {
    expect(findMentions("Ghi chú mới", "Ghi chú").map((m) => m.text)).toEqual(["Ghi chú"]);
    expect(findMentions("𝒜plan plan", "plan").map((m) => m.start)).toEqual([7]);
  });

  it("handles names with spaces, punctuation and accents", () => {
    expect(findMentions("Read Café notes (v2) and café notes (v2).", "Café notes (v2)").map((m) => m.text)).toEqual([
      "Café notes (v2)",
      "café notes (v2)",
    ]);
    expect(findMentions("cafés", "café")).toEqual([]);
  });
});

describe("unlinkedMentionsIn", () => {
  it("groups the mentions of other notes' names found in a note, skipping the note itself", () => {
    // Only notes count (not the image); two notes share the name "Notes", each gets the mention.
    const result = unlinkedMentionsIn("Plan the notes. Index is here, see [[Notes]] and photo.", "Index.md", files);
    expect(result.map((r) => [r.path, r.mentions.map((m) => m.text)])).toEqual([
      ["projects/Plan.md", ["Plan"]],
      ["projects/Notes.md", ["notes"]],
      ["archive/Notes.md", ["notes"]],
    ]);
  });
});

describe("linkMention", () => {
  it("wraps the mention in a link that resolves to the note, keeping its text", () => {
    const text = "The plan is ready.";
    const [m] = findMentions(text, "Plan");
    expect(linkMention(text, m, "projects/Plan.md", "Index.md", files)).toBe("The [[plan]] is ready.");
  });

  it("uses a path and alias when the bare name would resolve elsewhere", () => {
    const text = "My notes.";
    const [m] = findMentions(text, "Notes");
    expect(linkMention(text, m, "archive/Notes.md", "projects/Plan.md", files)).toBe("My [[archive/Notes|notes]].");
  });

  it("escapes the alias bar inside a table row", () => {
    const text = "| a | my notes |";
    const [m] = findMentions(text, "Notes");
    expect(linkMention(text, m, "archive/Notes.md", "projects/Plan.md", files)).toBe("| a | my [[archive/Notes\\|notes]] |");
  });

  it("returns null when the text changed under the mention", () => {
    const [m] = findMentions("The plan.", "Plan");
    expect(linkMention("The plot.", m, "projects/Plan.md", "Index.md", files)).toBeNull();
  });
});
