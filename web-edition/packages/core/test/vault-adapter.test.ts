import { describe, expect, it } from "vitest";
import {
  backlinksFromWikiScan,
  baseName,
  isMarkdownPath,
  refFromAbsolutePath,
  relativeVaultPath,
  toPosixPath,
} from "../src/vault-adapter";

describe("path helpers", () => {
  it("normalises separators and takes the base name from either style", () => {
    expect(toPosixPath("a\\b\\c.md")).toBe("a/b/c.md");
    expect(baseName("C:\\vault\\dir\\n.md")).toBe("n.md");
    expect(baseName("/v/dir/n.md")).toBe("n.md");
    expect(baseName("plain.md")).toBe("plain.md");
  });
  it("recognises markdown files", () => {
    expect(isMarkdownPath("x.md")).toBe(true);
    expect(isMarkdownPath("x.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("x.png")).toBe(false);
  });
  it("makes absolute paths vault-relative, Windows and POSIX, trailing slash tolerated", () => {
    expect(relativeVaultPath("C:\\Vault", "C:\\Vault\\openings\\a.md")).toBe("openings/a.md");
    expect(relativeVaultPath("c:\\vault\\", "C:\\Vault\\a.md")).toBe("a.md");
    expect(relativeVaultPath("/home/u/v", "/home/u/v/x/y.md")).toBe("x/y.md");
  });
  it("does not treat a sibling folder with the same prefix as inside the vault", () => {
    expect(relativeVaultPath("/home/u/v", "/home/u/v2/x.md")).toBe("/home/u/v2/x.md");
  });
  it("builds a ref keyed by the absolute path", () => {
    expect(refFromAbsolutePath("C:\\V", "C:\\V\\d\\n.md")).toEqual({ id: "C:\\V\\d\\n.md", path: "d/n.md", name: "n.md" });
  });
});

describe("backlinksFromWikiScan", () => {
  it("maps scan results to refs with line and snippet", () => {
    const out = backlinksFromWikiScan("C:\\V", [
      { filePath: "C:\\V\\d\\a.md", fileName: "a.md", relativePath: "d\\a.md", line: 3, snippet: "see [[t]]" },
    ]);
    expect(out).toEqual([
      { ref: { id: "C:\\V\\d\\a.md", path: "d/a.md", name: "a.md" }, line: 3, snippet: "see [[t]]" },
    ]);
  });
});
