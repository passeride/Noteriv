import { describe, expect, it } from "vitest";
import { sampleVault, sampleVaultLocale, type SampleVaultLocale } from "../src/sample-vault";
import { parseTags } from "../src/tag-utils";

const LOCALES: SampleVaultLocale[] = ["en", "vi"];
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
const folder = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Links that are notes in their own right; inline code (`[[double brackets]]`, examples) is not a link. */
function links(content: string): string[] {
  const prose = content.replace(/`[^`]*`/g, "");
  return [...prose.matchAll(WIKILINK)].map((m) => m[1].trim());
}

describe("sample vault", () => {
  it("has the same shape in every language", () => {
    const [en, vi] = LOCALES.map((l) => sampleVault(l));
    expect(vi.files).toHaveLength(en.files.length);
    expect(vi.files.map((f) => folder(f.path))).toEqual(en.files.map((f) => folder(f.path)));
    expect(en.name).toBe("Getting started");
    expect(vi.name).not.toBe(en.name);
  });

  it.each(LOCALES)("%s: every link points to a note in the vault", (locale) => {
    const { files } = sampleVault(locale);
    const names = new Set(files.map((f) => baseName(f.path).toLowerCase()));
    const broken = files.flatMap((f) => links(f.content).filter((target) => !names.has(target.toLowerCase())).map((t) => `${f.path} → ${t}`));
    expect(broken).toEqual([]);
    // Every note except the template is reachable from the first one.
    const start = files[0];
    const linked = new Set(links(start.content).map((t) => t.toLowerCase()));
    const others = files.slice(1).filter((f) => !f.path.startsWith("Templates/"));
    expect(others.every((f) => linked.has(baseName(f.path).toLowerCase()))).toBe(true);
  });

  it.each(LOCALES)("%s: paths can be imported as they are", (locale) => {
    for (const { path } of sampleVault(locale).files) {
      expect(path).toMatch(/\.md$/);
      expect(path.startsWith("/")).toBe(false);
      expect(path.split("/")).not.toContain("..");
      expect(path).not.toMatch(/[\\:*?"<>|]/);
    }
  });

  it.each(LOCALES)("%s: shows tags and a template in use", (locale) => {
    const { files } = sampleVault(locale);
    expect(files.some((f) => parseTags(f.content).length > 0)).toBe(true);
    const template = files.find((f) => f.path.startsWith("Templates/"));
    expect(template?.content).toContain("{{date}}");
  });

  it("hands out copies", () => {
    sampleVault("en").files[0].content = "changed";
    expect(sampleVault("en").files[0].content).not.toBe("changed");
  });

  it("maps interface locales to a sample language", () => {
    expect(sampleVaultLocale("vi")).toBe("vi");
    expect(sampleVaultLocale("vi-VN")).toBe("vi");
    expect(sampleVaultLocale("en")).toBe("en");
    expect(sampleVaultLocale("fr")).toBe("en");
  });
});
