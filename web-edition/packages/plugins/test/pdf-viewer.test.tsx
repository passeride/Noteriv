import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { platformI18n } from "./i18n";
import type { AttachmentViewer, PluginApi } from "@noteriv/plugin-api";
import pdfViewer, {
  annotationsToMarkdown,
  exportPath,
  pluginPdfServices,
  readStoredAnnotations,
  toStoredAnnotations,
  type PDFAnnotation,
  type PdfServices,
} from "../src/pdf-viewer";
import { PDFViewer } from "../src/pdf-viewer/PDFViewer";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

const ann = (over: Partial<PDFAnnotation> = {}): PDFAnnotation => ({
  id: "a1",
  page: 1,
  type: "highlight",
  text: "important line",
  comment: "why it matters",
  color: "#f9e2af",
  rect: { x: 10, y: 10, w: 50, h: 10 },
  created: 1,
  ...over,
});

describe("annotations", () => {
  it("reads both stored forms and writes each platform's own", () => {
    const list = [ann()];
    expect(readStoredAnnotations(list)).toEqual(list);
    expect(readStoredAnnotations({ pdfPath: "C:/v/a.pdf", annotations: list })).toEqual(list);
    expect(readStoredAnnotations(null)).toEqual([]);
    expect(readStoredAnnotations([{ junk: true }])).toEqual([]);
    expect(toStoredAnnotations("web", "u", list)).toEqual(list);
    expect(toStoredAnnotations("desktop", "Docs/a.pdf", list)).toEqual({ pdfPath: "Docs/a.pdf", annotations: list });
  });

  it("exports highlights, underlines and notes as markdown", () => {
    const md = annotationsToMarkdown("paper.pdf", [ann(), ann({ id: "n", type: "note", page: 2, text: "", comment: "check this" })]);
    expect(md).toContain("# Annotations: paper.pdf");
    expect(md).toContain("> important line — (page 1)");
    expect(md).toContain("- check this (page 2)");
  });
});

function fakeApi(platform: "web" | "desktop", existing: string[] = []) {
  const files = new Set(existing);
  const raw = {
    app: { platform },
    i18n: platformI18n(platform),
    vault: {
      exists: vi.fn(async (p: string) => files.has(p)),
      write: vi.fn(async (p: string, _c: string) => void files.add(p)),
      readAttachment: vi.fn(async () => new ArrayBuffer(8)),
      getAttachmentData: vi.fn(async () => [ann()]),
      setAttachmentData: vi.fn(async () => {}),
    },
    ui: { registerAttachmentViewer: vi.fn(), showNotice: vi.fn() },
    workspace: { openFile: vi.fn(async () => true) },
  };
  return { api: raw as unknown as PluginApi, raw };
}

describe("pdf-viewer services", () => {
  it("exports beside the PDF on desktop without overwriting, then opens the note", async () => {
    const { api, raw } = fakeApi("desktop", ["Docs/paper - Annotations.md"]);
    expect(await exportPath(api, "Docs", "paper.pdf")).toBe("Docs/paper - Annotations 2.md");
    const onExported = vi.fn();
    await pluginPdfServices(api, {} as never, onExported).exportAnnotations("Docs/paper.pdf", "paper.pdf", [ann()]);
    expect(raw.vault.write).toHaveBeenCalledWith("Docs/paper - Annotations 2.md", expect.stringContaining("important line"));
    expect(raw.workspace.openFile).toHaveBeenCalledWith("Docs/paper - Annotations 2.md");
    expect(onExported).toHaveBeenCalled();
  });

  it("exports to the vault root on web; stores annotations in each platform's form", async () => {
    const web = fakeApi("web");
    const s = pluginPdfServices(web.api, {} as never, () => {});
    await s.exportAnnotations("/api/v1/vaults/v/attachments/x/download", "paper.pdf", [ann()]);
    expect(web.raw.vault.write.mock.calls[0][0]).toBe("paper - Annotations.md");
    await s.saveAnnotations("t", [ann()]);
    expect(web.raw.vault.setAttachmentData).toHaveBeenCalledWith("t", [ann()]);
    const desk = fakeApi("desktop");
    await pluginPdfServices(desk.api, {} as never, () => {}).saveAnnotations("a.pdf", []);
    expect(desk.raw.vault.setAttachmentData).toHaveBeenCalledWith("a.pdf", { pdfPath: "a.pdf", annotations: [] });
  });

  it("registers a viewer for .pdf attachments", async () => {
    const { api, raw } = fakeApi("web");
    await pdfViewer.onload(api);
    const viewer = raw.ui.registerAttachmentViewer.mock.calls[0][0] as AttachmentViewer;
    expect(viewer.match({ target: "x", name: "paper.PDF" })).toBe(true);
    expect(viewer.match({ target: "x", name: "photo.png" })).toBe(false);
  });
});

describe("PDFViewer", () => {
  function fakeServices(stored: PDFAnnotation[]): PdfServices & { saveAnnotations: ReturnType<typeof vi.fn> } {
    const page = {
      getViewport: () => ({ width: 200, height: 300 }),
      render: () => ({ promise: Promise.resolve(), cancel() {} }),
      getTextContent: async () => ({ items: [] }),
    };
    return {
      loadPdfjs: async () => ({
        GlobalWorkerOptions: { workerSrc: "" },
        getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async () => page }) }),
      }),
      readPdf: async () => new ArrayBuffer(8),
      loadAnnotations: async () => stored,
      saveAnnotations: vi.fn(async () => {}),
      exportAnnotations: vi.fn(async () => {}),
    };
  }
  const labels = new Proxy({}, { get: (_t, k) => String(k) }) as never;

  it("shows the pages and the stored annotations; a deletion is saved when the viewer closes", async () => {
    const { createRoot } = await import("react-dom/client");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    const services = fakeServices([ann()]);
    await act(async () => root.render(<PDFViewer target="t" name="paper.pdf" services={services} labels={labels} onClose={() => {}} />));
    await wait(50);
    expect(el.textContent).toContain("1 / 2");
    expect(el.textContent).toContain("annotations (1)");
    expect(el.textContent).toContain("important line");

    // Click the highlight on the page (select tool), then delete it from the sidebar editor.
    const overlay = el.querySelector<HTMLElement>('[title="why it matters"]')!;
    await act(async () => overlay.click());
    const del = [...el.querySelectorAll("button")].find((b) => b.textContent === "delete")!;
    await act(async () => del.click());
    expect(services.saveAnnotations).not.toHaveBeenCalled(); // still within the 500 ms pause
    await act(async () => root.unmount());
    expect(services.saveAnnotations).toHaveBeenCalledWith("t", []);
    el.remove();
  });
});
