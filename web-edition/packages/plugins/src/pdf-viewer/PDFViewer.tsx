// PDF reader with annotations (highlight, underline, note), shared by web and desktop since 2.5c. Ported from the web
// app's PDFViewer, itself a line-by-line port of desktop's. It fills its container: a desktop tab, or the overlay the web
// app shows over the page. All I/O goes through `PdfServices` (services.ts): pdf.js, the PDF bytes, the annotations kept
// with the attachment, and exporting them to a note.

import { useState, useRef, useEffect, useCallback } from "react";
import { type PDFAnnotation, generateAnnotationId } from "./annotations";
import type { PdfLabels, PdfServices } from "./services";

interface PDFViewerProps {
  /** The attachment, as the services take it. */
  target: string;
  /** File name, shown in the toolbar and used for the export. */
  name: string;
  services: PdfServices;
  labels: PdfLabels;
  onClose: () => void;
}

type AnnotationTool = "select" | "highlight" | "note" | "underline";
type HighlightColor = "yellow" | "green" | "blue" | "pink";

const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: "#f9e2af",
  green: "#a6e3a1",
  blue: "#89b4fa",
  pink: "#f5c2e7",
};

// Fallback palette (Catppuccin Mocha). At runtime these are overridden by the
// active theme's CSS variables — see the readColors effect below.
const DEFAULT_C = {
  base: "#1e1e2e",
  surface0: "#313244",
  surface1: "#45475a",
  overlay0: "#6c7086",
  text: "#cdd6f4",
  subtext: "#a6adc8",
  blue: "#89b4fa",
  red: "#f38ba8",
  mantle: "#181825",
};

// Pages render at zoom * BASE_SCALE px (1.5x base keeps text crisp); the
// displayed zoom % is relative to BASE_SCALE.
const BASE_SCALE = 1.5;

interface PageRenderState {
  canvas: HTMLCanvasElement | null;
  textItems: Array<{ str: string; x: number; y: number; w: number; h: number }>;
  viewport: { width: number; height: number; scale: number };
}

export function PDFViewer({ target, name, services, labels, onClose }: PDFViewerProps) {
  const [C, setC] = useState(DEFAULT_C);
  useEffect(() => {
    const readColors = () => {
      const s = getComputedStyle(document.documentElement);
      const v = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
      setC({
        base: v("--bg-primary", DEFAULT_C.base),
        surface0: v("--bg-surface", DEFAULT_C.surface0),
        surface1: v("--bg-hover", DEFAULT_C.surface1),
        overlay0: v("--text-muted", DEFAULT_C.overlay0),
        text: v("--text-primary", DEFAULT_C.text),
        subtext: v("--text-secondary", DEFAULT_C.subtext),
        blue: v("--accent", DEFAULT_C.blue),
        red: v("--red", DEFAULT_C.red),
        mantle: v("--bg-secondary", DEFAULT_C.mantle),
      });
    };
    readColors();
    const observer = new MutationObserver(readColors);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePages, setActivePages] = useState<Set<number>>(new Set());

  const [annotations, setAnnotations] = useState<PDFAnnotation[]>([]);
  const [tool, setTool] = useState<AnnotationTool>("select");
  const [highlightColor, setHighlightColor] = useState<HighlightColor>("yellow");
  const [showSidebar, setShowSidebar] = useState(true);
  const [editingAnnotation, setEditingAnnotation] = useState<string | null>(null);
  const [editComment, setEditComment] = useState("");
  const [notePopover, setNotePopover] = useState<{ x: number; y: number; page: number } | null>(null);
  const [noteText, setNoteText] = useState("");

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number; page: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);

  const pdfDocRef = useRef<any>(null);
  const pageRenderStates = useRef<Map<number, PageRenderState>>(new Map());
  const renderTasksRef = useRef<Map<number, { cancel: () => void; promise: Promise<void> }>>(new Map());
  const firstPageSizeRef = useRef<{ w: number; h: number } | null>(null);
  const pageSizesRef = useRef<Map<number, { w: number; h: number }>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Annotations kept with the attachment, read fresh when the viewer opens.
  useEffect(() => {
    let cancelled = false;
    void services
      .loadAnnotations(target)
      .catch(() => [])
      .then((anns) => !cancelled && setAnnotations(anns));
    return () => {
      cancelled = true;
    };
  }, [services, target]);

  // Load the PDF bytes and hand them to pdf.js.
  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);

        const pdfjsLib = await services.loadPdfjs();
        const data = await services.readPdf(target);
        if (cancelled) return;
        if (!data) { setError(labels.loadFailed); setLoading(false); return; }
        const bytes = new Uint8Array(data);

        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        try {
          const p1 = await doc.getPage(1);
          const vp1 = p1.getViewport({ scale: 1 });
          firstPageSizeRef.current = { w: vp1.width, h: vp1.height };
          pageSizesRef.current.set(1, { w: vp1.width, h: vp1.height });
        } catch { /* non-fatal */ }
        if (cancelled) return;
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err: unknown) {
        const e = err as Error;
        if (!cancelled) { setError(e?.message || labels.openFailed); setLoading(false); }
      }
    }
    loadPdf();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, target]);

  // Annotation edits are saved after a short pause, and on close if one is still waiting.
  const pendingRef = useRef<PDFAnnotation[] | null>(null);
  const flushSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    const anns = pendingRef.current;
    if (!anns) return;
    pendingRef.current = null;
    void services.saveAnnotations(target, anns).catch(() => {});
  }, [services, target]);
  useEffect(() => flushSave, [flushSave]);

  const debounceSave = useCallback((anns: PDFAnnotation[]) => {
    pendingRef.current = anns;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(flushSave, 500);
  }, [flushSave]);

  const updateAnnotations = useCallback((anns: PDFAnnotation[]) => {
    setAnnotations(anns);
    debounceSave(anns);
  }, [debounceSave]);

  const renderPage = useCallback(async (pageNum: number, canvas: HTMLCanvasElement) => {
    if (!pdfDocRef.current) return;
    const prev = renderTasksRef.current.get(pageNum);
    if (prev) {
      prev.cancel();
      try { await prev.promise; } catch { /* RenderingCancelledException */ }
      renderTasksRef.current.delete(pageNum);
    }

    const page = await pdfDocRef.current.getPage(pageNum);
    const scale = zoom * BASE_SCALE;
    const viewport = page.getViewport({ scale });
    pageSizesRef.current.set(pageNum, { w: viewport.width / scale, h: viewport.height / scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const task = page.render({ canvasContext: ctx, viewport });
    renderTasksRef.current.set(pageNum, task);
    try {
      await task.promise;
    } catch (e) {
      if ((e as Error)?.name === "RenderingCancelledException") return;
      throw e;
    } finally {
      if (renderTasksRef.current.get(pageNum) === task) renderTasksRef.current.delete(pageNum);
    }

    const textContent = await page.getTextContent();
    const textItems: PageRenderState["textItems"] = [];
    for (const item of textContent.items) {
      if (!("str" in item)) continue;
      const tx = (item as { transform: number[] }).transform;
      const fontSize = Math.abs(tx[3]) * scale;
      const x = tx[4] * scale;
      const y = viewport.height - tx[5] * scale - fontSize;
      const w = ((item as { width?: number }).width || 0) * scale;
      const h = fontSize;
      textItems.push({ str: (item as { str: string }).str, x, y, w, h });
    }

    pageRenderStates.current.set(pageNum, { canvas, textItems, viewport: { width: viewport.width, height: viewport.height, scale } });
  }, [zoom]);

  useEffect(() => {
    if (loading || numPages === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const io = new IntersectionObserver(
      (entries) => {
        setActivePages((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const pageNum = parseInt((entry.target as HTMLElement).getAttribute("data-page-container") || "0");
            if (!pageNum) continue;
            if (entry.isIntersecting && !next.has(pageNum)) { next.add(pageNum); changed = true; }
            else if (!entry.isIntersecting && next.has(pageNum)) { next.delete(pageNum); changed = true; }
          }
          return changed ? next : prev;
        });
      },
      { root: container, rootMargin: "1000px 0px" }
    );
    container.querySelectorAll("[data-page-container]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [numPages, loading]);

  useEffect(() => {
    if (!pdfDocRef.current || loading) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const targetScale = zoom * BASE_SCALE;

    activePages.forEach((pageNum) => {
      const canvas = container.querySelector<HTMLCanvasElement>(`canvas[data-page="${pageNum}"]`);
      if (!canvas) return;
      const st = pageRenderStates.current.get(pageNum);
      if (st && st.canvas === canvas && Math.abs(st.viewport.scale - targetScale) < 0.001) return;
      renderPage(pageNum, canvas);
    });

    for (const pageNum of Array.from(pageRenderStates.current.keys())) {
      if (!activePages.has(pageNum)) {
        renderTasksRef.current.get(pageNum)?.cancel();
        renderTasksRef.current.delete(pageNum);
        pageRenderStates.current.delete(pageNum);
      }
    }
  }, [activePages, zoom, loading, numPages, renderPage]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const children = container.querySelectorAll("[data-page-container]");
      let closest = 1;
      let minDist = Infinity;
      const scrollTop = container.scrollTop + container.clientHeight / 3;
      children.forEach((child) => {
        const el = child as HTMLElement;
        const dist = Math.abs(el.offsetTop - scrollTop);
        if (dist < minDist) { minDist = dist; closest = parseInt(el.getAttribute("data-page-container") || "1"); }
      });
      setCurrentPage(closest);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [numPages, loading]);

  const goToPage = useCallback((page: number) => {
    const clamped = Math.max(1, Math.min(page, numPages));
    setCurrentPage(clamped);
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-page-container="${clamped}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [numPages]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.25, 4)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.25, 0.25)), []);
  const clampZoom = (z: number) => Math.max(0.25, Math.min(4, z));

  const fitWidth = useCallback(() => {
    const scroll = scrollContainerRef.current;
    const fp = firstPageSizeRef.current;
    if (!scroll || !fp || fp.w === 0) return;
    const availW = scroll.clientWidth - 40;
    setZoom(clampZoom(availW / (fp.w * BASE_SCALE)));
  }, []);

  const fitPage = useCallback(() => {
    const scroll = scrollContainerRef.current;
    const fp = firstPageSizeRef.current;
    if (!scroll || !fp || fp.w === 0 || fp.h === 0) return;
    const availW = scroll.clientWidth - 40;
    const availH = scroll.clientHeight - 40;
    setZoom(clampZoom(Math.min(availW / (fp.w * BASE_SCALE), availH / (fp.h * BASE_SCALE))));
  }, []);

  const fittedRef = useRef(false);
  useEffect(() => {
    if (loading || numPages === 0 || fittedRef.current) return;
    requestAnimationFrame(() => {
      if (fittedRef.current) return;
      fittedRef.current = true;
      fitPage();
    });
  }, [loading, numPages, fitPage]);

  const pageDims = useCallback((pageNum: number) => {
    const scale = zoom * BASE_SCALE;
    const intrinsic = pageSizesRef.current.get(pageNum) || firstPageSizeRef.current;
    if (!intrinsic) return { w: 612 * scale, h: 792 * scale };
    return { w: intrinsic.w * scale, h: intrinsic.h * scale };
  }, [zoom]);

  const scrollToAnnotation = useCallback((ann: PDFAnnotation) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-page-container="${ann.page}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handlePageMouseDown = useCallback((e: React.MouseEvent, pageNum: number) => {
    if (tool === "select") return;
    if (tool === "note") {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setNotePopover({ x: e.clientX - rect.left, y: e.clientY - rect.top, page: pageNum });
      setNoteText("");
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setIsSelecting(true);
    setSelectionStart({ x, y, page: pageNum });
    setSelectionEnd({ x, y });
  }, [tool]);

  const handlePageMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !selectionStart) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSelectionEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [isSelecting, selectionStart]);

  const handlePageMouseUp = useCallback(() => {
    if (!isSelecting || !selectionStart || !selectionEnd) { setIsSelecting(false); return; }

    const pageNum = selectionStart.page;
    const pageState = pageRenderStates.current.get(pageNum);
    if (!pageState) { setIsSelecting(false); return; }

    const minX = Math.min(selectionStart.x, selectionEnd.x);
    const maxX = Math.max(selectionStart.x, selectionEnd.x);
    const minY = Math.min(selectionStart.y, selectionEnd.y);
    const maxY = Math.max(selectionStart.y, selectionEnd.y);

    const selectedTexts: string[] = [];
    const rects: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (const item of pageState.textItems) {
      const itemCenterX = item.x + item.w / 2;
      const itemCenterY = item.y + item.h / 2;
      const intersects = item.x < maxX && item.x + item.w > minX && item.y < maxY && item.y + item.h > minY;
      const centerInside = itemCenterX >= minX && itemCenterX <= maxX && itemCenterY >= minY && itemCenterY <= maxY;
      if ((intersects || centerInside) && item.str.trim()) { selectedTexts.push(item.str); rects.push({ x: item.x, y: item.y, w: item.w, h: item.h }); }
    }

    if (selectedTexts.length > 0) {
      const bx = Math.min(...rects.map((r) => r.x));
      const by = Math.min(...rects.map((r) => r.y));
      const bx2 = Math.max(...rects.map((r) => r.x + r.w));
      const by2 = Math.max(...rects.map((r) => r.y + r.h));
      const scale = pageState.viewport.scale;
      const ann: PDFAnnotation = {
        id: generateAnnotationId(),
        page: pageNum,
        type: tool === "highlight" ? "highlight" : "underline",
        text: selectedTexts.join(" "),
        comment: "",
        color: HIGHLIGHT_COLORS[highlightColor],
        rect: { x: bx / scale, y: by / scale, w: (bx2 - bx) / scale, h: (by2 - by) / scale },
        created: Date.now(),
      };
      updateAnnotations([...annotations, ann]);
    }

    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  }, [isSelecting, selectionStart, selectionEnd, tool, highlightColor, annotations, updateAnnotations]);

  const handleCreateNote = useCallback(() => {
    if (!notePopover || !noteText.trim()) { setNotePopover(null); return; }
    const pageState = pageRenderStates.current.get(notePopover.page);
    const scale = pageState?.viewport?.scale || 1;
    const ann: PDFAnnotation = {
      id: generateAnnotationId(),
      page: notePopover.page,
      type: "note",
      text: "",
      comment: noteText.trim(),
      color: HIGHLIGHT_COLORS[highlightColor],
      rect: { x: notePopover.x / scale, y: notePopover.y / scale, w: 24 / scale, h: 24 / scale },
      created: Date.now(),
    };
    updateAnnotations([...annotations, ann]);
    setNotePopover(null);
    setNoteText("");
  }, [notePopover, noteText, highlightColor, annotations, updateAnnotations]);

  const deleteAnnotation = useCallback((id: string) => {
    updateAnnotations(annotations.filter((a) => a.id !== id));
    if (editingAnnotation === id) setEditingAnnotation(null);
  }, [annotations, editingAnnotation, updateAnnotations]);

  const saveAnnotationComment = useCallback((id: string, comment: string) => {
    updateAnnotations(annotations.map((a) => (a.id === id ? { ...a, comment } : a)));
    setEditingAnnotation(null);
  }, [annotations, updateAnnotations]);

  const handleExport = useCallback(async () => {
    flushSave();
    await services.exportAnnotations(target, name, annotations);
  }, [services, target, name, annotations, flushSave]);

  const handleAnnotationClick = useCallback((ann: PDFAnnotation, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tool === "select") { setEditingAnnotation(ann.id); setEditComment(ann.comment); }
  }, [tool]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (notePopover) setNotePopover(null);
        else if (editingAnnotation) setEditingAnnotation(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, notePopover, editingAnnotation]);

  const getPageAnnotations = useCallback((pageNum: number) => annotations.filter((a) => a.page === pageNum), [annotations]);

  const renderSelection = useCallback((pageNum: number) => {
    if (!isSelecting || !selectionStart || !selectionEnd || selectionStart.page !== pageNum) return null;
    const minX = Math.min(selectionStart.x, selectionEnd.x);
    const minY = Math.min(selectionStart.y, selectionEnd.y);
    const w = Math.abs(selectionEnd.x - selectionStart.x);
    const h = Math.abs(selectionEnd.y - selectionStart.y);
    return (
      <div style={{ position: "absolute", left: minX, top: minY, width: w, height: h, background: `${HIGHLIGHT_COLORS[highlightColor]}33`, border: `1px dashed ${HIGHLIGHT_COLORS[highlightColor]}`, pointerEvents: "none" }} />
    );
  }, [isSelecting, selectionStart, selectionEnd, highlightColor]);

  const renderAnnotationOverlay = useCallback((ann: PDFAnnotation) => {
    const scale = zoom * BASE_SCALE;
    if (ann.type === "note") {
      return (
        <div key={ann.id} onClick={(e) => handleAnnotationClick(ann, e)} style={{ position: "absolute", left: ann.rect.x * scale - 12, top: ann.rect.y * scale - 12, width: 24, height: 24, cursor: "pointer", zIndex: 10 }} title={ann.comment}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill={ann.color} stroke={C.base} strokeWidth="1.5"><path d="M4 4h16v14H8l-4 4V4z" /></svg>
        </div>
      );
    }
    const isUnderline = ann.type === "underline";
    return (
      <div key={ann.id} onClick={(e) => handleAnnotationClick(ann, e)} style={{ position: "absolute", left: ann.rect.x * scale, top: ann.rect.y * scale, width: ann.rect.w * scale, height: ann.rect.h * scale, background: isUnderline ? "transparent" : `${ann.color}40`, borderBottom: isUnderline ? `2px solid ${ann.color}` : "none", cursor: "pointer", zIndex: 5, borderRadius: isUnderline ? 0 : 2 }} title={ann.comment || ann.text} />
    );
  }, [handleAnnotationClick, zoom, C.base]);

  const sortedAnnotations = [...annotations].sort((a, b) => a.page - b.page || a.created - b.created);

  return (
    // Fills its container (a desktop tab, or the web app's overlay above the Attachments dialog).
    <div data-pdf-viewer style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.base, color: C.text, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: C.mantle, borderBottom: `1px solid ${C.surface0}`, flexShrink: 0, minHeight: 42 }}>
        <span style={{ fontSize: 13, color: C.subtext, marginRight: 8, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <div style={{ width: 1, height: 20, background: C.surface1, marginRight: 4 }} />
        <ToolbarButton onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} title={labels.previousPage}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </ToolbarButton>
        <span style={{ fontSize: 12, color: C.subtext, minWidth: 60, textAlign: "center" }}>{currentPage} / {numPages}</span>
        <ToolbarButton onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages} title={labels.nextPage}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </ToolbarButton>
        <div style={{ width: 1, height: 20, background: C.surface1, margin: "0 4px" }} />
        <ToolbarButton onClick={zoomOut} title={labels.zoomOut}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </ToolbarButton>
        <span style={{ fontSize: 12, color: C.subtext, minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <ToolbarButton onClick={zoomIn} title={labels.zoomIn}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </ToolbarButton>
        <ToolbarButton onClick={fitWidth} title={labels.fitWidth}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="3" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M4 7h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </ToolbarButton>
        <ToolbarButton onClick={fitPage} title={labels.fitPage}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" /></svg>
        </ToolbarButton>
        <div style={{ width: 1, height: 20, background: C.surface1, margin: "0 4px" }} />
        <ToolbarButton active={tool === "select"} onClick={() => setTool("select")} title={labels.select}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2l2 10 2.5-4L12 6 3 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        </ToolbarButton>
        <ToolbarButton active={tool === "highlight"} onClick={() => setTool("highlight")} title={labels.highlight}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="4" width="10" height="6" rx="1" fill={tool === "highlight" ? HIGHLIGHT_COLORS[highlightColor] + "66" : "none"} stroke="currentColor" strokeWidth="1.3" /></svg>
        </ToolbarButton>
        <ToolbarButton active={tool === "note"} onClick={() => setTool("note")} title={labels.note}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3h8v8H6l-3 3V3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M5 6h4M5 8h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
        </ToolbarButton>
        <ToolbarButton active={tool === "underline"} onClick={() => setTool("underline")} title={labels.underline}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 11h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M4 3v4a3 3 0 006 0V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </ToolbarButton>
        {tool !== "select" && (
          <>
            <div style={{ width: 1, height: 20, background: C.surface1, margin: "0 4px" }} />
            {(Object.entries(HIGHLIGHT_COLORS) as [HighlightColor, string][]).map(([name, color]) => (
              <button key={name} onClick={() => setHighlightColor(name)} title={name} style={{ width: 18, height: 18, borderRadius: 4, background: color, border: highlightColor === name ? `2px solid ${C.text}` : "2px solid transparent", cursor: "pointer", flexShrink: 0 }} />
            ))}
          </>
        )}
        <div style={{ flex: 1 }} />
        <ToolbarButton active={showSidebar} onClick={() => setShowSidebar((s) => !s)} title={labels.toggleSidebar}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M9 2v10" stroke="currentColor" strokeWidth="1.3" /></svg>
        </ToolbarButton>
        <ToolbarButton onClick={handleExport} disabled={annotations.length === 0} title={labels.export}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 10v2h10v-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </ToolbarButton>
        <ToolbarButton onClick={onClose} title={labels.close}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </ToolbarButton>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div ref={scrollContainerRef} style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 20px", gap: 16, background: C.surface0 }}>
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderWidth: 2, borderStyle: "solid", borderColor: `transparent ${C.blue} ${C.blue} ${C.blue}`, borderRadius: "50%", animation: "pdfspin 1s linear infinite" }} />
              <span style={{ fontSize: 13, color: C.subtext }}>{labels.loading}</span>
            </div>
          )}
          {error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
              <span style={{ fontSize: 13, color: C.red }}>{error}</span>
              <button onClick={onClose} style={{ fontSize: 12, color: C.blue, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>{labels.close}</button>
            </div>
          )}
          {!loading && !error && Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
            const dims = pageDims(pageNum);
            const isActive = activePages.has(pageNum);
            return (
              <div key={pageNum} data-page-container={pageNum} style={{ position: "relative", minHeight: dims.h, boxShadow: "0 2px 12px rgba(0,0,0,0.4)", borderRadius: 4, overflow: "hidden", background: "#fff", flexShrink: 0 }}>
                {isActive ? (
                  <canvas data-page={pageNum} style={{ display: "block" }} />
                ) : (
                  <div style={{ width: dims.w, height: dims.h, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
                    <div style={{ width: 24, height: 24, borderWidth: 2, borderStyle: "solid", borderColor: `transparent ${C.blue} ${C.blue} ${C.blue}`, borderRadius: "50%", animation: "pdfspin 1s linear infinite", opacity: 0.4 }} />
                  </div>
                )}
                <div style={{ position: "absolute", inset: 0, cursor: tool === "select" ? "default" : tool === "note" ? "crosshair" : "text" }} onMouseDown={(e) => handlePageMouseDown(e, pageNum)} onMouseMove={handlePageMouseMove} onMouseUp={handlePageMouseUp}>
                  {getPageAnnotations(pageNum).map((ann) => renderAnnotationOverlay(ann))}
                  {renderSelection(pageNum)}
                  {notePopover && notePopover.page === pageNum && (
                    <div style={{ position: "absolute", left: notePopover.x, top: notePopover.y, background: C.surface0, border: `1px solid ${C.surface1}`, borderRadius: 8, padding: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.3)", zIndex: 20, width: 220 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={labels.notePlaceholder}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreateNote();
                          if (e.key === "Escape") setNotePopover(null);
                        }}
                        style={{ width: "100%", height: 60, background: C.base, color: C.text, border: `1px solid ${C.surface1}`, borderRadius: 4, padding: 6, fontSize: 12, resize: "none", outline: "none", fontFamily: "inherit" }}
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                        <button onClick={() => setNotePopover(null)} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, background: C.surface1, color: C.subtext, border: "none", cursor: "pointer" }}>{labels.cancel}</button>
                        <button onClick={handleCreateNote} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, background: C.blue, color: C.base, border: "none", cursor: "pointer", fontWeight: 600 }}>{labels.addNote}</button>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ position: "absolute", bottom: 4, right: 8, fontSize: 10, color: C.overlay0, background: `${C.base}cc`, padding: "1px 6px", borderRadius: 3 }}>{pageNum}</div>
              </div>
            );
          })}
        </div>

        {showSidebar && (
          <div style={{ width: 280, background: C.base, borderLeft: `1px solid ${C.surface0}`, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.surface0}`, fontSize: 13, fontWeight: 600, color: C.text }}>{labels.annotations} ({annotations.length})</div>
            <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
              {sortedAnnotations.length === 0 && (
                <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: C.overlay0 }}>{labels.empty}</div>
              )}
              {sortedAnnotations.map((ann) => (
                <div key={ann.id} style={{ padding: 8, marginBottom: 6, borderRadius: 6, background: editingAnnotation === ann.id ? C.surface1 : C.surface0, cursor: "pointer", transition: "background 0.15s" }} onClick={() => scrollToAnnotation(ann)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: ann.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: C.overlay0, textTransform: "capitalize" }}>{ann.type}</span>
                    <span style={{ fontSize: 10, color: C.overlay0, marginLeft: "auto" }}>{labels.pageShort}{ann.page}</span>
                  </div>
                  {ann.text && (
                    <div style={{ fontSize: 12, color: C.subtext, marginBottom: 4, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const }}>{ann.text}</div>
                  )}
                  {editingAnnotation === ann.id ? (
                    <div style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                      <textarea
                        value={editComment}
                        onChange={(e) => setEditComment(e.target.value)}
                        autoFocus
                        placeholder={labels.commentPlaceholder}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveAnnotationComment(ann.id, editComment);
                          if (e.key === "Escape") setEditingAnnotation(null);
                        }}
                        style={{ width: "100%", height: 48, background: C.base, color: C.text, border: `1px solid ${C.surface1}`, borderRadius: 4, padding: 6, fontSize: 11, resize: "none", outline: "none", fontFamily: "inherit" }}
                      />
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        <button onClick={() => saveAnnotationComment(ann.id, editComment)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: C.blue, color: C.base, border: "none", cursor: "pointer", fontWeight: 600 }}>{labels.save}</button>
                        <button onClick={() => setEditingAnnotation(null)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: C.surface1, color: C.subtext, border: "none", cursor: "pointer" }}>{labels.cancel}</button>
                        <button onClick={() => deleteAnnotation(ann.id)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, background: "transparent", color: C.red, border: `1px solid ${C.red}44`, cursor: "pointer", marginLeft: "auto" }}>{labels.delete}</button>
                      </div>
                    </div>
                  ) : ann.comment ? (
                    <div style={{ fontSize: 11, color: C.overlay0, fontStyle: "italic", marginTop: 2, lineHeight: 1.3 }}>{ann.comment}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes pdfspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ToolbarButton({ children, onClick, active, disabled, title }: { children: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 6, background: active ? "var(--bg-hover)" : "transparent", color: disabled ? "var(--text-muted)" : active ? "var(--accent)" : "var(--text-secondary)", border: "none", cursor: disabled ? "not-allowed" : "pointer", flexShrink: 0, transition: "background 0.15s, color 0.15s" }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}
