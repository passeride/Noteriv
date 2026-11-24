import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";
import { isPdfFile } from "./annotations";
import { PDFViewer } from "./PDFViewer";
import { pluginPdfServices, type PdfLabels } from "./services";

export { annotationsToMarkdown, readStoredAnnotations, toStoredAnnotations, generateAnnotationId, isPdfFile, type PDFAnnotation } from "./annotations";
export { exportPath, pluginPdfServices, type PdfServices, type PdfLabels } from "./services";

export const VIEWER_ID = "pdf";

function labelsFor(api: PluginApi): PdfLabels {
  const t = pluginT(api, "pdfViewer");
  return {
    loading: t("loading"),
    loadFailed: t("loadFailed"),
    openFailed: t("openFailed"),
    previousPage: t("previousPage"),
    nextPage: t("nextPage"),
    zoomIn: t("zoomIn"),
    zoomOut: t("zoomOut"),
    fitWidth: t("fitWidth"),
    fitPage: t("fitPage"),
    select: t("select"),
    highlight: t("highlight"),
    note: t("note"),
    underline: t("underline"),
    toggleSidebar: t("toggleSidebar"),
    export: t("export"),
    close: t("close"),
    notePlaceholder: t("notePlaceholder"),
    commentPlaceholder: t("commentPlaceholder"),
    addNote: t("addNote"),
    cancel: t("cancel"),
    save: t("save"),
    delete: t("delete"),
    annotations: t("annotations"),
    empty: t("empty"),
    pageShort: t("pageShort"),
    exportFailed: t("exportFailed"),
    markdown: {
      title: (file) => t("markdown.title", { file }),
      highlights: t("markdown.highlights"),
      underlines: t("markdown.underlines"),
      notes: t("markdown.notes"),
      page: (page) => t("markdown.page", { page }),
    },
  };
}

/** PDF viewer: read PDFs and annotate them (highlight, underline, notes); export the annotations to a note. */
const pdfViewer: CorePlugin = {
  onload(api: PluginApi) {
    const labels = labelsFor(api);
    api.ui.registerAttachmentViewer({
      id: VIEWER_ID,
      match: (file) => isPdfFile(file.name),
      mount(container, ctx) {
        const services = pluginPdfServices(api, labels, () => ctx.close());
        const root = createRoot(container);
        root.render(createElement(PDFViewer, { target: ctx.target, name: ctx.name, services, labels, onClose: () => ctx.close() }));
        // Unmount may be asked for while React is dispatching one of the viewer's own events: wait a tick.
        return () => void setTimeout(() => root.unmount(), 0);
      },
    });
  },
};

export default pdfViewer;
