// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@noteriv/plugin-api";
import { platformI18n, testI18n } from "./i18n";
import chessboardPlugin, { createChessboardProcessor } from "../src/chessboard";
import { parseChessboardBlock, squareToXY, validateFEN } from "../src/chessboard/fen";
import { BOARD_THEMES, PIECE_SETS } from "../src/chessboard/pieces";
import { renderBoardSVG } from "../src/chessboard/render";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CTX = { source: "", language: "chessboard", sourcePath: null };
const TEXT = {
  missingFen: "no fen",
  invalidFen: (e: string) => `bad: ${e}`,
  renderError: (m: string) => `render: ${m}`,
  diagramLabel: (fen: string) => `diagram: ${fen}`,
};
const DEFAULTS = () => ({ pieceSet: "classic", boardTheme: "classic" });

function render(source: string, defaults = DEFAULTS) {
  const el = document.createElement("div");
  const cleanup = createChessboardProcessor(TEXT, defaults)(source, el, CTX);
  return { el, cleanup };
}

describe("parseChessboardBlock", () => {
  it("reads the fields, with defaults for the optional ones", () => {
    const c = parseChessboardBlock(`fen: ${START}\norientation: BLACK\nstrict: false\nannotations: He4/g, Ae2-e4\npieceset: Spatial\nboardtheme: Ocean`);
    expect(c).toEqual({ fen: START, orientation: "black", strict: false, annotations: ["He4/g", "Ae2-e4"], labels: false, size: null, pieceset: "spatial", boardtheme: "ocean" });
    expect(parseChessboardBlock(`fen: ${START}`)).toMatchObject({ orientation: "white", strict: true, annotations: [], labels: false, size: null, pieceset: null, boardtheme: null });
  });

  it("reads labels and size, ignoring a size that is out of range or not a number", () => {
    expect(parseChessboardBlock(`fen: ${START}\nlabels: true\nsize: 280`)).toMatchObject({ labels: true, size: 280 });
    expect(parseChessboardBlock(`fen: ${START}\nlabels: Yes\nsize: 320px`)).toMatchObject({ labels: true, size: 320 });
    for (const size of ["50", "601", "big", "-5", ""]) expect(parseChessboardBlock(`fen: ${START}\nsize: ${size}`).size).toBeNull();
    expect(parseChessboardBlock(`fen: ${START}\nlabels: false`).labels).toBe(false);
  });

  it("lets an empty key take the following lines", () => {
    expect(parseChessboardBlock(`fen: ${START}\nannotations:\nHe4/g\nAe2-e4`).annotations).toEqual(["He4/g", "Ae2-e4"]);
  });
});

describe("validateFEN", () => {
  it("accepts the start position and a board-only FEN", () => {
    expect(validateFEN(START)).toEqual({ valid: true });
    expect(validateFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")).toEqual({ valid: true });
  });

  it("rejects a missing rank, a bad rank and a bad character", () => {
    expect(validateFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP")).toMatchObject({ valid: false, error: "Expected 8 ranks, got 7" });
    expect(validateFEN("rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")).toMatchObject({ valid: false });
    expect(validateFEN("rnbqkbnx/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")).toMatchObject({ valid: false });
  });

  it("does not need kings: lesson positions have one king, none, or several pieces of a kind", () => {
    for (const fen of ["8/8/8/8/8/8/8/8", "8/8/8/8/8/8/8/k7", "K7/8/8/8/8/8/8/8", "KK6/8/8/8/8/8/8/k7", "8/2P5/8/8/8/8/8/8 w - - 0 1", "8/6N1/8/8/5q2/8/8/8 w - - 0 1"]) {
      expect(validateFEN(fen)).toEqual({ valid: true });
    }
  });

  it("rejects bad side, castling and en passant fields", () => {
    expect(validateFEN(START.replace(" w ", " x "))).toMatchObject({ valid: false });
    expect(validateFEN(START.replace("KQkq", "KQxq"))).toMatchObject({ valid: false });
    expect(validateFEN(START.replace(" - 0", " e5 0"))).toMatchObject({ valid: false });
  });
});

describe("squareToXY", () => {
  it("maps squares for white and flips them for black", () => {
    expect(squareToXY("a1", "white")).toEqual({ x: 0, y: 350 });
    expect(squareToXY("h8", "white")).toEqual({ x: 350, y: 0 });
    expect(squareToXY("a1", "black")).toEqual({ x: 350, y: 0 });
  });

  it("accepts capitals and refuses anything that is not a square", () => {
    expect(squareToXY("HA4", "white")).toBeNull();
    expect(squareToXY("A4", "white")).toEqual(squareToXY("a4", "white"));
    for (const bad of [undefined, null, "", "a", "i1", "a9", "e44"]) expect(squareToXY(bad as never, "white")).toBeNull();
  });
});

describe("renderBoardSVG", () => {
  const config = { fen: START, orientation: "white" as const, annotations: [] as string[], pieceSet: "classic", boardTheme: "classic" };

  it("draws 64 squares and 32 pieces", () => {
    const el = document.createElement("div");
    el.innerHTML = renderBoardSVG(config);
    expect(el.querySelectorAll("svg > rect")).toHaveLength(64);
    expect(el.querySelectorAll("svg > svg")).toHaveLength(32);
  });

  it("gives each board its own arrowhead, so arrows keep their own colour", () => {
    const arrow = ["Ae2-e4"];
    const a = document.createElement("div");
    const b = document.createElement("div");
    a.innerHTML = renderBoardSVG({ ...config, annotations: arrow, boardTheme: "classic" });
    b.innerHTML = renderBoardSVG({ ...config, annotations: arrow, boardTheme: "forest" });
    const idA = a.querySelector("marker")!.id;
    const idB = b.querySelector("marker")!.id;
    expect(idA).not.toBe(idB);
    expect(a.querySelector("svg > line")!.getAttribute("marker-end")).toBe(`url(#${idA})`);
    expect(b.querySelector("svg > line")!.getAttribute("marker-end")).toBe(`url(#${idB})`);
    expect(a.querySelector("marker path")!.getAttribute("fill")).toBe(BOARD_THEMES.classic.arrow);
    expect(b.querySelector("marker path")!.getAttribute("fill")).toBe(BOARD_THEMES.forest.arrow);
  });

  it("understands capitals in annotations and puts pieces on the right side for black", () => {
    const el = document.createElement("div");
    el.innerHTML = renderBoardSVG({ ...config, annotations: ["HA4/r", "Ae2-E4", "Hz9"], orientation: "black" });
    expect(el.querySelectorAll("svg > rect")).toHaveLength(64 + 1);
    expect(el.querySelectorAll("svg > line")).toHaveLength(1);
    // The first piece in the FEN is the rook on a8, which sits in the bottom-right corner seen from black's side.
    const first = el.querySelector("svg > svg")!;
    expect(first.getAttribute("x")).toBe("350");
    expect(first.getAttribute("y")).toBe("350");
  });

  it("falls back to the classic look for a piece set or theme that does not exist", () => {
    const same = (svg: string) => svg.replace(/cb-arrowhead-\d+/g, "cb-arrowhead");
    expect(same(renderBoardSVG({ ...config, pieceSet: "nope", boardTheme: "nope" }))).toBe(same(renderBoardSVG(config)));
  });

  it("ignores pieces beyond the eighth file instead of drawing them off the board", () => {
    const el = document.createElement("div");
    el.innerHTML = renderBoardSVG({ ...config, fen: "rnbqkbnrr/8/8/8/8/8/8/8" });
    expect(el.querySelectorAll("svg > svg")).toHaveLength(8);
  });

  it("draws file letters and rank numbers only when asked, flipped for black", () => {
    const plain = document.createElement("div");
    plain.innerHTML = renderBoardSVG(config);
    expect(plain.querySelectorAll("text")).toHaveLength(0);
    expect(plain.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 400 400");

    const white = document.createElement("div");
    white.innerHTML = renderBoardSVG({ ...config, labels: true });
    const letters = (el: HTMLElement) => Array.from(el.querySelectorAll("text")).map((t) => t.textContent).join("");
    expect(letters(white)).toBe("a8b7c6d5e4f3g2h1");
    expect(white.querySelector("svg")!.getAttribute("viewBox")).toBe("-20 0 420 420");

    const black = document.createElement("div");
    black.innerHTML = renderBoardSVG({ ...config, labels: true, orientation: "black" });
    expect(letters(black)).toBe("h1g2f3e4d5c6b7a8");
  });

  it("sets the width from size, and describes the diagram for screen readers with the text escaped", () => {
    const el = document.createElement("div");
    el.innerHTML = renderBoardSVG({ ...config, size: 280, title: 'Diagram "<b>x</b>"' });
    const svg = el.querySelector("svg")!;
    expect(svg.style.maxWidth).toBe("280px");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe('Diagram "<b>x</b>"');
    expect(svg.querySelector("title")?.textContent).toBe('Diagram "<b>x</b>"');
    expect(el.querySelector("b")).toBeNull();
    el.innerHTML = renderBoardSVG(config);
    expect(el.querySelector("svg")!.style.maxWidth).toBe("360px");
    expect(el.querySelector("title")).toBeNull();
  });

  it("has artwork for all twelve pieces in every set", () => {
    for (const set of Object.values(PIECE_SETS)) expect(Object.keys(set.pieces).sort().join("")).toBe("BKNPQRbknpqr");
  });
});

describe("chessboard block", () => {
  it("draws the board in a widget", () => {
    const { el } = render(`fen: ${START}`);
    expect(el.querySelector(".chessboard-plugin-widget svg.chessboard-plugin-svg")).not.toBeNull();
  });

  it("uses the saved defaults, and a block's own pieceset and boardtheme win", () => {
    const light = BOARD_THEMES.midnight.light;
    expect(render(`fen: ${START}`, () => ({ pieceSet: "classic", boardTheme: "midnight" })).el.innerHTML).toContain(light);
    expect(render(`fen: ${START}\nboardtheme: ocean`, () => ({ pieceSet: "classic", boardTheme: "midnight" })).el.innerHTML).not.toContain(light);
  });

  it("says so when fen is missing or invalid, with the text escaped", () => {
    expect(render("orientation: black").el.querySelector(".chessboard-error")?.textContent).toBe("no fen");
    const bad = render("fen: <img src=x onerror=alert(1)>/8/8/8/8/8/8/8");
    expect(bad.el.querySelector("img")).toBeNull();
    expect(bad.el.querySelector(".chessboard-error")?.textContent).toMatch(/^bad: /);
  });

  it("draws positions with no king or one king without strict: false", () => {
    for (const fen of ["8/2P5/8/8/8/8/8/8 w - - 0 1", "8/6N1/8/8/5q2/8/8/8 w - - 0 1", "8/8/8/8/8/8/8/8 w - - 0 1", "8/8/8/8/8/8/8/K7"]) {
      const { el } = render(`fen: ${fen}`);
      expect(el.querySelector(".chessboard-error")).toBeNull();
      expect(el.querySelector("svg.chessboard-plugin-svg")).not.toBeNull();
    }
  });

  it("passes labels, size and a description to the board", () => {
    const { el } = render(`fen: ${START}\nlabels: true\nsize: 300`);
    const svg = el.querySelector("svg")!;
    expect(svg.querySelectorAll("text")).toHaveLength(16);
    expect(svg.style.maxWidth).toBe("300px");
    expect(svg.getAttribute("aria-label")).toBe(`diagram: ${START}`);
  });

  it("draws an invalid FEN anyway when strict is false", () => {
    expect(render("fen: 8/8/8/8/8/8/8/k7\nstrict: false").el.querySelector("svg")).not.toBeNull();
  });

  it("clears the block when cleaned up", () => {
    const { el, cleanup } = render(`fen: ${START}`);
    (cleanup as () => void)();
    expect(el.childElementCount).toBe(0);
  });
});

describe("chessboard plugin", () => {
  function fakeApi(blob: Record<string, unknown>, save = vi.fn(async () => {})) {
    const registerCodeBlockProcessor = vi.fn();
    const addSettingsTab = vi.fn();
    const showNotice = vi.fn();
    const api = {
      markdown: { registerCodeBlockProcessor },
      ui: { addSettingsTab, showNotice },
      settings: { load: async () => blob, save },
      i18n: platformI18n("web"),
    } as unknown as PluginApi;
    return { api, registerCodeBlockProcessor, addSettingsTab, showNotice, save };
  }

  it("registers the chessboard language and a settings tab", async () => {
    const f = fakeApi({});
    await chessboardPlugin.onload(f.api);
    expect(f.registerCodeBlockProcessor).toHaveBeenCalledWith("chessboard", expect.any(Function));
    expect(f.addSettingsTab).toHaveBeenCalledWith(expect.objectContaining({ id: "settings" }));
  });

  it("applies the saved defaults to the first board, ignoring ids that no longer exist", async () => {
    const f = fakeApi({ pieceSet: "minimal", boardTheme: "gone" });
    await chessboardPlugin.onload(f.api);
    const processor = f.registerCodeBlockProcessor.mock.calls[0][1];
    const el = document.createElement("div");
    processor(`fen: ${START}`, el, CTX);
    expect(el.innerHTML).toContain(BOARD_THEMES.classic.light);
    expect(el.innerHTML).toContain(PIECE_SETS.minimal.viewBox);
    chessboardPlugin.onunload?.();
  });

  it("saves the chosen defaults from the settings tab and reports a failed save", async () => {
    const ok = fakeApi({});
    await chessboardPlugin.onload(ok.api);
    const tab = ok.addSettingsTab.mock.calls[0][0];
    const container = document.createElement("div");
    tab.render(container);
    const [pieces, themes] = Array.from(container.querySelectorAll("select"));
    pieces.value = "spatial";
    themes.value = "forest";
    pieces.dispatchEvent(new Event("change"));
    container.querySelector("button")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(ok.save).toHaveBeenCalledWith({ pieceSet: "spatial", boardTheme: "forest" });
    // Saved defaults redraw the open boards: the language is registered once more.
    expect(ok.registerCodeBlockProcessor).toHaveBeenCalledTimes(2);
    expect(ok.showNotice).toHaveBeenCalledWith(testI18n("vi").t("plugins.chessboard.saved"), 4000);

    const failing = fakeApi({}, vi.fn(async () => { throw new Error("quota"); }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await chessboardPlugin.onload(failing.api);
    const failContainer = document.createElement("div");
    failing.addSettingsTab.mock.calls[0][0].render(failContainer);
    failContainer.querySelector("button")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(failing.showNotice).toHaveBeenCalledWith(testI18n("vi").t("plugins.chessboard.saveFailed"), 6000);
    expect(failing.registerCodeBlockProcessor).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    chessboardPlugin.onunload?.();
  });
});
