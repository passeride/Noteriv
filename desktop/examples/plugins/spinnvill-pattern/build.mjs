import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const engineRevision = "5ab339ccab216f29f2b062bbca0f1ff7db1ff560";
const [spinnvillPath, outputPath] = process.argv.slice(2);
if (!spinnvillPath || !outputPath) throw new Error("Usage: node build.mjs <spinnvill-checkout> <output-folder>");

const plugin = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(spinnvillPath);
const output = resolve(outputPath, "spinnvill-pattern");
const layers = "src/features/patterns/pattern-layers.ts";
const core = "src/features/patterns/pattern-core.ts";
const schema = "src/domain/operations/pattern.ts";
const changed = execFileSync("git", ["diff", "--name-only", engineRevision, "--", layers, core, schema, "package-lock.json"], {
  cwd: root,
  encoding: "utf8",
});
if (changed.trim()) throw new Error("Use the pinned Spinnvill engine at " + engineRevision + ".");

const requireSpinnvill = createRequire(join(root, "package.json"));
const { build } = requireSpinnvill("esbuild");
const { outputFiles } = await build({
  absWorkingDir: root,
  bundle: true,
  format: "iife",
  globalName: "SpinnvillPatternsEngine",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "inline",
  write: false,
  stdin: {
    resolveDir: root,
    contents: `
      import { generateLayers } from "./${layers}";
      function makeCanvas(width, height) {
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      const PatternCanvas = globalThis.OffscreenCanvas || makeCanvas;
      export function preview(spec) {
        return generateLayers(spec, "");
      }`,
  },
  define: { OffscreenCanvas: "PatternCanvas" },
  plugins: [{
    name: "spinnvill-offline-engine",
    setup(builder) {
      builder.onResolve({ filter: /^\.\/pattern-core$/ }, args => {
        if (args.importer === join(root, layers)) return { path: "local-pattern-engine", namespace: "offline" };
      });
      // Expose only the constructors used by the pinned schema so the bundle
      // does not ship the unused Zod namespace and every translation.
      builder.onResolve({ filter: /^zod$/ }, args => {
        if (args.importer === join(root, schema)) return { path: "pattern-zod", namespace: "offline" };
      });
      builder.onLoad({ filter: /^pattern-zod$/, namespace: "offline" }, () => ({
        resolveDir: root,
        contents: 'import { object, string, number, array, discriminatedUnion, literal, enum as enumeration } from "zod";' +
          'export const z = { object, string, number, array, discriminatedUnion, literal, enum: enumeration };',
      }));
      builder.onLoad({ filter: /^local-pattern-engine$/, namespace: "offline" }, () => ({
        resolveDir: root,
        contents: `
          import { generateLocally } from "./${core}";
          export async function generatePattern(spec) {
            return { generated: generateLocally(spec), engine: "Local preview" };
          }`,
      }));
    },
  }],
});

const sample = readFileSync(join(plugin, "spinnvill-turbin.json"), "utf8").trim();
const code = "// Spinnvill Patterns engine " + engineRevision + "\n" +
  outputFiles[0].text + "\nconst EXAMPLE_JSON = " + JSON.stringify(sample) + ";\n" +
  readFileSync(join(plugin, "plugin.js"), "utf8");
new Script(code, { filename: "spinnvill-pattern/main.js" });
if (Buffer.byteLength(code) >= 500_000) throw new Error("Plugin exceeds the mobile installer size limit.");

mkdirSync(output, { recursive: true });
for (const name of ["manifest.json", "README.md", "spinnvill-turbin.json"]) {
  copyFileSync(join(plugin, name), join(output, name));
}
const zod = requireSpinnvill.resolve("zod/package.json");
const notices = [readFileSync(join(root, "LICENSE"), "utf8"), readFileSync(join(dirname(zod), "LICENSE"), "utf8")];
writeFileSync(join(output, "THIRD-PARTY-LICENSES.txt"), notices.join("\n\n"));
writeFileSync(join(output, "main.js"), code);
console.log(output + " (" + Buffer.byteLength(code) + " bytes JavaScript)");
