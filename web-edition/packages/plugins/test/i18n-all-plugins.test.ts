import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { testI18n } from "./i18n";
import audioRecorder from "../src/audio-recorder";
import board from "../src/board";
import calendar from "../src/calendar";
import canvas from "../src/canvas";
import dataview from "../src/dataview";
import chessboard from "../src/chessboard";
import drawing from "../src/drawing";
import flashcards from "../src/flashcards";
import graph from "../src/graph";
import markdownLint from "../src/markdown-lint";
import mermaid from "../src/mermaid";
import noteComposer from "../src/note-composer";
import noteHistory from "../src/note-history";
import pdfViewer from "../src/pdf-viewer";
import slides from "../src/slides";
import templates from "../src/templates";
import vaultInsights from "../src/vault-insights";
import wordCount from "../src/word-count";

// Every core plugin builds its text in onload. Running onload against both catalogs, on both platforms, with an
// `api.i18n` that throws on a missing key, catches a key a plugin asks for but the catalog lacks.

const PLUGINS: Record<string, CorePlugin> = {
  audioRecorder,
  board,
  calendar,
  canvas,
  dataview,
  chessboard,
  drawing,
  flashcards,
  graph,
  markdownLint,
  mermaid,
  noteComposer,
  noteHistory,
  pdfViewer,
  slides,
  templates,
  vaultInsights,
  wordCount,
};

/** An API where every member is a callable stand-in (calls return another stand-in), except `app` and `i18n`. */
function permissiveApi(platform: "web" | "desktop", locale: "en" | "vi"): PluginApi {
  const fn: () => unknown = () => null;
  const any: unknown = new Proxy(fn, { get: (_t, key) => (key === "then" ? undefined : any), apply: () => any });
  return new Proxy({} as PluginApi, {
    get: (_t, key) => {
      if (key === "app") return { platform, vaultPath: null, currentFile: null };
      if (key === "i18n") return testI18n(locale);
      // No note open.
      if (key === "editor") return new Proxy({}, { get: (_e, k) => (k === "getContent" ? () => null : any) });
      return any;
    },
  });
}

describe("core plugin text", () => {
  for (const [id, plugin] of Object.entries(PLUGINS)) {
    it(`${id}: onload finds every key it reads, in en and vi, on web and desktop`, async () => {
      for (const platform of ["web", "desktop"] as const) {
        for (const locale of ["en", "vi"] as const) {
          await expect(Promise.resolve(plugin.onload(permissiveApi(platform, locale)))).resolves.toBeUndefined();
        }
      }
    });
  }

  // Labels that are functions (counts, names) only call `t` when shown, so onload does not reach them: read the keys
  // from the source instead. `t("key")` in a file using `pluginT(api, "group")`; `t(\`key.${platform}\`)` needs both.
  it("every t(…) in a plugin's source names a key of its group in both catalogs", () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    const missing: string[] = [];
    let checked = 0;
    for (const dir of readdirSync(src)) {
      if (!statSync(join(src, dir)).isDirectory()) continue;
      for (const file of readdirSync(join(src, dir)).filter((f) => /\.tsx?$/.test(f))) {
        const code = readFileSync(join(src, dir, file), "utf8");
        const group = /pluginT\(api, "(\w+)"\)/.exec(code)?.[1];
        if (!group) continue;
        const keys = [
          ...Array.from(code.matchAll(/\bt\("([\w.]+)"/g), (m) => [m[1]]),
          ...Array.from(code.matchAll(/\bt\(`([\w.]+)\.\$\{[^}]+\}`/g), (m) => [`${m[1]}.web`, `${m[1]}.desktop`]),
        ].flat();
        for (const key of keys) {
          checked++;
          for (const locale of ["en", "vi"] as const) {
            try {
              testI18n(locale).t(`plugins.${group}.${key}`);
            } catch {
              missing.push(`${locale}: plugins.${group}.${key} (${dir}/${file})`);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(missing).toEqual([]);
  }, 30000);
});
