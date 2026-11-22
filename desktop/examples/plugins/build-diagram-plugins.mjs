import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { gzipSync } from "node:zlib";

const source = fileURLToPath(new URL(".", import.meta.url));
const output = resolve(process.argv[2] ?? "diagram-plugins");
const temp = mkdtempSync(join(tmpdir(), "noteriv-diagram-plugins-"));

function unpack(spec, directory) {
  mkdirSync(directory);
  const [pack] = JSON.parse(execFileSync("npm", ["pack", spec, "--json", "--pack-destination", temp], { encoding: "utf8" }));
  execFileSync("tar", ["-xzf", join(temp, pack.filename), "-C", directory, "--strip-components=1"]);
}

function read(file) {
  return readFileSync(file, "utf8");
}

function plantUmlEngine(directory) {
  const source = read(join(directory, "plantuml.js"));
  const exportPattern = /export\s*\{\s*\w+\s+as\s+render\s*,\s*(\w+)\s+as\s+renderToString\s*\}\s*;?\s*$/;
  const exports = exportPattern.exec(source);
  if (!exports) throw new Error("The PlantUML browser bundle has an unexpected module format.");
  // A srcdoc frame has no hierarchical base URL. Viz.js embeds its WASM
  // bytes, so it can use the current document URL as its script origin.
  const viz = read(join(directory, "viz-global.js"));
  const defaultVizUrl = 'new URL("viz-global.js",document.baseURI).href';
  if (!viz.includes(defaultVizUrl)) throw new Error("The Graphviz browser bundle has an unexpected script URL.");
  return [
    "window.PLANTUML_FILE_LOADER = (_path, _from, _ok, fail) => fail('Eksterne filer støttes ikke.');",
    "window.PLANTUML_STDLIB_LOADER = (_path, _ok, fail) => { fail('Biblioteket er ikke med i pluginpakken.'); return true; };",
    viz.replace(defaultVizUrl, "location.href"),
    read(join(directory, "themes.js")),
    read(join(directory, "openiconic.js")),
    source.slice(0, exports.index),
    "function renderDiagram(source) {",
    String.raw`  const text = /^\s*@start\w+\b/im.test(source) ? source : "@startuml\n" + source + "\n@enduml";`,
    "  return new Promise((resolve, reject) => " + exports[1] + "(text.split(/\\r\\n|\\r|\\n/),",
    "    resolve, error => reject(new Error(String(error))), { maxSvgSize: 4096 }));",
    "}",
  ].join("\n");
}

function mermaidEngine(directory) {
  const bundle = read(join(directory, "dist", "mermaid.min.js"));
  const exportPattern = /globalThis\["mermaid"\]\s*=\s*globalThis\.(__esbuild_esm_mermaid_\w+)\["mermaid"\]\.default;\s*$/;
  const exports = exportPattern.exec(bundle);
  if (!exports) throw new Error("The Mermaid browser bundle has an unexpected module format.");
  return [
    "const offlineMermaid = (function () {",
    bundle.slice(0, exports.index) + "return " + exports[1] + ".mermaid.default;",
    "})();",
    'offlineMermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false,',
    "  suppressErrorRendering: true, maxTextSize: 24000, maxEdges: 300 });",
    'async function renderDiagram(source) { return (await offlineMermaid.render("noteriv-mermaid", source)).svg; }',
  ].join("\n");
}

function pack(id, version, engine, license) {
  new Script(engine, { filename: id + "-engine.js" });
  const input = join(source, id);
  const target = join(output, id);
  mkdirSync(target, { recursive: true });
  for (const name of ["manifest.json", "README.md"]) copyFileSync(join(input, name), join(target, name));
  copyFileSync(license, join(target, "engine-LICENSE.txt"));
  copyFileSync(join(plantumlDirectory, "vendor", "fflate-0.8.2.min.js"), join(target, "fflate.js"));
  copyFileSync(join(plantumlDirectory, "vendor", "fflate-LICENSE.txt"), join(target, "fflate-LICENSE.txt"));
  writeFileSync(join(target, "main.js"), read(join(source, "diagram-support.js")) + "\n" + read(join(input, "main.js")));

  const encoded = gzipSync(engine, { level: 9 }).toString("base64");
  const size = 96_000;
  const parts = Math.ceil(encoded.length / size);
  for (let index = 0; index < parts; index++) {
    writeFileSync(join(target, "engine-" + index + ".txt"), encoded.slice(index * size, (index + 1) * size));
  }
  writeFileSync(join(target, "engine-index.json"), JSON.stringify({ parts, version }) + "\n");
  console.log(id + " → " + target + " (" + parts + " engine files)");
}

const plantumlDirectory = join(temp, "plantuml");
const mermaidDirectory = join(temp, "mermaid");
const plantumlVersion = "1.2026.10";
const mermaidVersion = "11.14.0";
try {
  unpack("@plantuml/core@" + plantumlVersion, plantumlDirectory);
  unpack("mermaid@" + mermaidVersion, mermaidDirectory);
  pack("plantuml", plantumlVersion, plantUmlEngine(plantumlDirectory), join(plantumlDirectory, "LICENSE"));
  pack("mermaid-diagrams", mermaidVersion, mermaidEngine(mermaidDirectory), join(mermaidDirectory, "LICENSE"));
} finally {
  rmSync(temp, { force: true, recursive: true });
}
