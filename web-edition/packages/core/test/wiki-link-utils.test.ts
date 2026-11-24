import { describe, expect, it } from "vitest";
import { findBacklinks, parseWikiLink, resolveWikiLink, type FileInfo } from "../src/wiki-link-utils";

describe("parseWikiLink", () => {
  it("parses a plain target", () => {
    expect(parseWikiLink("Sicilian Defense")).toEqual({ filename: "Sicilian Defense", display: null });
  });
  it("splits on the first pipe and trims both sides", () => {
    expect(parseWikiLink(" Note | shown text ")).toEqual({ filename: "Note", display: "shown text" });
  });
  it("keeps later pipes in the display text", () => {
    expect(parseWikiLink("a|b|c")).toEqual({ filename: "a", display: "b|c" });
  });
  it("treats an empty display as an empty string, not null", () => {
    expect(parseWikiLink("a|")).toEqual({ filename: "a", display: "" });
  });
});

const files: FileInfo[] = [
  { filePath: "/v/openings/Italian.md", fileName: "Italian.md", relativePath: "openings/Italian.md" },
  { filePath: "/v/endgames/Rook.md", fileName: "Rook.md", relativePath: "endgames/Rook.md" },
  { filePath: "/v/Rook.md", fileName: "Rook.md", relativePath: "Rook.md" },
];

describe("resolveWikiLink", () => {
  it("matches the basename case-insensitively and ignores a typed .md", () => {
    expect(resolveWikiLink("italian", files)).toBe("/v/openings/Italian.md");
    expect(resolveWikiLink("ITALIAN.MD", files)).toBe("/v/openings/Italian.md");
  });
  it("returns the first match when basenames collide", () => {
    expect(resolveWikiLink("Rook", files)).toBe("/v/endgames/Rook.md");
  });
  it("resolves path-qualified links by relative path suffix", () => {
    expect(resolveWikiLink("endgames/Rook", files)).toBe("/v/endgames/Rook.md");
    expect(resolveWikiLink("openings/Italian", files)).toBe("/v/openings/Italian.md");
  });
  it("returns null when nothing matches", () => {
    expect(resolveWikiLink("Missing", files)).toBeNull();
    expect(resolveWikiLink("nope/Italian", files)).toBeNull();
  });
});

describe("findBacklinks", () => {
  const content: Record<string, string | null> = {
    "/v/a.md": "intro\nsee [[Target]] here\nand ![[target|alias]] too",
    "/v/b.md": "nothing relevant",
    "/v/Target.md": "I link to [[Target]] myself",
    "/v/c.md": null,
    "/v/d.md": "x [[Target.md]] y\n[[Targeted]]",
  };
  const all: FileInfo[] = Object.keys(content).map((p) => ({ filePath: p, fileName: p.split("/").pop()! }));
  const read = async (p: string) => content[p] ?? null;

  it("finds plain, aliased and embedded links, case-insensitively, with 1-based lines", async () => {
    const r = await findBacklinks("Target.md", "/v", all, read);
    expect(r.map((b) => [b.fileName, b.line])).toEqual([
      ["a.md", 2],
      ["a.md", 3],
    ]);
  });
  it("does not report the note linking to itself, unreadable files, or prefix look-alikes", async () => {
    const r = await findBacklinks("Target", "/v", all, read);
    expect(r.some((b) => b.fileName === "Target.md")).toBe(false);
    expect(r.some((b) => b.fileName === "c.md")).toBe(false);
    // "[[Targeted]]" must not match "Target"; "[[Target.md]]" does not match either because the pattern has no .md
    expect(r.some((b) => b.fileName === "d.md")).toBe(false);
  });
  it("detects a link anywhere on the line, and cuts the snippet to 120 characters", async () => {
    const line = "[[Target]] " + "y".repeat(200);
    const r = await findBacklinks("Target", "/v", [{ filePath: "/v/l.md", fileName: "l.md" }], async () => `  ${line}`);
    expect(r).toHaveLength(1);
    expect(r[0].snippet.length).toBe(120);
    expect(r[0].relativePath).toBe("l.md");
    // a link that sits beyond the first 120 characters is still found
    const far = await findBacklinks("Target", "/v", [{ filePath: "/v/l.md", fileName: "l.md" }], async () => "x".repeat(200) + " [[Target]]");
    expect(far).toHaveLength(1);
  });
  it("escapes regex characters in the target name", async () => {
    const f: FileInfo[] = [{ filePath: "/v/a.md", fileName: "a.md" }];
    const r = await findBacklinks("C++ (notes)", "/v", f, async () => "[[C++ (notes)]] and [[CCC (notes)]]");
    expect(r).toHaveLength(1);
  });
  it("sorts by file name then line", async () => {
    const f: FileInfo[] = [
      { filePath: "/v/z.md", fileName: "z.md" },
      { filePath: "/v/a.md", fileName: "a.md" },
    ];
    const r = await findBacklinks("T", "/v", f, async () => "[[T]]\n[[T]]");
    expect(r.map((b) => `${b.fileName}:${b.line}`)).toEqual(["a.md:1", "a.md:2", "z.md:1", "z.md:2"]);
  });
});
