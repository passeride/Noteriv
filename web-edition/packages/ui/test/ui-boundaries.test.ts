import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @noteriv/ui is shared by web and desktop, so it must not reach into either app or into a platform bridge.
// The vault is reached only through a VaultAdapter handed in by the app. These checks turn that rule into a
// failing test instead of a review comment.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const files = sourceFiles(srcDir);

function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1] ?? m[2]);
  return out;
}

/** Packages the UI may import. Adding one is a deliberate decision: list it here and in package.json. */
const ALLOWED_PACKAGE = /^(react|react-dom(\/client)?|katex|mermaid|dompurify|jszip|@noteriv\/core(\/[\w-]+)?|@noteriv\/ai-hub(\/[\w-]+)?|@noteriv\/plugin-api|@codemirror\/[\w-]+|@lezer\/[\w-]+|@replit\/codemirror-vim)$/;

describe("@noteriv/ui boundaries", () => {
  it("imports only siblings and explicitly allowed packages", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of specifiers(readFileSync(f, "utf8"))) {
        if (spec.startsWith("./") || spec.startsWith("../")) continue;
        if (!ALLOWED_PACKAGE.test(spec)) offenders.push(`${relative(srcDir, f)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not use the app API client or the desktop bridge", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/\bwebApi\b|\belectronAPI\b|__TAURI__|data-vault-path/.test(text)) offenders.push(relative(srcDir, f));
    }
    expect(offenders).toEqual([]);
  });
});
