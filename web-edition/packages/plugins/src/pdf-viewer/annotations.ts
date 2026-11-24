/**
 * PDF annotations: the data shape, reading the forms they were stored in, and the markdown export. Pure.
 *
 * Storage (through `vault.get/setAttachmentData`): web keeps a bare `PDFAnnotation[]` on the attachment; desktop keeps
 * `{ pdfPath, annotations }` in `.<name>-annotations.json` beside the PDF (the sidecar from before 2.5c). Both forms are
 * read; each platform keeps writing its own.
 */

export interface PDFAnnotation {
  id: string;
  page: number;
  type: "highlight" | "note" | "underline";
  text: string;
  comment: string;
  color: string;
  rect: { x: number; y: number; w: number; h: number };
  created: number;
}

/** Headings and page references of the exported note, in the user's language. */
export interface AnnotationsMarkdownText {
  title: (file: string) => string;
  highlights: string;
  underlines: string;
  notes: string;
  page: (page: number) => string;
}

const ENGLISH_MARKDOWN: AnnotationsMarkdownText = {
  title: (file) => `Annotations: ${file}`,
  highlights: "Highlights",
  underlines: "Underlines",
  notes: "Notes",
  page: (page) => `page ${page}`,
};

/** Generate a markdown note from a PDF's filename + its annotations */
export function annotationsToMarkdown(fileName: string, anns: PDFAnnotation[], text: AnnotationsMarkdownText = ENGLISH_MARKDOWN): string {
  const sorted = [...anns].sort((a, b) => a.page - b.page || a.created - b.created);

  const highlights = sorted.filter((a) => a.type === "highlight");
  const notes = sorted.filter((a) => a.type === "note");
  const underlines = sorted.filter((a) => a.type === "underline");

  const lines: string[] = [];
  lines.push(`# ${text.title(fileName)}`);
  lines.push("");

  if (highlights.length > 0) {
    lines.push(`## ${text.highlights}`);
    lines.push("");
    for (const h of highlights) {
      lines.push(`> ${h.text} — (${text.page(h.page)})`);
      if (h.comment) {
        lines.push("");
        lines.push(h.comment);
      }
      lines.push("");
    }
  }

  if (underlines.length > 0) {
    lines.push(`## ${text.underlines}`);
    lines.push("");
    for (const u of underlines) {
      lines.push(`> ${u.text} — (${text.page(u.page)})`);
      if (u.comment) {
        lines.push("");
        lines.push(u.comment);
      }
      lines.push("");
    }
  }

  if (notes.length > 0) {
    lines.push(`## ${text.notes}`);
    lines.push("");
    for (const n of notes) {
      lines.push(`- ${n.text || n.comment} (${text.page(n.page)})`);
      if (n.text && n.comment) {
        lines.push(`  ${n.comment}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** Generate a unique annotation ID */
export function generateAnnotationId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Check if a filename is a PDF */
export function isPdfFile(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

/** Annotations from whatever was stored: a bare array (web) or `{ annotations }` (desktop sidecar). */
export function readStoredAnnotations(stored: unknown): PDFAnnotation[] {
  const list = Array.isArray(stored)
    ? stored
    : stored && typeof stored === "object" && Array.isArray((stored as { annotations?: unknown }).annotations)
      ? (stored as { annotations: unknown[] }).annotations
      : [];
  return list.filter(
    (a): a is PDFAnnotation => !!a && typeof a === "object" && typeof (a as PDFAnnotation).id === "string" && typeof (a as PDFAnnotation).page === "number"
  );
}

/** What to store for a platform: desktop keeps its sidecar shape, web the bare array. */
export function toStoredAnnotations(platform: "web" | "desktop", target: string, anns: PDFAnnotation[]): unknown {
  return platform === "desktop" ? { pdfPath: target, annotations: anns } : anns;
}
