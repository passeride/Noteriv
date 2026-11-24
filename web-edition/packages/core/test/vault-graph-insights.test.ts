import { describe, expect, it } from "vitest";
import { analyzeVaultGraph, suggestSmartLinks } from "../src/vault-graph-insights";
import type { NoteRef } from "../src/vault-adapter";

describe("Vault Graph & Relationship Discovery (Option 3)", () => {
  const sampleNotes: NoteRef[] = [
    { id: "n1", path: "Architecture.md", name: "Architecture.md" },
    { id: "n2", path: "Microservices.md", name: "Microservices.md" },
    { id: "n3", path: "Database.md", name: "Database.md" },
    { id: "n4", path: "OrphanNote.md", name: "OrphanNote.md" },
  ];

  it("analyzes hub notes, orphan notes, and connectivity health", () => {
    const contents = new Map<string, string>([
      ["n1", "Main system overview linking to [[Microservices]] and [[Database]]."],
      ["n2", "Service layer communicating with [[Database]]."],
      ["n3", "PostgreSQL storage layer."],
      ["n4", "Isolated note with no links at all."],
    ]);

    const analysis = analyzeVaultGraph(sampleNotes, contents);

    expect(analysis.totalNotes).toBe(4);
    expect(analysis.totalEdges).toBe(3); // n1-n2, n1-n3, n2-n3
    expect(analysis.connectedNotesCount).toBe(3);
    expect(analysis.connectivityRatio).toBe(75);
    expect(analysis.orphanNotes.map((n) => n.id)).toEqual(["n4"]);
    expect(analysis.hubNotes.length).toBeGreaterThanOrEqual(2);
    expect(analysis.hubNotes[0].connections).toBe(2);
  });

  it("suggests unlinked mentions when active note mentions another note title in plain text", () => {
    const activeContent =
      "Trong dự án này chúng ta áp dụng mô hình Microservices để tách biệt các module, đồng thời kết nối với [[Database]].";

    const suggestions = suggestSmartLinks(
      "Architecture.md",
      activeContent,
      sampleNotes
    );

    // Database is already linked with [[Database]], so only Microservices should be suggested!
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].targetTitle).toBe("Microservices");
    expect(suggestions[0].reason).toBe("unlinked-mention");
  });

  it("suggests notes sharing the same #tag when not yet linked", () => {
    const contents = new Map<string, string>([
      ["n1", "Overview of backend #distributed #cloud"],
      ["n2", "Service mesh setup #distributed"],
      ["n3", "SQL tuning #storage"],
      ["n4", "Random thoughts"],
    ]);

    const suggestions = suggestSmartLinks(
      "Architecture.md",
      contents.get("n1")!,
      sampleNotes,
      contents
    );

    expect(suggestions.length).toBe(1);
    expect(suggestions[0].targetTitle).toBe("Microservices");
    expect(suggestions[0].reason).toBe("shared-topic");
    expect(suggestions[0].matchedTerm).toBe("#distributed");
  });
});
