import type { CodeBlockProcessor, CorePlugin, PluginApi } from "@noteriv/plugin-api";
import { pluginT, type Translate } from "../shared/i18n";
import { parseChessboardBlock, validateFEN } from "./fen";
import { BOARD_THEMES, PIECE_SETS } from "./pieces";
import { renderBoardSVG } from "./render";

export interface ChessboardSettings {
  pieceSet: string;
  boardTheme: string;
}

const DEFAULTS: ChessboardSettings = { pieceSet: "classic", boardTheme: "classic" };
const PREVIEW_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const ERROR_STYLE = "padding:10px 16px;font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;color:#f44336;";

/** The defaults every board falls back to; set while the plugin loads and when the settings tab saves. */
let current: ChessboardSettings = { ...DEFAULTS };

/** Saved ids that no longer exist in the registries fall back to the classic look. */
function normalize(blob: Record<string, unknown>): ChessboardSettings {
  const pieceSet = typeof blob.pieceSet === "string" && blob.pieceSet in PIECE_SETS ? blob.pieceSet : DEFAULTS.pieceSet;
  const boardTheme = typeof blob.boardTheme === "string" && blob.boardTheme in BOARD_THEMES ? blob.boardTheme : DEFAULTS.boardTheme;
  return { pieceSet, boardTheme };
}

export interface ChessboardText {
  missingFen: string;
  invalidFen: (error: string) => string;
  renderError: (message: string) => string;
  diagramLabel: (fen: string) => string;
}

function showError(el: HTMLElement, message: string): void {
  const div = document.createElement("div");
  div.className = "chessboard-error";
  div.style.cssText = ERROR_STYLE;
  div.textContent = message;
  el.replaceChildren(div);
}

/** Renders a ```chessboard block; `defaults` is read at each render so a saved change applies to boards drawn after it. */
export const createChessboardProcessor =
  (text: ChessboardText, defaults: () => ChessboardSettings = () => current): CodeBlockProcessor =>
  (source, el) => {
    const config = parseChessboardBlock(source);
    if (!config.fen) {
      showError(el, text.missingFen);
      return;
    }
    if (config.strict) {
      const check = validateFEN(config.fen);
      if (!check.valid) {
        showError(el, text.invalidFen(check.error));
        return;
      }
    }
    try {
      const base = defaults();
      const svg = renderBoardSVG({
        fen: config.fen,
        orientation: config.orientation,
        annotations: config.annotations,
        pieceSet: config.pieceset ?? base.pieceSet,
        boardTheme: config.boardtheme ?? base.boardTheme,
        labels: config.labels,
        size: config.size,
        title: text.diagramLabel(config.fen),
      });
      const widget = document.createElement("div");
      widget.className = "chessboard-plugin-widget";
      // Built by renderBoardSVG from registry values and validated square names only.
      widget.innerHTML = svg;
      el.replaceChildren(widget);
    } catch (err) {
      showError(el, text.renderError(err instanceof Error ? err.message : String(err)));
    }
    return () => {
      el.replaceChildren();
    };
  };

function selectField(label: string, options: Record<string, { name: string }>, value: string) {
  const wrap = document.createElement("label");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  wrap.appendChild(document.createElement("span")).textContent = label;
  const select = wrap.appendChild(document.createElement("select"));
  select.style.cssText = "padding:4px 6px;";
  for (const [id, { name }] of Object.entries(options)) {
    const option = select.appendChild(document.createElement("option"));
    option.value = id;
    option.textContent = name;
  }
  select.value = value;
  return { wrap, select };
}

function renderSettings(api: PluginApi, t: Translate, container: HTMLElement, onSaved: () => void): void {
  const row = container.appendChild(document.createElement("div"));
  row.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;";
  const pieces = selectField(t("pieceSet"), PIECE_SETS, current.pieceSet);
  const themes = selectField(t("boardTheme"), BOARD_THEMES, current.boardTheme);
  row.append(pieces.wrap, themes.wrap);

  const preview = container.appendChild(document.createElement("div"));
  preview.style.cssText = "margin-bottom:12px;max-width:220px;";
  const updatePreview = () => {
    preview.innerHTML = renderBoardSVG({
      fen: PREVIEW_FEN,
      orientation: "white",
      annotations: [],
      pieceSet: pieces.select.value,
      boardTheme: themes.select.value,
    });
  };
  updatePreview();
  pieces.select.addEventListener("change", updatePreview);
  themes.select.addEventListener("change", updatePreview);

  const save = container.appendChild(document.createElement("button"));
  save.type = "button";
  save.textContent = t("save");
  save.style.cssText = "padding:6px 14px;cursor:pointer;";
  save.addEventListener("click", () => {
    const next = { pieceSet: pieces.select.value, boardTheme: themes.select.value };
    api.settings.save({ ...next }).then(
      () => {
        current = next;
        onSaved();
        api.ui.showNotice(t("saved"), 4000);
      },
      (err) => {
        console.error("[chessboard] save failed:", err);
        api.ui.showNotice(t("saveFailed"), 6000);
      }
    );
  });

  const hint = container.appendChild(document.createElement("div"));
  hint.style.cssText = "margin-top:8px;font-size:11px;opacity:0.7;";
  hint.textContent = t("hint");
  const syntax = container.appendChild(document.createElement("pre"));
  syntax.style.cssText = "margin-top:12px;font-size:11px;opacity:0.8;white-space:pre-wrap;";
  syntax.textContent = t("syntax");
}

/** Chessboard: static chess diagrams from ```chessboard blocks (FEN, highlights, arrows), with a default piece set and board theme. */
const chessboardPlugin: CorePlugin = {
  async onload(api: PluginApi) {
    const t = pluginT(api, "chessboard");
    // Before registering, so the first render of an already open note uses the saved defaults.
    current = normalize(await api.settings.load().catch(() => ({}) as Record<string, unknown>));
    const processor = createChessboardProcessor({
      missingFen: t("missingFen"),
      invalidFen: (error) => t("invalidFen", { error }),
      renderError: (message) => t("renderError", { message }),
      diagramLabel: (fen) => t("diagramLabel", { fen }),
    });
    const register = () => api.markdown.registerCodeBlockProcessor("chessboard", processor);
    register();
    // Registering again makes open notes redraw their boards, so a saved default shows at once.
    api.ui.addSettingsTab({ id: "settings", name: t("settings"), render: (container) => renderSettings(api, t, container, register) });
  },
  onunload() {
    current = { ...DEFAULTS };
  },
};

export default chessboardPlugin;
