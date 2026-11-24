import { describe, expect, it } from "vitest";
import type { VaultAdapter } from "../src/vault-adapter";

/**
 * Behaviour every VaultAdapter must have. `make` receives the notes (vault-relative path -> content) the adapter
 * must start with. Lives in test/ (not src/) because it imports the test runner; the real web and desktop adapters
 * are thin wrappers whose pure parts are tested separately, this runs the full contract against the in-memory one.
 */
export function runVaultAdapterContract(label: string, make: (initial: Record<string, string>) => VaultAdapter) {
  const seed = {
    "a.md": "Intro to [[b]] and #chess\nsecond line",
    "dir/b.md": "# B\nlinks back: [[a]]\nalso ![[a|alias]] here",
    "dir/c.md": "mentions [[B]] once #chess #endgame",
  };

  describe(`VaultAdapter contract: ${label}`, () => {
    it("lists every note with an opaque id, a vault-relative path and a name", async () => {
      const refs = await make(seed).listNotes();
      expect(refs.map((r) => r.path).sort()).toEqual(["a.md", "dir/b.md", "dir/c.md"]);
      const b = refs.find((r) => r.path === "dir/b.md")!;
      expect(b.name).toBe("b.md");
      expect(typeof b.id).toBe("string");
    });

    it("reads a note by id and returns null for an unknown id", async () => {
      const v = make(seed);
      const a = (await v.listNotes()).find((r) => r.path === "a.md")!;
      expect(await v.readNote(a.id)).toBe(seed["a.md"]);
      expect(await v.readNote("no-such-id")).toBeNull();
    });

    it("writes, creates, renames and deletes", async () => {
      const v = make(seed);
      const a = (await v.listNotes()).find((r) => r.path === "a.md")!;
      await v.writeNote(a.id, "changed");
      expect(await v.readNote(a.id)).toBe("changed");

      const created = await v.createNote("new/n.md", "hello");
      expect(created.path).toBe("new/n.md");
      expect(await v.readNote(created.id)).toBe("hello");
      await expect(v.createNote("new/n.md")).rejects.toThrow();

      const moved = await v.renameNote(created.id, "new/m.md");
      expect(moved.path).toBe("new/m.md");
      expect(moved.name).toBe("m.md");
      expect(await v.readNote(moved.id)).toBe("hello");
      expect(await v.readNote(created.id)).toBeNull();

      await v.deleteNote(moved.id);
      expect(await v.readNote(moved.id)).toBeNull();
      expect((await v.listNotes()).map((r) => r.path)).not.toContain("new/m.md");
    });

    it("finds backlinks (case-insensitive, with alias and embed forms), sorted, without self links", async () => {
      const v = make(seed);
      const refs = await v.listNotes();
      const a = refs.find((r) => r.path === "a.md")!;
      const b = refs.find((r) => r.path === "dir/b.md")!;

      const toA = await v.backlinks(a.id);
      expect(toA.map((x) => [x.ref.path, x.line])).toEqual([
        ["dir/b.md", 2],
        ["dir/b.md", 3],
      ]);
      expect(toA[0].snippet).toContain("[[a]]");

      const toB = await v.backlinks(b.id);
      expect(toB.map((x) => x.ref.path)).toEqual(["a.md", "dir/c.md"]);
    });

    it("searches note text", async () => {
      const v = make(seed);
      const hits = await v.search("endgame");
      expect(hits.map((h) => h.ref.path)).toEqual(["dir/c.md"]);
      expect(hits[0].snippet).toContain("endgame");
      expect(await v.search("   ")).toEqual([]);
    });

    it("round-trips settings without sharing the stored object", async () => {
      const v = make(seed);
      expect(await v.getSettings()).toEqual({});
      const s = { theme: "dark" };
      await v.saveSettings(s);
      s.theme = "light";
      expect(await v.getSettings()).toEqual({ theme: "dark" });
    });

    it("batch reads notes when supported", async () => {
      const v = make(seed);
      if (!v.readBatchNotes) return;
      const all = await v.readBatchNotes({ all: true });
      expect(all.map((r) => r.ref.path).sort()).toEqual(["a.md", "dir/b.md", "dir/c.md"]);
      expect(all.find((r) => r.ref.path === "a.md")?.content).toBe(seed["a.md"]);

      const subset = await v.readBatchNotes({ paths: ["a.md", "dir/c.md"] });
      expect(subset.map((r) => r.ref.path).sort()).toEqual(["a.md", "dir/c.md"]);
    });

    it("reports changes to watchers until they unsubscribe", async () => {
      const v = make(seed);
      if (!v.watch) return;
      const seen: string[] = [];
      const stop = v.watch((id) => seen.push(id));
      const a = (await v.listNotes()).find((r) => r.path === "a.md")!;
      await v.writeNote(a.id, "x");
      stop();
      await v.writeNote(a.id, "y");
      expect(seen).toEqual([a.id]);
    });
  });
}
