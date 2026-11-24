import type { PluginApi } from "@noteriv/plugin-api";
import { extractCards, getDueCards, gradeCard, type Flashcard, type Reviews } from "./cards";
import type { ScannedNote } from "../shared/vault";
import { loadReviews, saveReviews } from "./storage";

export interface ReviewLabels {
  title: string;
  cards: (n: number) => string;
  due: (n: number) => string;
  done: (n: number) => string;
  scanning: string;
  caughtUp: string;
  noCards: string;
  comeBack: (reviewed: number) => string;
  showAnswer: string;
  close: string;
  grades: [string, string, string, string, string];
}

// Theme variables with the old desktop colours as fallbacks.
const C = {
  bg: "var(--bg-primary, #1e1e2e)",
  bg2: "var(--bg-secondary, #181825)",
  bg3: "var(--bg-tertiary, #313244)",
  border: "var(--border, #45475a)",
  text: "var(--text-primary, #cdd6f4)",
  text2: "var(--text-secondary, #a6adc8)",
  muted: "var(--text-muted, #585b70)",
  accent: "var(--accent, #89b4fa)",
  green: "var(--green, #a6e3a1)",
  yellow: "var(--yellow, #f9e2af)",
};
const GRADE_COLORS = ["var(--red, #f38ba8)", "var(--peach, #fab387)", C.yellow, C.accent, C.green];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration> = {},
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The review panel (same behaviour as the pre-2.2 modal): Space/Enter shows the answer, 1-5 grades it, the note
 * name opens the source note. The host's view overlay supplies the backdrop and closes on Escape.
 */
export function mountReview(
  container: HTMLElement,
  api: PluginApi,
  labels: ReviewLabels,
  scan: () => Promise<ScannedNote[]>
): () => void {
  let cards: Flashcard[] = [];
  let due: Flashcard[] = [];
  let reviews: Reviews = {};
  let index = 0;
  let showAnswer = false;
  let loading = true;
  let disposed = false;
  const stats = { total: 0, due: 0, reviewed: 0 };

  const panel = el("div", {
    background: C.bg,
    borderRadius: "12px",
    border: `1px solid ${C.bg3}`,
    width: "520px",
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    outline: "none",
  });
  panel.tabIndex = 0;
  panel.setAttribute("data-flashcards-review", "");
  container.appendChild(panel);

  async function grade(g: number) {
    const card = due[index];
    if (!card) return;
    reviews = { ...reviews, [card.id]: gradeCard(card.id, g, reviews) };
    showAnswer = false;
    stats.reviewed++;
    if (index + 1 < due.length) index++;
    else {
      due = getDueCards(cards, reviews);
      index = 0;
    }
    render();
    await saveReviews(api, reviews);
  }

  function render() {
    if (disposed) return;
    panel.replaceChildren();

    const header = el("div", {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
      borderBottom: `1px solid ${C.bg3}`,
    });
    header.appendChild(el("span", { color: C.text, fontSize: "14px", fontWeight: "600" }, labels.title));
    const counts = el("div", { display: "flex", gap: "12px", fontSize: "11px", color: C.text2 });
    counts.append(
      el("span", {}, labels.cards(stats.total)),
      el("span", { color: C.yellow }, labels.due(Math.max(0, stats.due - stats.reviewed))),
      el("span", { color: C.green }, labels.done(stats.reviewed))
    );
    header.appendChild(counts);
    const close = el("button", { border: "none", background: "transparent", color: C.muted, fontSize: "18px", cursor: "pointer" }, "×");
    close.title = labels.close;
    close.setAttribute("aria-label", labels.close);
    close.onclick = () => api.workspace.closeView();
    header.appendChild(close);
    panel.appendChild(header);

    const body = el("div", {
      flex: "1",
      padding: "24px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "300px",
    });
    panel.appendChild(body);

    const card = due[index];
    if (loading) {
      body.appendChild(el("div", { color: C.text2, fontSize: "13px" }, labels.scanning));
    } else if (!card) {
      const done = el("div", { textAlign: "center" });
      done.append(
        el("div", { fontSize: "36px", marginBottom: "12px" }, "🎉"),
        el("div", { color: C.green, fontSize: "16px", fontWeight: "600", marginBottom: "8px" }, labels.caughtUp),
        el("div", { color: C.text2, fontSize: "13px" }, stats.total === 0 ? labels.noCards : labels.comeBack(stats.reviewed))
      );
      body.appendChild(done);
    } else {
      const q = el("div", {
        background: C.bg3,
        borderRadius: "10px",
        padding: "20px 24px",
        width: "100%",
        boxSizing: "border-box",
        marginBottom: "16px",
        minHeight: "80px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });
      q.appendChild(el("div", { color: C.text, fontSize: "15px", textAlign: "center", lineHeight: "1.6" }, card.question));
      body.appendChild(q);

      if (showAnswer) {
        const a = el("div", {
          background: C.bg2,
          borderRadius: "10px",
          border: `1px solid ${C.border}`,
          padding: "20px 24px",
          width: "100%",
          boxSizing: "border-box",
          marginBottom: "16px",
          minHeight: "60px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        });
        a.appendChild(el("div", { color: C.green, fontSize: "15px", textAlign: "center", lineHeight: "1.6" }, card.answer));
        body.appendChild(a);

        const row = el("div", { display: "flex", gap: "8px", width: "100%" });
        labels.grades.forEach((label, i) => {
          const color = GRADE_COLORS[i];
          const b = el("button", {
            flex: "1",
            padding: "8px 4px",
            borderRadius: "6px",
            border: `1px solid color-mix(in srgb, ${color} 27%, transparent)`,
            background: `color-mix(in srgb, ${color} 7%, transparent)`,
            color,
            fontSize: "12px",
            fontWeight: "600",
            cursor: "pointer",
            textAlign: "center",
          });
          b.append(document.createTextNode(label), el("br"), el("span", { fontSize: "10px", opacity: "0.6" }, String(i + 1)));
          b.onclick = () => void grade(i + 1);
          row.appendChild(b);
        });
        body.appendChild(row);
      } else {
        const show = el(
          "button",
          {
            padding: "10px 32px",
            borderRadius: "8px",
            border: `1px solid ${C.border}`,
            background: C.bg3,
            color: C.text,
            fontSize: "13px",
            cursor: "pointer",
            marginBottom: "16px",
          },
          labels.showAnswer
        );
        show.onclick = () => {
          showAnswer = true;
          render();
        };
        body.appendChild(show);
      }

      const source = el(
        "button",
        { marginTop: "12px", border: "none", background: "transparent", color: C.muted, fontSize: "10px", cursor: "pointer" },
        `${card.source.split("/").pop()?.replace(/\.(md|markdown)$/i, "")} · ${card.type}`
      );
      source.onclick = () => {
        void api.workspace.openFile(card.source);
        api.workspace.closeView();
      };
      body.appendChild(source);
    }

    if (due.length > 0) {
      const track = el("div", { margin: "0 16px 12px", height: "3px", background: C.bg3, borderRadius: "2px", overflow: "hidden" });
      track.appendChild(
        el("div", {
          height: "100%",
          background: C.accent,
          borderRadius: "2px",
          width: `${Math.min(100, (stats.reviewed / Math.max(1, stats.due)) * 100)}%`,
          transition: "width 0.3s ease",
        })
      );
      panel.appendChild(track);
    }
    panel.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!showAnswer && due[index]) {
        showAnswer = true;
        render();
      }
      return;
    }
    if (showAnswer && /^[1-5]$/.test(e.key)) void grade(Number(e.key));
  }
  panel.addEventListener("keydown", onKey);

  render();
  void (async () => {
    const notes = await scan();
    if (disposed) return;
    cards = notes.flatMap((n) => extractCards(n.content, n.path));
    reviews = await loadReviews(api, notes);
    if (disposed) return;
    due = getDueCards(cards, reviews);
    Object.assign(stats, { total: cards.length, due: due.length });
    loading = false;
    render();
  })().catch((err) => {
    console.error("[flashcards] could not load cards:", err);
    loading = false;
    render();
  });

  return () => {
    disposed = true;
    panel.removeEventListener("keydown", onKey);
    panel.remove();
  };
}
