/**
 * KaTeX on demand: ~255 KB that used to be in every page's first load. The math renderers ask `getKatex()`; while it
 * is null they show the source and call `loadKatex()`, and once the module arrives the live editors rebuild
 * (`liveMarkdownPlugin` listens through `onKatexLoaded`). Notes without math never load it.
 */

type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;
const listeners = new Set<() => void>();

export function getKatex(): Katex | null {
  return katex;
}

export function loadKatex(): Promise<Katex> {
  if (!loading) {
    loading = import("katex").then(
      (mod) => {
        katex = mod.default;
        for (const l of Array.from(listeners)) l();
        return katex;
      },
      (err) => {
        loading = null; // let a later render try again
        throw err;
      }
    );
  }
  return loading;
}

export function onKatexLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shown in place of a formula until KaTeX is loaded. */
export function pendingMathHtml(latex: string, displayMode: boolean): string {
  const escaped = latex.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<code class="math-pending${displayMode ? " math-pending-block" : ""}">${escaped}</code>`;
}
