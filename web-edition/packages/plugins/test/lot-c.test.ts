// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { platformI18n } from "./i18n";
import type { CodeBlockProcessor, PluginApi } from "@noteriv/plugin-api";
import mermaidPlugin, { renderMermaid, setMermaidLoader } from "../src/mermaid";
import dataview, { createDataviewProcessor, createNoteSource, QUERY_TEMPLATE, SCAN_TTL_MS } from "../src/dataview";

const PENDING = "data-nrv-pending";
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** Waits until the processor removed its pending marker. */
async function settled(el: HTMLElement) {
  for (let i = 0; i < 100 && el.querySelector(`[${PENDING}]`); i++) await tick(5);
}

describe("mermaid plugin", () => {
  it("registers the mermaid language", async () => {
    const registerCodeBlockProcessor = vi.fn();
    await mermaidPlugin.onload({ markdown: { registerCodeBlockProcessor }, i18n: platformI18n("web") } as unknown as PluginApi);
    expect(registerCodeBlockProcessor).toHaveBeenCalledWith("mermaid", expect.any(Function));
  });

  it("marks the block pending, then shows the SVG mermaid produced (strict security)", async () => {
    const initialize = vi.fn();
    setMermaidLoader(async () => ({ initialize, render: async (_id: string, src: string) => ({ svg: `<svg data-src="${src}"></svg>` }) }) as never);
    const el = document.createElement("div");
    renderMermaid("graph TD; A-->B", el, { source: "", language: "mermaid", sourcePath: null });
    expect(el.querySelector(`[${PENDING}]`)).not.toBeNull();
    await settled(el);
    expect(el.querySelector("svg")?.getAttribute("data-src")).toBe("graph TD; A-->B");
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict" }));
  });

  it("shows mermaid's error, escaped", async () => {
    setMermaidLoader(async () => ({ initialize() {}, render: async () => { throw new Error("Parse <error>"); } }) as never);
    const el = document.createElement("div");
    renderMermaid("nonsense", el, { source: "", language: "mermaid", sourcePath: null });
    await settled(el);
    expect(el.querySelector(".mermaid-error-message")?.textContent).toBe("Parse <error>");
    expect(el.querySelector(".mermaid-error-message")?.innerHTML).toContain("&lt;error&gt;");
  });

  it("does not write into a block that was cleaned up before the diagram was ready", async () => {
    let release!: () => void;
    setMermaidLoader(() => new Promise((r) => (release = () => r({ initialize() {}, render: async () => ({ svg: "<svg></svg>" }) } as never))));
    const el = document.createElement("div");
    const cleanup = renderMermaid("x", el, { source: "", language: "mermaid", sourcePath: null }) as () => void;
    cleanup();
    release();
    await tick(10);
    expect(el.querySelector("svg")).toBeNull();
  });
});

const NOTES: Record<string, string> = {
  "Projects/Alpha.md": "---\nstatus: active\n---\n#work\n- [ ] write spec\n- [x] kickoff",
  "Projects/Beta.md": "---\nstatus: done\n---\n#work",
  "Journal/Today.md": "#life\n- [ ] call mum",
};

function fakeVault() {
  const read = vi.fn(async (p: string) => NOTES[p] ?? null);
  const vault = {
    list: async (dir?: string) => {
      const base = dir ? `${dir}/` : "";
      const out = new Map<string, { path: string; name: string; isDir: boolean }>();
      for (const p of Object.keys(NOTES)) {
        if (!p.startsWith(base)) continue;
        const rest = p.slice(base.length);
        const i = rest.indexOf("/");
        out.set(i < 0 ? rest : rest.slice(0, i), { path: base + (i < 0 ? rest : rest.slice(0, i)), name: rest, isDir: i >= 0 });
      }
      return [...out.values()];
    },
    read,
    stats: async () => ({ "Projects/Alpha.md": { createdAt: Date.UTC(2026, 0, 1), modifiedAt: Date.UTC(2026, 9, 16) } }),
  };
  return { vault: vault as unknown as PluginApi["vault"], read };
}

async function run(processor: CodeBlockProcessor, query: string) {
  const el = document.createElement("div");
  processor(query, el, { source: query, language: "dataview", sourcePath: null });
  expect(el.querySelector(`[${PENDING}]`)).not.toBeNull();
  await settled(el);
  return el;
}

describe("dataview plugin", () => {
  it("TABLE: rows from the vault with frontmatter fields and real dates; a name opens the note", async () => {
    const { vault } = fakeVault();
    const onOpen = vi.fn();
    const proc = createDataviewProcessor(createNoteSource(vault), onOpen);
    const el = await run(proc, 'TABLE file.name, status, file.modified FROM "Projects" SORT file.name ASC');
    const rows = [...el.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([
      ["Alpha", "active", "2026-10-16T00:00:00.000Z"],
      ["Beta", "done", ""],
    ]);
    el.querySelector<HTMLElement>(".md-wikilink")!.click();
    expect(onOpen).toHaveBeenCalledWith("Projects/Alpha.md");
  });

  it("LIST by tag and TASK lists", async () => {
    const { vault } = fakeVault();
    const proc = createDataviewProcessor(createNoteSource(vault), () => {});
    const list = await run(proc, "LIST FROM #work");
    expect([...list.querySelectorAll("li")].map((li) => li.textContent).sort()).toEqual(["Alpha", "Beta"]);
    const tasks = await run(proc, 'TASK FROM "Journal"');
    expect(tasks.textContent).toContain("call mum");
  });

  it("shows a query error instead of results", async () => {
    const { vault } = fakeVault();
    const el = await run(createDataviewProcessor(createNoteSource(vault), () => {}), "SELECT nonsense");
    expect(el.textContent).toContain("Error:");
  });

  it("scans the vault once for several blocks, and again after a vault change", async () => {
    const { vault, read } = fakeVault();
    const source = createNoteSource(vault);
    const proc = createDataviewProcessor(source, () => {});
    await Promise.all([run(proc, "LIST"), run(proc, 'LIST FROM "Projects"')]);
    expect(read).toHaveBeenCalledTimes(3);
    source.invalidate();
    await run(proc, "LIST");
    expect(read).toHaveBeenCalledTimes(6);
    expect(SCAN_TTL_MS).toBeGreaterThan(0);
  });

  it("registers the processor, drops its cache on vault changes and offers an insert command", async () => {
    const { vault, read } = fakeVault();
    const handlers = new Map<string, () => void>();
    const raw = {
      app: { platform: "web" },
      i18n: platformI18n("web"),
      vault,
      markdown: { registerCodeBlockProcessor: vi.fn() },
      events: { on: (e: string, h: () => void) => void handlers.set(e, h) },
      ui: { addCommand: vi.fn() },
      editor: { insertAtCursor: vi.fn() },
      workspace: { openFile: vi.fn() },
    };
    await dataview.onload(raw as unknown as PluginApi);
    const [lang, proc] = raw.markdown.registerCodeBlockProcessor.mock.calls[0] as [string, CodeBlockProcessor];
    expect(lang).toBe("dataview");
    await run(proc, "LIST");
    handlers.get("vault-change")!();
    await run(proc, "LIST");
    expect(read).toHaveBeenCalledTimes(6);
    raw.ui.addCommand.mock.calls[0][0].callback();
    expect(raw.editor.insertAtCursor).toHaveBeenCalledWith(QUERY_TEMPLATE);
  });
});
