import { WidgetType } from "@codemirror/view";
import { sanitizeHtml } from "@noteriv/core/sanitize-html";
import { getPostProcessorRunner } from "./vault-hooks";

/**
 * A CodeMirror widget that renders HTML inline.
 *
 * Most callers pass markup this module generated itself, but the raw HTML block
 * renderer passes note content straight through, so everything is sanitized
 * here at the single point where it reaches the document.
 */
export class RenderedMarkdownWidget extends WidgetType {
  constructor(readonly html: string, readonly className: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.className;
    span.innerHTML = sanitizeHtml(this.html);
    const run = getPostProcessorRunner();
    if (run) {
      try {
        run(span, { sourcePath: null });
      } catch (e) {
        console.error("[markdown] post-processor failed:", e);
      }
    }
    return span;
  }
  ignoreEvent(e: Event) {
    // Let images handle their own clicks (for resize/select), and audio players their controls
    if (this.className === "md-image" || this.className === "md-audio") return true;
    // Let click events through for interactive elements (wikilinks, links, etc)
    if (e.type === "mousedown") {
      const target = e.target as HTMLElement;
      if (target.closest(".md-img-wrapper")) return true;
    }
    return false;
  }
}
