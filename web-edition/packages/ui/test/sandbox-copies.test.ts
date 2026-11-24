import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Next serves static files only from each app's public/, so the sandbox page is copied there from
// packages/ui/public (npm run sync:sandbox). A copy that drifts would run different sandbox code on one platform.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("plugin-sandbox.html copies", () => {
  const source = read("packages/ui/public/plugin-sandbox.html");
  for (const app of ["web"]) {
    it(`${app}/public copy matches packages/ui/public`, () => {
      expect(read(`${app}/public/plugin-sandbox.html`)).toBe(source);
    });
  }

  it("the host gives the iframe allow-scripts only (allow-same-origin would undo the isolation)", () => {
    const host = read("packages/ui/src/plugins/sandbox/use-sandbox-plugin-host.ts");
    expect(host).toContain('iframe.setAttribute("sandbox", "allow-scripts")');
    expect(host).not.toMatch(/allow-same-origin"/);
  });
});
