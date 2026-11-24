import { describe, it, expect, beforeEach } from "vitest";
import { MemoryVaultAdapter } from "../src/memory-vault-adapter";
import { createVfsTools, type VfsToolHandler } from "../src/ai-vfs-tools";

describe("AI VFS Tools", () => {
  let adapter: MemoryVaultAdapter;
  let tools: VfsToolHandler;

  beforeEach(() => {
    adapter = new MemoryVaultAdapter({
      "Welcome.md": "# Welcome to Noteriv\nThis is your personal PKM.",
      "Projects/Alpha.md": "# Project Alpha\nSee [[Welcome]] for basics.",
      "Projects/Beta.md": "# Project Beta\nTasks:\n- [ ] Task 1\n- [ ] Task 2",
    });
    tools = createVfsTools(adapter);
  });

  it("exposes standard tool definitions for LLMs", () => {
    const definitions = tools.getToolDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(5);
    const names = definitions.map((d) => d.name);
    expect(names).toContain("list_notes");
    expect(names).toContain("read_note");
    expect(names).toContain("search_notes");
    expect(names).toContain("create_note");
    expect(names).toContain("patch_note");
  });

  it("lists notes in the vault or folder", async () => {
    const all = await tools.executeTool("list_notes", {});
    expect(all.notes).toHaveLength(3);

    const filtered = await tools.executeTool("list_notes", { folder: "Projects" });
    expect(filtered.notes).toHaveLength(2);
    expect(filtered.notes.map((n: { path: string }) => n.path)).toEqual([
      "Projects/Alpha.md",
      "Projects/Beta.md",
    ]);
  });

  it("reads an existing note content", async () => {
    const res = await tools.executeTool("read_note", { path: "Welcome.md" });
    expect(res.path).toBe("Welcome.md");
    expect(res.content).toContain("# Welcome to Noteriv");
  });

  it("returns error message when reading non-existent note", async () => {
    await expect(tools.executeTool("read_note", { path: "Missing.md" })).rejects.toThrow(
      /Note not found/i
    );
  });

  it("searches notes by query string", async () => {
    const res = await tools.executeTool("search_notes", { query: "PKM" });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].path).toBe("Welcome.md");
  });

  it("creates a new note", async () => {
    const res = await tools.executeTool("create_note", {
      path: "Notes/Ideas.md",
      content: "# Brilliant Ideas\n- Idea 1",
    });
    expect(res.success).toBe(true);
    expect(res.path).toBe("Notes/Ideas.md");

    const readBack = await tools.executeTool("read_note", { path: "Notes/Ideas.md" });
    expect(readBack.content).toBe("# Brilliant Ideas\n- Idea 1");
  });

  it("patches an existing note with text replacement", async () => {
    const patchRes = await tools.executeTool("patch_note", {
      path: "Welcome.md",
      oldText: "This is your personal PKM.",
      newText: "This is your personal Second Brain with AI.",
    });
    expect(patchRes.success).toBe(true);

    const readBack = await tools.executeTool("read_note", { path: "Welcome.md" });
    expect(readBack.content).toContain("This is your personal Second Brain with AI.");
    expect(readBack.content).not.toContain("This is your personal PKM.");
  });

  it("retrieves backlinks pointing to a note", async () => {
    const res = await tools.executeTool("get_backlinks", { path: "Welcome.md" });
    expect(res.path).toBe("Welcome.md");
    expect(res.backlinks.length).toBeGreaterThanOrEqual(1);
    expect(res.backlinks[0].path).toBe("Projects/Alpha.md");
  });
});
