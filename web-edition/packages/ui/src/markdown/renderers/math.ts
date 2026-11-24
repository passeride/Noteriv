import { Decoration } from "@codemirror/view";
import { getKatex, loadKatex, pendingMathHtml } from "../katex-loader";
import type { BlockContext, InlineRenderer, InlineReplacement } from "../types";

// Block math: $$ ... $$
export class MathBlockTracker {
  inMathBlock = false;
  mathContent = "";
  startLine = 0;

  reset() {
    this.inMathBlock = false;
    this.mathContent = "";
    this.startLine = 0;
  }

  process(ctx: BlockContext, isCursorLine: boolean): "fence" | "inside" | null {
    const trimmed = ctx.text.trim();

    if (/^\$\$.+\$\$$/.test(trimmed)) {
      if (!isCursorLine) {
        ctx.builder.add(
          ctx.line.from,
          ctx.line.from,
          Decoration.line({ class: "md-math-block-line" })
        );
      }
      return "fence";
    }

    if (trimmed === "$$") {
      if (!isCursorLine) {
        ctx.builder.add(
          ctx.line.from,
          ctx.line.from,
          Decoration.line({ class: "md-math-fence" })
        );
      }
      this.inMathBlock = !this.inMathBlock;
      return "fence";
    }

    if (this.inMathBlock) {
      ctx.builder.add(
        ctx.line.from,
        ctx.line.from,
        Decoration.line({ class: "md-math-block-line" })
      );
      return "inside";
    }

    return null;
  }
}

// Inline math: $...$
export const inlineMathRenderer: InlineRenderer = {
  name: "inline-math",
  priority: 15, // Before regular inline formatting

  find(text: string, offset: number): InlineReplacement[] {
    const results: InlineReplacement[] = [];
    // Match $...$ but not $$
    const regex = /(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g;
    const katex = getKatex();
    let match;

    while ((match = regex.exec(text)) !== null) {
      results.push({
        from: offset + match.index,
        to: offset + match.index + match[0].length,
        html: katex
          ? katex.renderToString(match[1], { throwOnError: false, displayMode: false })
          : pendingMathHtml(match[1], false),
        className: "math-inline-widget",
      });
    }
    // Editors rebuild once it arrives (see katex-loader).
    if (!katex && results.length) void loadKatex().catch(() => {});

    return results;
  },
};
