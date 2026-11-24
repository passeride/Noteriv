import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { flattenMessages, isPluralForms, placeholders, type CatalogEntry, type Messages } from "../src/i18n/translate";
import { corePluginGroup } from "../src/plugins/CorePluginsSection";

// The English catalog is the reference: every other catalog must translate every key, with the same placeholders,
// and every key the code asks for by name must exist. These checks keep a missing or misspelt key from reaching a
// screen (where it would show up as the raw key).

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const localesDir = join(root, "packages", "ui", "src", "i18n", "locales");

const load = (locale: string) => flattenMessages(JSON.parse(readFileSync(join(localesDir, `${locale}.json`), "utf8")) as Messages);
const en = load("en");
const others = readdirSync(localesDir)
  .filter((f) => f.endsWith(".json") && f !== "en.json")
  .map((f) => [f.replace(/\.json$/, ""), load(f.replace(/\.json$/, ""))] as const);


const texts = (entry: CatalogEntry) => (typeof entry === "string" ? [entry] : Object.values(entry));
const names = (entry: CatalogEntry) => new Set(texts(entry).flatMap(placeholders).filter((n) => n !== "count"));

describe("i18n catalogs", () => {
  it("has at least one catalog besides English", () => {
    expect(others.map(([l]) => l)).toContain("vi");
  });

  for (const [locale, catalog] of others) {
    it(`${locale}: has no key English lacks`, () => {
      expect([...catalog.keys()].filter((k) => !en.has(k))).toEqual([]);
    });

    // Since stage 4 (session 4.5) every catalog is complete: a key added in English must be translated in the same change.
    it(`${locale}: translates every English key`, () => {
      expect([...en.keys()].filter((k) => !catalog.has(k))).toEqual([]);
    });

    it(`${locale}: keeps the placeholders and the plural shape of English`, () => {
      const offenders: string[] = [];
      for (const [key, entry] of catalog) {
        const ref = en.get(key);
        if (!ref) continue;
        if (isPluralForms(ref) !== isPluralForms(entry)) offenders.push(`${key}: plural in one catalog only`);
        const want = [...names(ref)].sort().join(",");
        const got = [...names(entry)].sort().join(",");
        if (want !== got) offenders.push(`${key}: {${got}} instead of {${want}}`);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("has every key the code names", () => {
    const dirs = ["packages/ui/src", "packages/plugins/src", "web/src"].map((d) => join(root, d));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : files(full);
        return /\.(ts|tsx)$/.test(entry) ? [full] : [];
      });
    // `t("a.b")`, `i18n.t("a.b")`: literal dotted keys starting with one of the catalog's top-level groups.
    const groups = new Set([...en.keys()].map((k) => k.split(".")[0]));
    const re = /\bt\(\s*["'`]([a-zA-Z][\w-]*(?:\.[\w-]+)+)["'`]/g;
    const missing: string[] = [];
    let used = 0;
    for (const f of dirs.flatMap(files)) {
      for (const m of readFileSync(f, "utf8").matchAll(re)) {
        if (!groups.has(m[1].split(".")[0])) continue;
        used++;
        if (!en.has(m[1])) missing.push(`${relative(root, f)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
    expect(used).toBeGreaterThan(0);
  });

  it("labels every hotkey action and category, and every web menu entry", () => {
    const missing: string[] = [];
    for (const app of ["web"]) {
      const table = readFileSync(join(root, app, "src", "lib", "hotkeys.ts"), "utf8");
      const rows = Array.from(table.matchAll(/\{ action: "(\w+)", label: "[^"]*", keys: "[^"]*", category: "(\w+)" \}/g));
      expect(rows.length, app).toBeGreaterThan(30);
      for (const [, action, category] of rows) {
        for (const key of [`hotkeys.${action}`, `hotkeys.category.${category.toLowerCase()}`]) {
          if (!en.has(key)) missing.push(`${app}: ${key}`);
        }
      }
    }
    const menu = readFileSync(join(root, "web", "src", "components", "AppMenu.tsx"), "utf8");
    for (const [, action] of menu.matchAll(/\{ action: "(\w+)" \}/g)) {
      if (!en.has(`web.menu.items.${action}`)) missing.push(`web menu: ${action}`);
    }
    for (const [, title] of menu.matchAll(/title: "(\w+)",/g)) {
      if (!en.has(`web.menu.${title}`)) missing.push(`web menu section: ${title}`);
    }
    expect(missing).toEqual([]);
  });

  it("names every Settings section and every sync direction and status the web shows", () => {
    const missing: string[] = [];
    for (const app of ["web"]) {
      const modal = readFileSync(join(root, app, "src", "components", "SettingsModal.tsx"), "utf8");
      const list = /const SECTIONS: \w+\[\] = \[([^\]]+)\]/.exec(modal)?.[1] ?? "";
      const ids = Array.from(list.matchAll(/"(\w+)"/g), (m) => m[1]);
      expect(ids.length, app).toBeGreaterThan(5);
      for (const id of ids) if (!en.has(`settings.sections.${id}`)) missing.push(`${app}: settings.sections.${id}`);
    }
    for (const d of ["both", "push", "pull"]) if (!en.has(`web.sync.direction.${d}`)) missing.push(`web.sync.direction.${d}`);
    for (const s of ["queued", "running", "success", "error", "conflict"]) if (!en.has(`web.sync.status.${s}`)) missing.push(`web.sync.status.${s}`);
    expect(missing).toEqual([]);
  });

  it("names and describes every core plugin the web app ships", () => {
    const missing: string[] = [];
    for (const app of ["web"]) {
      const list = readFileSync(join(root, app, "src", "lib", "core-plugins.ts"), "utf8");
      const ids = Array.from(list.matchAll(/\bid: "([\w-]+)"/g), (m) => m[1]);
      expect(ids.length, app).toBeGreaterThan(10);
      for (const id of ids) {
        const group = corePluginGroup(id);
        for (const key of [`${group}.name`, `${group}.description`]) if (!en.has(key)) missing.push(`${app}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
