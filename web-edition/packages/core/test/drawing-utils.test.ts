import { describe, expect, it } from "vitest";
import {
  createEmptyDrawing,
  elementsToSVG,
  generateDrawingName,
  isDrawingContent,
  isDrawingFile,
  parseDrawing,
  serializeDrawing,
  type DrawingElement,
} from "../src/drawing-utils";

describe("detection", () => {
  it("isDrawingContent needs drawing: true in the frontmatter", () => {
    expect(isDrawingContent("---\ndrawing: true\n---\n")).toBe(true);
    expect(isDrawingContent("---\ndrawing: false\n---\n")).toBe(false);
    expect(isDrawingContent("drawing: true")).toBe(false);
  });
  it("isDrawingFile checks the .drawing suffix", () => {
    expect(isDrawingFile("a/b.drawing")).toBe(true);
    expect(isDrawingFile("a/b.md")).toBe(false);
  });
});

describe("create / parse / serialize", () => {
  it("creates an empty dark drawing", () => {
    expect(createEmptyDrawing()).toEqual({
      type: "drawing",
      version: 2,
      elements: [],
      appState: { viewBackgroundColor: "#1e1e2e", theme: "dark" },
    });
  });
  it("accepts type 'drawing' and 'excalidraw' JSON, rejects other JSON and invalid text", () => {
    expect(parseDrawing('{"type":"drawing","elements":[]}')).toEqual({ type: "drawing", elements: [] });
    expect(parseDrawing('{"type":"excalidraw"}')).toEqual({ type: "excalidraw" });
    expect(parseDrawing('{"type":"board"}')).toBeNull();
    expect(parseDrawing("not json")).toBeNull();
    expect(parseDrawing("null")).toBeNull();
  });
  it("serializes with two-space indentation and round-trips", () => {
    const d = createEmptyDrawing();
    const json = serializeDrawing(d);
    expect(json.startsWith('{\n  "type": "drawing"')).toBe(true);
    expect(parseDrawing(json)).toEqual(d);
  });
});

describe("generateDrawingName", () => {
  it("picks the first free name", () => {
    expect(generateDrawingName([])).toBe("Drawing.drawing");
    expect(generateDrawingName(["Drawing.drawing"])).toBe("Drawing 2.drawing");
    expect(generateDrawingName(["Drawing.drawing", "Drawing 2.drawing"])).toBe("Drawing 3.drawing");
    expect(generateDrawingName(["Drawing 2.drawing"])).toBe("Drawing.drawing");
  });
});

describe("elementsToSVG", () => {
  const el = (e: Partial<DrawingElement> & { type: string }): DrawingElement => ({ id: "1", x: 0, y: 0, width: 0, height: 0, ...e });

  it("draws a placeholder for an empty drawing", () => {
    const svg = elementsToSVG([]);
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain("Empty Drawing");
  });
  it("sizes the canvas to the bounding box plus 20px padding on each side", () => {
    const svg = elementsToSVG([el({ type: "rectangle", x: 10, y: 20, width: 100, height: 50 })]);
    expect(svg).toContain('width="140" height="90" viewBox="0 0 140 90"');
    expect(svg).toContain('<rect x="20" y="20" width="100" height="50" stroke="#cdd6f4" fill="transparent" stroke-width="2" rx="4"/>');
  });
  it("uses the element's own colours", () => {
    const svg = elementsToSVG([el({ type: "rectangle", width: 10, height: 10, strokeColor: "#ff0000", backgroundColor: "#00ff00" })]);
    expect(svg).toContain('stroke="#ff0000" fill="#00ff00"');
  });
  it("draws ellipses, lines, arrows (with a marker), text and pencil strokes", () => {
    const svg = elementsToSVG([
      el({ type: "ellipse", width: 20, height: 10 }),
      el({ type: "line", width: 5, height: 5 }),
      el({ type: "arrow", width: 5, height: 5 }),
      el({ type: "text", text: "a<b" }),
      el({ type: "pencil", points: [[0, 0], [10, 5]] }),
    ]);
    expect(svg).toContain('<ellipse cx="30" cy="25" rx="10" ry="5"');
    expect(svg).toContain("<line ");
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).toContain(">a&lt;b</text>");
    expect(svg).toContain('<polyline points="20,20 30,25"');
  });
  it("ignores element types it does not know", () => {
    const svg = elementsToSVG([el({ type: "mystery", width: 5, height: 5 })]);
    expect(svg).not.toMatch(/<rect x=|<ellipse|<line|<polyline/);
  });
});
