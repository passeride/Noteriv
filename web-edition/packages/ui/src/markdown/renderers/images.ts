import type { InlineRenderer, InlineReplacement } from "../types";
import { getLocalImageLoader } from "../vault-hooks";

// Global EditorView reference — set by Editor.tsx
let _editorView: any = null;
export function setEditorViewForImages(view: any) { _editorView = view; }

// D9 (image lightbox) — rendered <img> markup here is raw HTML injected via a
// CodeMirror decoration, not a React element, so there is no JSX onClick to
// attach. The vault page registers a handler once (works for both the
// live-preview Editor and ReadOnlyView, since both render through this same
// pipeline) and a global dblclick listener below calls it with the clicked
// image's resolved src/alt.
let _onImageOpen: ((src: string, alt: string) => void) | null = null;
export function setImageLightboxHandler(fn: ((src: string, alt: string) => void) | null) {
  _onImageOpen = fn;
}

let lightboxListenerAttached = false;
function attachLightboxListener() {
  if (lightboxListenerAttached) return;
  lightboxListenerAttached = true;
  document.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG" && target.classList.contains("md-inline-img")) {
      const img = target as HTMLImageElement;
      if (img.src && _onImageOpen) {
        e.preventDefault();
        _onImageOpen(img.src, img.alt);
      }
    }
  });
}
if (typeof window !== "undefined") attachLightboxListener();

// Cache of loaded images: absolute path → data URL
const imageCache = new Map<string, string>();
const loadingPaths = new Set<string>();

function resolveToAbsPath(src: string): string | null {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:") || src.startsWith("file://")) {
    return null;
  }
  return getLocalImageLoader()?.resolve(src) ?? null;
}

function getMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const mimes: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
    m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", webm: "audio/webm",
  };
  return mimes[ext] || "image/png";
}

async function loadLocalImage(absPath: string): Promise<string | null> {
  if (imageCache.has(absPath)) return imageCache.get(absPath)!;
  if (loadingPaths.has(absPath)) return null;
  loadingPaths.add(absPath);
  try {
    const loader = getLocalImageLoader();
    if (!loader) return null;
    const base64 = await loader.load(absPath);
    if (!base64) return null;
    const dataUrl = `data:${getMime(absPath)};base64,${base64}`;
    imageCache.set(absPath, dataUrl);
    return dataUrl;
  } catch {
    return null;
  } finally {
    loadingPaths.delete(absPath);
  }
}

function loadPendingImages() {
  // Local images and audio clips (desktop vault files) are loaded the same way, as data URLs.
  const els = document.querySelectorAll("img[data-local-src]:not([data-loaded]), audio[data-local-src]:not([data-loaded])");
  els.forEach(async (el) => {
    const absPath = el.getAttribute("data-local-src");
    if (!absPath) return;
    el.setAttribute("data-loaded", "pending");
    const dataUrl = await loadLocalImage(absPath);
    if (dataUrl && el.isConnected) {
      (el as HTMLImageElement | HTMLAudioElement).src = dataUrl;
      el.setAttribute("data-loaded", "true");
    }
  });
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
function ensurePolling() {
  if (pollInterval) return;
  pollInterval = setInterval(loadPendingImages, 300);
}
// Module-level side effect — guarded because this file's import graph is also
// evaluated server-side during Next.js SSR, where `document`/`window` don't exist.
if (typeof window !== "undefined") ensurePolling();

// --- Resize handling ---
// Attach resize handles to rendered images via DOM mutation observer + event delegation

let resizeListenerAttached = false;

function attachResizeListeners() {
  if (resizeListenerAttached) return;
  resizeListenerAttached = true;

  let activeResize: {
    img: HTMLImageElement;
    container: HTMLElement;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    dir: string;
  } | null = null;

  document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;

    // Click on resize handle
    if (target.classList.contains("md-img-resize-handle")) {
      e.preventDefault();
      e.stopPropagation();
      const container = target.parentElement;
      const img = container?.querySelector("img") as HTMLImageElement | null;
      if (!container || !img) return;
      activeResize = {
        img,
        container,
        startX: e.clientX,
        startY: e.clientY,
        startW: img.offsetWidth,
        startH: img.offsetHeight,
        dir: target.getAttribute("data-dir") || "se",
      };
      return;
    }

    // Click on image — toggle selected state
    if (target.tagName === "IMG" && target.classList.contains("md-inline-img")) {
      const wrapper = target.closest(".md-img-wrapper");
      if (wrapper) {
        // Deselect others
        document.querySelectorAll(".md-img-wrapper.selected").forEach((el) => {
          if (el !== wrapper) el.classList.remove("selected");
        });
        wrapper.classList.toggle("selected");
      }
      return;
    }

    // Click elsewhere — deselect all
    document.querySelectorAll(".md-img-wrapper.selected").forEach((el) => el.classList.remove("selected"));
  }, true);

  document.addEventListener("mousemove", (e) => {
    if (!activeResize) return;
    e.preventDefault();
    const dx = e.clientX - activeResize.startX;
    const dy = e.clientY - activeResize.startY;
    const dir = activeResize.dir;
    const ratio = activeResize.startH / activeResize.startW;

    let newW = activeResize.startW;
    let newH = activeResize.startH;

    if (dir === "e" || dir === "ne" || dir === "se") newW = activeResize.startW + dx;
    if (dir === "w" || dir === "nw" || dir === "sw") newW = activeResize.startW - dx;
    if (dir === "s" || dir === "se" || dir === "sw") newH = activeResize.startH + dy;
    if (dir === "n" || dir === "ne" || dir === "nw") newH = activeResize.startH - dy;

    newW = Math.max(50, newW);
    newH = Math.max(30, newH);

    // Corners maintain aspect ratio
    if (dir === "nw" || dir === "ne" || dir === "sw" || dir === "se") {
      newH = Math.round(newW * ratio);
    }

    activeResize.img.style.width = `${newW}px`;
    activeResize.img.style.height = `${newH}px`;
    activeResize.container.style.width = `${newW}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!activeResize) return;
    const img = activeResize.img;
    const width = Math.round(img.offsetWidth);
    const height = Math.round(img.offsetHeight);

    const from = parseInt(activeResize.container.getAttribute("data-from") || "");
    const to = parseInt(activeResize.container.getAttribute("data-to") || "");
    const originalMd = activeResize.container.getAttribute("data-md") || "";

    if (!isNaN(from) && !isNaN(to) && originalMd) {
      const mdMatch = originalMd.match(/^!\[([^\]]*?)(?:\|(\d+(?:x\d+)?))?\]\(([^)]+)\)$/);
      if (mdMatch) {
        const alt = mdMatch[1];
        const src = mdMatch[3];
        const newMd = `![${alt}|${width}x${height}](${src})`;

        if (_editorView) {
          _editorView.dispatch({ changes: { from, to, insert: newMd } });
        }
      }
    }

    activeResize = null;
  });
}

if (typeof window !== "undefined") attachResizeListeners();

/** Audio clips use the image syntax: `![Audio](…)` (what the recorder writes) or a link to an audio file. */
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm)(?:[?#].*)?$/i;
export function isAudioEmbed(alt: string, src: string): boolean {
  return alt.trim().toLowerCase() === "audio" || AUDIO_EXT.test(src);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const imageRenderer: InlineRenderer = {
  name: "images",
  priority: 10,

  find(text: string, offset: number): InlineReplacement[] {
    const results: InlineReplacement[] = [];
    // Match ![alt](src), ![alt|WIDTH](src), ![alt|WIDTHxHEIGHT](src)
    const regex = /!\[([^\]]*?)(?:\|(\d+(?:x\d+)?))?\]\(([^)]+)\)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const alt = match[1];
      const sizeStr = match[2]; // "300" or "300x200"
      const rawSrc = match[3];
      const fullMatch = match[0];
      const absPath = resolveToAbsPath(rawSrc);

      let sizeStyle = "";
      if (sizeStr) {
        const parts = sizeStr.split("x");
        const w = parts[0];
        const h = parts[1];
        sizeStyle = ` style="width:${w}px${h ? `;height:${h}px` : ""}"`;
      }
      const from = offset + match.index;
      const to = from + fullMatch.length;

      if (isAudioEmbed(alt, rawSrc)) {
        const cached = absPath ? imageCache.get(absPath) : undefined;
        const srcAttr = absPath
          ? cached
            ? `src="${cached}"`
            : `data-local-src="${escapeAttr(absPath)}"`
          : `src="${escapeAttr(rawSrc)}"`;
        const audioTag = `<audio controls preload="metadata" ${srcAttr} class="md-inline-audio" title="${escapeAttr(alt)}"></audio>`;
        const html = `<span class="md-audio-wrapper" data-from="${from}" data-to="${to}" data-md="${escapeAttr(fullMatch)}">${audioTag}</span>`;
        results.push({ from, to, html, className: "md-audio" });
        continue;
      }

      let imgTag: string;
      if (absPath) {
        const cached = imageCache.get(absPath);
        if (cached) {
          imgTag = `<img src="${cached}" alt="${escapeAttr(alt)}" class="md-inline-img"${sizeStyle}/>`;
        } else {
          const placeholderStyle = `min-height:24px;background:#313244;border-radius:4px${sizeStr ? `;width:${sizeStr.split("x")[0]}px` : ""}`;
          imgTag = `<img src="" alt="${escapeAttr(alt)}" data-local-src="${escapeAttr(absPath)}" class="md-inline-img" style="${placeholderStyle}"/>`;
        }
      } else {
        imgTag = `<img src="${escapeAttr(rawSrc)}" alt="${escapeAttr(alt)}" class="md-inline-img"${sizeStyle}/>`;
      }

      const handles = `<span class="md-img-resize-handle nw" data-dir="nw"></span><span class="md-img-resize-handle n" data-dir="n"></span><span class="md-img-resize-handle ne" data-dir="ne"></span><span class="md-img-resize-handle e" data-dir="e"></span><span class="md-img-resize-handle se" data-dir="se"></span><span class="md-img-resize-handle s" data-dir="s"></span><span class="md-img-resize-handle sw" data-dir="sw"></span><span class="md-img-resize-handle w" data-dir="w"></span>`;
      const html = `<span class="md-img-wrapper" data-from="${from}" data-to="${to}" data-md="${escapeAttr(fullMatch)}">${imgTag}${handles}</span>`;

      results.push({ from, to, html, className: "md-image" });
    }

    return results;
  },
};
