import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @noteriv/core is shared by web and desktop, so it must not reach into either app, into a UI framework, or into
// anything platform specific. These checks turn that rule into a failing test instead of a review comment.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
const modules = files.filter((f) => f !== "index.ts").map((f) => f.replace(/\.ts$/, ""));

/** Third-party packages core may depend on. Adding one is a deliberate decision: list it here and in package.json. */
const ALLOWED_PACKAGES = new Set(["dompurify"]);

function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1] ?? m[2]);
  return out;
}

describe("@noteriv/core boundaries", () => {
  it("only imports sibling modules and explicitly allowed packages", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of specifiers(readFileSync(join(srcDir, f), "utf8"))) {
        if (spec.startsWith("./")) {
          if (!modules.includes(spec.slice(2))) offenders.push(`${f}: ${spec} (no such module)`);
        } else if (!ALLOWED_PACKAGES.has(spec)) {
          offenders.push(`${f}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not use app-only or platform-only globals", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = readFileSync(join(srcDir, f), "utf8");
      if (/window\.electronAPI|__TAURI__|process\.env|require\(/.test(code)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("re-exports every module from the index", () => {
    const index = readFileSync(join(srcDir, "index.ts"), "utf8");
    const exported = [...index.matchAll(/export \* from "\.\/([^"]+)"/g)].map((m) => m[1]).sort();
    expect(exported).toEqual([...modules].sort());
  });
});
