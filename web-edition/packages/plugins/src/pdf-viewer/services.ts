import type { PluginApi } from "@noteriv/plugin-api";
import { folderOf } from "../shared/vault";
import { annotationsToMarkdown, readStoredAnnotations, toStoredAnnotations, type AnnotationsMarkdownText, type PDFAnnotation } from "./annotations";

/** The part of pdf.js the viewer uses. */
export interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDocument(src: { data: Uint8Array }): { promise: Promise<any> };
}

/** Everything the PDF viewer reads or writes outside itself. */
export interface PdfServices {
  loadPdfjs(): Promise<PdfJs>;
  readPdf(target: string): Promise<ArrayBuffer | null>;
  loadAnnotations(target: string): Promise<PDFAnnotation[]>;
  saveAnnotations(target: string, anns: PDFAnnotation[]): Promise<void>;
  /** Writes the annotations to a new note and opens it. */
  exportAnnotations(target: string, name: string, anns: PDFAnnotation[]): Promise<void>;
}

export interface PdfLabels {
  loading: string;
  loadFailed: string;
  openFailed: string;
  previousPage: string;
  nextPage: string;
  zoomIn: string;
  zoomOut: string;
  fitWidth: string;
  fitPage: string;
  select: string;
  highlight: string;
  note: string;
  underline: string;
  toggleSidebar: string;
  export: string;
  close: string;
  notePlaceholder: string;
  commentPlaceholder: string;
  addNote: string;
  cancel: string;
  save: string;
  delete: string;
  annotations: string;
  empty: string;
  pageShort: string;
  exportFailed: string;
  /** The exported note. */
  markdown: AnnotationsMarkdownText;
}

/**
 * pdf.js 5 is loaded natively from the app's own copy (`public/pdf.min.mjs` and its worker, both apps): bundlers trip
 * over its ESM build, so the import is hidden from them. Loaded once.
 */
let pdfjs: Promise<PdfJs> | null = null;
export function loadAppPdfjs(): Promise<PdfJs> {
  if (!pdfjs) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const nativeImport = new Function("u", "return import(u)") as (u: string) => Promise<unknown>;
    pdfjs = nativeImport("/pdf.min.mjs").then((mod) => {
      const lib = mod as PdfJs;
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
    pdfjs.catch(() => {
      pdfjs = null;
    });
  }
  return pdfjs;
}

/** `<name> - Annotations.md` in `dir`, numbered when taken: an export never overwrites a note. */
export async function exportPath(api: PluginApi, dir: string, pdfName: string): Promise<string> {
  const base = `${dir ? `${dir}/` : ""}${pdfName.replace(/\.pdf$/i, "")} - Annotations`;
  for (let n = 1; ; n++) {
    const path = n === 1 ? `${base}.md` : `${base} ${n}.md`;
    if (!(await api.vault.exists(path))) return path;
  }
}

export function pluginPdfServices(api: PluginApi, labels: PdfLabels, onExported: () => void): PdfServices {
  const platform = api.app.platform;
  return {
    loadPdfjs: loadAppPdfjs,
    readPdf: (target) => api.vault.readAttachment(target),
    async loadAnnotations(target) {
      return readStoredAnnotations(await api.vault.getAttachmentData(target));
    },
    async saveAnnotations(target, anns) {
      await api.vault.setAttachmentData(target, toStoredAnnotations(platform, target, anns));
    },
    async exportAnnotations(target, name, anns) {
      try {
        // Desktop: beside the PDF when it is in the vault. Web: attachments have no folder, so the vault root.
        const inVault = platform === "desktop" && !/^([a-zA-Z]:[\\/]|\/)/.test(target);
        const path = await exportPath(api, inVault ? folderOf(target) : "", name);
        await api.vault.write(path, annotationsToMarkdown(name, anns, labels.markdown));
        await api.workspace.openFile(path);
        onExported();
      } catch (e) {
        console.error("[pdf-viewer] export failed:", e);
        api.ui.showNotice(labels.exportFailed);
      }
    },
  };
}
