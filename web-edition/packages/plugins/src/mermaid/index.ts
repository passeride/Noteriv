import type { CodeBlockProcessor, CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT } from "../shared/i18n";

/** Marks a block still being drawn; export waits for it to go (see core `PENDING_ATTRIBUTE`). */
const PENDING = "data-nrv-pending";

type Mermaid = typeof import("mermaid").default;

/** The library is loaded once, on the first diagram (it is ~2.4 MB). Tests replace it. */
let loadMermaid: () => Promise<Mermaid> = async () => (await import("mermaid")).default;

/** Tests: use a stand-in instead of the real library. */
export function setMermaidLoader(loader: () => Promise<Mermaid>): void {
  loadMermaid = loader;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Mermaid theme from the app's CSS variables, read at each render so a theme switch is followed. */
function themeVariables() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const bgPrimary = v("--bg-primary", "#1e1e2e");
  const bgSecondary = v("--bg-secondary", "#181825");
  const bgTertiary = v("--bg-tertiary", "#313244");
  const border = v("--border", "#45475a");
  const textPrimary = v("--text-primary", "#cdd6f4");
  const textMuted = v("--text-muted", "#6c7086");
  const accent = v("--accent", "#89b4fa");
  return {
    darkMode: true,
    primaryColor: bgTertiary,
    primaryTextColor: textPrimary,
    primaryBorderColor: accent,
    lineColor: textMuted,
    secondaryColor: border,
    tertiaryColor: bgPrimary,
    background: bgPrimary,
    mainBkg: bgTertiary,
    nodeBorder: accent,
    clusterBkg: bgSecondary,
    clusterBorder: border,
    titleColor: textPrimary,
    edgeLabelBackground: bgSecondary,
    nodeTextColor: textPrimary,
  };
}

let counter = 0;

/** Text shown in a diagram block while it renders or when it fails. */
export interface MermaidText {
  rendering: string;
  error: string;
}

const ENGLISH: MermaidText = { rendering: "Rendering diagram...", error: "Diagram Error" };

/** Renders a ```mermaid block as a diagram (same look as before it became a plugin: `.mermaid-*` in app.css). */
export const createMermaidRenderer = (text: MermaidText): CodeBlockProcessor => (source, el) => {
  let cancelled = false;
  const container = document.createElement("div");
  container.className = "mermaid-widget";
  container.innerHTML = '<div class="mermaid-header"><span class="mermaid-label"><span class="mermaid-label-icon">&#9670;</span> Mermaid</span></div>';
  const inner = document.createElement("div");
  inner.className = "mermaid-widget-inner";
  inner.setAttribute(PENDING, "");
  inner.innerHTML = `<div class="mermaid-loading"><div class="mermaid-loading-spinner"></div>${escapeHtml(text.rendering)}</div>`;
  container.appendChild(inner);
  el.appendChild(container);

  void (async () => {
    try {
      const mermaid = await loadMermaid();
      if (cancelled) return;
      // Re-initialised for every diagram so a theme switch takes effect. `strict` (mermaid's default) because the
      // source is note content: under `loose` a `click` directive puts a `javascript:` URL into the SVG.
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: themeVariables(),
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        securityLevel: "strict",
      });
      const { svg } = await mermaid.render(`mermaid-${Date.now()}-${counter++}`, source);
      if (cancelled) return;
      // Mermaid's own output, sanitised by mermaid at the `strict` level.
      inner.innerHTML = svg;
    } catch (err) {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      inner.innerHTML = `<div class="mermaid-error"><div class="mermaid-error-title">&#9888; ${escapeHtml(text.error)}</div><div class="mermaid-error-message">${escapeHtml(message)}</div></div>`;
    }
    inner.removeAttribute(PENDING);
  })();

  return () => {
    cancelled = true;
  };
};

/** Mermaid: diagrams from ```mermaid code blocks, in the editor, the reading view and PDF export. */
const mermaidPlugin: CorePlugin = {
  onload(api: PluginApi) {
    const t = pluginT(api, "mermaid");
    api.markdown.registerCodeBlockProcessor("mermaid", createMermaidRenderer({ rendering: t("rendering"), error: t("error") }));
  },
};

/** The English renderer (tests and callers outside a plugin host). */
export const renderMermaid = createMermaidRenderer(ENGLISH);

export default mermaidPlugin;
