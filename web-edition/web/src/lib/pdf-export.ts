/**
 * PDF Export — converts markdown to styled HTML and triggers the browser print dialog.
 * Ported verbatim from desktop/src/lib/pdf-export.ts: confirmed to use only
 * `document.createElement("iframe")` + `window.print()`, no Tauri API at all.
 */

import { markdownToHTML, preRenderCodeBlocks } from "@noteriv/core/markdown-to-html";
import { webApi } from "./webApi";

/**
 * Print stylesheet for PDF export.
 * Uses serif fonts, proper margins, and page breaks before h1.
 */
function buildPrintStyles(columnLayout: 1 | 2, chessboardWidthPercent: 75 | 100): string {
  return `
  @page {
    margin: 2cm;
    size: A4;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    /* Georgia has no precomposed Vietnamese glyphs (marks float beside the letters); these do. */
    font-family: "Noto Serif", "Liberation Serif", "Times New Roman", "DejaVu Serif", Georgia, serif;
    font-size: 12pt;
    line-height: 1.7;
    color: #1a1a1a;
    background: #fff;
    max-width: 100%;
    padding: 0;
  }

  h1 {
    font-size: 24pt;
    font-weight: 700;
    margin: 1.5em 0 0.5em;
    color: #111;
    border-bottom: 1px solid #ccc;
    padding-bottom: 0.3em;
    page-break-before: always;
  }

  h1:first-child {
    page-break-before: avoid;
  }

  h2 {
    font-size: 18pt;
    font-weight: 600;
    margin: 1.2em 0 0.4em;
    color: #222;
  }

  h3 {
    font-size: 14pt;
    font-weight: 600;
    margin: 1em 0 0.3em;
    color: #333;
  }

  h4, h5, h6 {
    font-size: 12pt;
    font-weight: 600;
    margin: 0.8em 0 0.3em;
    color: #444;
  }

  p {
    margin: 0.6em 0;
  }

  a {
    color: #2563eb;
    text-decoration: underline;
  }

  code {
    font-family: "Noto Sans Mono", "Liberation Mono", "Courier New", "DejaVu Sans Mono", monospace;
    font-size: 0.9em;
    background: #f3f4f6;
    padding: 0.15em 0.35em;
    border-radius: 3px;
  }

  pre {
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 0.8em 1em;
    overflow-x: auto;
    margin: 1em 0;
    page-break-inside: avoid;
  }

  pre code {
    background: none;
    padding: 0;
    font-size: 0.85em;
    line-height: 1.5;
  }

  blockquote {
    border-left: 3px solid #9ca3af;
    padding: 0.4em 1em;
    margin: 1em 0;
    color: #4b5563;
    font-style: italic;
    page-break-inside: avoid;
  }

  ul, ol {
    padding-left: 1.5em;
    margin: 0.6em 0;
  }

  li {
    margin: 0.2em 0;
  }

  hr {
    border: none;
    border-top: 1px solid #d1d5db;
    margin: 1.5em 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    page-break-inside: avoid;
  }

  th, td {
    border: 1px solid #d1d5db;
    padding: 0.4em 0.6em;
    text-align: left;
  }

  th {
    background: #f3f4f6;
    font-weight: 600;
  }

  img {
    max-width: 100%;
    page-break-inside: avoid;
  }

  .md-codeblock-plugin, .chessboard-plugin-widget {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .pdf-columns {
    column-count: ${columnLayout};
    column-gap: 1cm;
  }

  .chessboard-plugin-widget svg {
    max-width: ${chessboardWidthPercent}% !important;
  }

  input[type="checkbox"] {
    margin-right: 0.4em;
  }

  del {
    text-decoration: line-through;
    color: #9ca3af;
  }

  .pdf-title {
    font-size: 28pt;
    font-weight: 700;
    margin-bottom: 0.5em;
    color: #111;
    border-bottom: 2px solid #111;
    padding-bottom: 0.3em;
    page-break-before: avoid;
  }
`;
}

export interface PdfOptions {
  columnLayout?: 1 | 2;
  chessboardWidthPercent?: 75 | 100;
}

const MAX_INLINE_BYTES = 24 * 1024 * 1024;

/**
 * Replaces same-origin attachment URLs with data: URLs. The server-side renderer has no session cookie
 * (and no network at all), so images must travel inside the HTML.
 */
async function inlineImages(html: string): Promise<string> {
  const re = /(<img\b[^>]*?\bsrc=")((?:https?:\/\/[^/"]+)?\/api\/v1\/[^"]+)(")/g;
  const urls = Array.from(new Set(Array.from(html.matchAll(re)).map((m) => m[2])));
  const replacement = new Map<string, string>();
  let total = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) continue;
      const blob = await res.blob();
      total += blob.size;
      if (total > MAX_INLINE_BYTES) break;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
      replacement.set(url, dataUrl);
    } catch {
      // an image that can't be fetched is simply left out of the PDF
    }
  }
  return html.replace(re, (whole, head: string, url: string, tail: string) => {
    const data = replacement.get(url);
    return data ? `${head}${data}${tail}` : whole;
  });
}

/** The complete, self-contained HTML document used by both Print and Download. */
async function buildPdfDocument(content: string, title: string, options?: PdfOptions): Promise<string> {
  const columnLayout = options?.columnLayout ?? 2;
  const chessboardWidthPercent = options?.chessboardWidthPercent ?? 75;

  const preRendered = await preRenderCodeBlocks(content);
  const htmlContent = await inlineImages(markdownToHTML(content, { preRendered }));
  const displayTitle = title.replace(/\.(md|markdown)$/i, "");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(displayTitle)}</title>
  <style>${buildPrintStyles(columnLayout, chessboardWidthPercent)}</style>
</head>
<body>
  <div class="pdf-title">${escapeHtml(displayTitle)}</div>
  <div class="pdf-columns">${htmlContent}</div>
</body>
</html>
  `.trim();
}

/**
 * Print: opens the browser's print dialog (the user can pick "Save as PDF").
 * Kept as the "In…" command; the main export is `downloadPdf`.
 */
export async function exportToPDF(content: string, title: string, options?: PdfOptions): Promise<void> {
  const fullHTML = await buildPdfDocument(content, title, options);

  // Create a hidden iframe, write the HTML, and trigger print
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-10000px";
  iframe.style.left = "-10000px";
  iframe.style.width = "210mm";
  iframe.style.height = "297mm";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  return new Promise<void>((resolve) => {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      resolve();
      return;
    }

    iframeDoc.open();
    iframeDoc.write(fullHTML);
    iframeDoc.close();

    // Wait for content to render before printing
    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.print();
        // Clean up after a delay to let print dialog close
        setTimeout(() => {
          if (iframe.parentNode) document.body.removeChild(iframe);
          resolve();
        }, 1000);
      }, 250);
    };

    // Fallback: if onload doesn't fire (inline content), trigger manually
    setTimeout(() => {
      try {
        iframe.contentWindow?.print();
      } catch {
        // Ignore if already printing
      }
      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
        resolve();
      }, 1000);
    }, 500);
  });
}

/**
 * Download: the browser builds the document (plugin blocks drawn, images inlined), the server renders
 * it to a real PDF with headless Chromium and the file is saved as "<note name>.pdf".
 */
export async function renderPdf(
  vaultId: string,
  noteId: string,
  content: string,
  title: string,
  options?: PdfOptions
): Promise<{ blob: Blob; filename: string }> {
  const html = await buildPdfDocument(content, title, options);
  const blob = await webApi.pdf.render(vaultId, noteId, html, title);
  const filename = `${title.replace(/\.(md|markdown)$/i, "").replace(/[\\/:*?"<>|]/g, " ").trim() || "note"}.pdf`;
  return { blob, filename };
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadPdf(
  vaultId: string,
  noteId: string,
  content: string,
  title: string,
  options?: PdfOptions
): Promise<void> {
  const { blob, filename } = await renderPdf(vaultId, noteId, content, title, options);
  saveBlob(blob, filename);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
