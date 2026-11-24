import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { platformI18n } from "./i18n";
import type { FileView, FileViewInstance, PluginApi } from "@noteriv/plugin-api";
import { parseCanvas, serializeCanvas } from "@noteriv/core/canvas-utils";
import { createEmptyDrawing, parseDrawing, serializeDrawing } from "@noteriv/core/drawing-utils";
import canvas, { isCanvas, pluginCanvasServices } from "../src/canvas";
import drawing, { isDrawing } from "../src/drawing";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver; the views only use it to learn their size.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // No 2D canvas in jsdom: the drawing view skips painting when getContext gives nothing.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

function fakeApi(platform: "web" | "desktop", existing: string[] = [], notes: Record<string, { path: string; content: string }> = {}) {
  const files = new Set(existing);
  const raw = {
    app: { platform, vaultPath: null, currentFile: null },
    i18n: platformI18n(platform),
    vault: {
      exists: vi.fn(async (p: string) => files.has(p)),
      write: vi.fn(async (p: string, _content: string) => void files.add(p)),
      read: vi.fn(async (p: string) => Object.values(notes).find((n) => n.path === p)?.content ?? null),
      list: vi.fn(async () => Object.values(notes).map((n) => ({ path: n.path, name: n.path, isDir: false }))),
      resolve: vi.fn(async (ref: string) => notes[ref]?.path ?? Object.values(notes).find((n) => n.path === ref)?.path ?? null),
      listAttachments: vi.fn(async () => [{ target: "attachments/a.png", name: "a.png" }]),
      attachmentUrl: vi.fn(async (t: string) => `url:${t}`),
      saveAttachment: vi.fn(async (name: string) => `attachments/${name}`),
    },
    ui: { registerFileView: vi.fn(), addCommand: vi.fn(), showNotice: vi.fn() },
    workspace: { openFile: vi.fn(async () => true) },
  };
  return { api: raw as unknown as PluginApi, raw };
}

async function mount(view: FileView, path: string, content: string) {
  const el = document.createElement("div");
  el.style.height = "600px";
  document.body.appendChild(el);
  const setContent = vi.fn();
  let inst!: FileViewInstance | void;
  await act(async () => {
    inst = view.mount(el, { path, content, setContent });
  });
  return {
    el,
    setContent,
    inst: inst as FileViewInstance,
    async unmount() {
      await act(async () => {
        (inst as FileViewInstance).destroy?.();
        await new Promise((r) => setTimeout(r, 5));
      });
      el.remove();
    },
  };
}

describe("canvas plugin", () => {
  it("recognises .canvas files and canvas notes", () => {
    expect(isCanvas({ path: "Board.canvas", content: "{}" })).toBe(true);
    expect(isCanvas({ path: "Plan.md", content: '---\ncanvas: true\n---\n{"nodes":[],"edges":[]}' })).toBe(true);
    expect(isCanvas({ path: "Plan.md", content: "# note" })).toBe(false);
  });

  it("creates a .canvas file on desktop and a marked note on web, at the first free name", async () => {
    const desk = fakeApi("desktop", ["Canvas.canvas"]);
    await canvas.onload(desk.api);
    await desk.raw.ui.addCommand.mock.calls[0][0].callback();
    expect(desk.raw.vault.write).toHaveBeenCalledWith("Canvas 2.canvas", serializeCanvas({ nodes: [], edges: [] }));
    expect(desk.raw.workspace.openFile).toHaveBeenCalledWith("Canvas 2.canvas");

    const web = fakeApi("web");
    await canvas.onload(web.api);
    await web.raw.ui.addCommand.mock.calls[0][0].callback();
    const [path, content] = web.raw.vault.write.mock.calls[0];
    expect(path).toBe("Canvas.md");
    expect(content.startsWith("---\ncanvas: true\n---\n")).toBe(true);
  });

  it("edits keep the frontmatter; an old file node holding a note id still shows the note", async () => {
    const doc = {
      nodes: [{ id: "f1", type: "file", x: 0, y: 0, width: 260, height: 120, filePath: "note-id-1" }],
      edges: [],
    };
    const content = `---\ncanvas: true\n---\n${serializeCanvas(doc as never)}`;
    const { api, raw } = fakeApi("web", [], { "note-id-1": { path: "Notes/Alpha.md", content: "Alpha body text" } });
    await canvas.onload(api);
    const view = raw.ui.registerFileView.mock.calls[0][0] as FileView;
    const v = await mount(view, "Plan.md", content);
    await wait(20);
    expect(raw.vault.resolve).toHaveBeenCalledWith("note-id-1");
    expect(v.el.textContent).toContain("Alpha");
    expect(v.el.textContent).toContain("Alpha body text");

    const addText = v.el.querySelector<HTMLButtonElement>('button[title="Thêm khối chữ"]')!;
    await act(async () => addText.click());
    await wait(600);
    expect(v.setContent).toHaveBeenCalled();
    const written = v.setContent.mock.calls.at(-1)![0] as string;
    expect(written.startsWith("---\ncanvas: true\n---\n")).toBe(true);
    expect(parseCanvas(written.slice("---\ncanvas: true\n---\n".length)).nodes).toHaveLength(2);
    await v.unmount();
  });

  it("a change made elsewhere replaces the board; the last edit is written when the view closes", async () => {
    const { api, raw } = fakeApi("desktop");
    await canvas.onload(api);
    const view = raw.ui.registerFileView.mock.calls[0][0] as FileView;
    const v = await mount(view, "B.canvas", serializeCanvas({ nodes: [], edges: [] }));
    const other = { nodes: [{ id: "t", type: "text", x: 0, y: 0, width: 200, height: 80, text: "from source mode" }], edges: [] };
    await act(async () => v.inst.update!(serializeCanvas(other as never)));
    expect(v.el.textContent).toContain("from source mode");

    await act(async () => v.el.querySelector<HTMLButtonElement>('button[title="Add text node"]')!.click());
    expect(v.setContent).not.toHaveBeenCalled(); // still inside the debounce
    await v.unmount();
    expect(v.setContent).toHaveBeenCalledOnce();
    const written = v.setContent.mock.calls[0][0] as string;
    expect(written.startsWith("{")).toBe(true); // desktop: plain JSON, no frontmatter added
    expect(parseCanvas(written).nodes).toHaveLength(2);
  });

  it("services resolve images and uploads through the vault API", async () => {
    const { api, raw } = fakeApi("web");
    const services = pluginCanvasServices(api);
    expect(await services.images()).toEqual([{ target: "attachments/a.png", name: "a.png" }]);
    expect(await services.imageUrl("x")).toBe("url:x");
    expect(await services.uploadImage(new File(["x"], "pic.png"))).toBe("attachments/pic.png");
    expect(raw.vault.saveAttachment).toHaveBeenCalledWith("pic.png", expect.any(File));
  });
});

describe("drawing plugin", () => {
  it("recognises .drawing files and drawing notes", () => {
    expect(isDrawing({ path: "Sketch.drawing", content: "{}" })).toBe(true);
    expect(isDrawing({ path: "Sketch.md", content: "---\ndrawing: true\n---\n{}" })).toBe(true);
    expect(isDrawing({ path: "Sketch.md", content: "# note" })).toBe(false);
  });

  it("creates a .drawing file on desktop and a marked note on web", async () => {
    const desk = fakeApi("desktop");
    await drawing.onload(desk.api);
    await desk.raw.ui.addCommand.mock.calls[0][0].callback();
    expect(desk.raw.vault.write).toHaveBeenCalledWith("Drawing.drawing", serializeDrawing(createEmptyDrawing()));
    const web = fakeApi("web", ["Drawing.md"]);
    await drawing.onload(web.api);
    await web.raw.ui.addCommand.mock.calls[0][0].callback();
    expect(web.raw.vault.write.mock.calls[0][0]).toBe("Drawing 2.md");
    expect(web.raw.vault.write.mock.calls[0][1].startsWith("---\ndrawing: true\n---\n")).toBe(true);
  });

  it("clearing writes the drawing back as plain JSON on desktop (no frontmatter added)", async () => {
    const start = { ...createEmptyDrawing(), elements: [{ id: "e1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] };
    const { api, raw } = fakeApi("desktop");
    await drawing.onload(api);
    const view = raw.ui.registerFileView.mock.calls[0][0] as FileView;
    const v = await mount(view, "S.drawing", serializeDrawing(start as never));
    const clear = () => [...v.el.querySelectorAll("button")].find((b) => /clear/i.test(b.textContent ?? ""))!;
    await act(async () => clear().click());
    await act(async () => clear().click()); // the second click confirms
    await wait(800);
    expect(v.setContent).toHaveBeenCalled();
    const written = v.setContent.mock.calls.at(-1)![0] as string;
    expect(written.startsWith("{")).toBe(true);
    expect(parseDrawing(written)?.elements).toEqual([]);
    await v.unmount();
  });

  it("keeps a web note's frontmatter when saving", async () => {
    const { api, raw } = fakeApi("web");
    await drawing.onload(api);
    const view = raw.ui.registerFileView.mock.calls[0][0] as FileView;
    const fm = "---\ndrawing: true\n---\n";
    const start = { ...createEmptyDrawing(), elements: [{ id: "e1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] };
    const v = await mount(view, "S.md", fm + serializeDrawing(start as never));
    const clear = () => [...v.el.querySelectorAll("button")].find((b) => /xoá hết/i.test(b.textContent ?? ""))!;
    await act(async () => clear().click());
    await act(async () => clear().click());
    await wait(800);
    expect((v.setContent.mock.calls.at(-1)![0] as string).startsWith(fm)).toBe(true);
    await v.unmount();
  });
});
