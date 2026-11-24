import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STICKY_COLORS,
  createDrawingNode,
  createEdge,
  createEdgeAutoSide,
  createFileNode,
  createGroupNode,
  createImageNode,
  createStickyNode,
  createTextNode,
  generateId,
  getAnchorPoint,
  isCanvasContent,
  parseCanvas,
  recalcEdgeSides,
  serializeCanvas,
  type CanvasNode,
} from "../src/canvas-utils";

afterEach(() => vi.restoreAllMocks());

const node = (id: string, x: number, y: number, w = 100, h = 100): CanvasNode => ({ id, type: "text", x, y, width: w, height: h });

describe("isCanvasContent", () => {
  it("needs canvas: true in the frontmatter", () => {
    expect(isCanvasContent("---\ncanvas: true\n---\n")).toBe(true);
    expect(isCanvasContent("---\ncanvas: false\n---\n")).toBe(false);
    expect(isCanvasContent("canvas: true")).toBe(false);
  });
});

describe("generateId", () => {
  it("is 16 lower-case hex characters and different each time", () => {
    const a = generateId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(generateId()).not.toBe(a);
  });
});

describe("node factories", () => {
  it("text nodes default to an empty 260x160 box", () => {
    expect(createTextNode(5, 6)).toMatchObject({ type: "text", x: 5, y: 6, width: 260, height: 160, text: "" });
    expect(createTextNode(0, 0, "hi").text).toBe("hi");
  });
  it("file nodes are 260x120 and carry the path", () => {
    expect(createFileNode(1, 2, "a/b.md")).toMatchObject({ type: "file", width: 260, height: 120, filePath: "a/b.md" });
  });
  it("group nodes take their size and label from the caller", () => {
    expect(createGroupNode(1, 2, 300, 200, "Openings")).toMatchObject({ type: "group", width: 300, height: 200, label: "Openings" });
  });
  it("image nodes are 300x240", () => {
    expect(createImageNode(0, 0, "pic.png")).toMatchObject({ type: "image", width: 300, height: 240, imagePath: "pic.png" });
  });
  it("sticky notes are 200x200, yellow by default, with a rotation of at most 2 degrees either way", () => {
    const rnd = vi.spyOn(Math, "random");
    rnd.mockReturnValue(0.5);
    expect(createStickyNode(0, 0)).toMatchObject({ type: "sticky", width: 200, height: 200, color: "yellow", rotation: 0 });
    rnd.mockReturnValue(0);
    expect(createStickyNode(0, 0, "t", "pink").rotation).toBe(-2);
    rnd.mockReturnValue(1);
    expect(createStickyNode(0, 0).rotation).toBe(2);
  });
  it("has a six-colour sticky palette", () => {
    expect(Object.keys(STICKY_COLORS)).toEqual(["yellow", "pink", "blue", "green", "purple", "peach"]);
  });
});

describe("createDrawingNode", () => {
  it("makes a 1x1 node at the origin for no points", () => {
    expect(createDrawingNode([])).toMatchObject({ type: "drawing", x: 0, y: 0, width: 1, height: 1, drawingPoints: [], strokeColor: "#cdd6f4", strokeWidth: 3 });
  });
  it("fits the node to the stroke with stroke-width padding and stores points relative to it", () => {
    const n = createDrawingNode([[10, 10], [30, 20]]);
    expect(n).toMatchObject({ x: 7, y: 7, width: 26, height: 16 });
    expect(n.drawingPoints).toEqual([[3, 3], [23, 13]]);
  });
  it("honours custom colour and width", () => {
    const n = createDrawingNode([[0, 0]], "#fff", 1);
    expect(n).toMatchObject({ strokeColor: "#fff", strokeWidth: 1, x: -1, y: -1, width: 2, height: 2 });
  });
});

describe("edges", () => {
  it("createEdge defaults to right -> left", () => {
    expect(createEdge("a", "b")).toMatchObject({ fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" });
  });
  it("createEdgeAutoSide picks the sides that face each other", () => {
    const a = node("a", 0, 0);
    expect(createEdgeAutoSide(a, node("b", 300, 0))).toMatchObject({ fromSide: "right", toSide: "left" });
    expect(createEdgeAutoSide(a, node("b", -300, 0))).toMatchObject({ fromSide: "left", toSide: "right" });
    expect(createEdgeAutoSide(a, node("b", 0, 300))).toMatchObject({ fromSide: "bottom", toSide: "top" });
    expect(createEdgeAutoSide(a, node("b", 0, -300))).toMatchObject({ fromSide: "top", toSide: "bottom" });
  });
  it("prefers the vertical sides when the offset is diagonal and equal", () => {
    expect(createEdgeAutoSide(node("a", 0, 0), node("b", 200, 200))).toMatchObject({ fromSide: "bottom", toSide: "top" });
  });
  it("recalcEdgeSides updates sides from current positions, and leaves an edge with a missing node alone", () => {
    const nodes = [node("a", 0, 0), node("b", 0, 300)];
    const edge = createEdge("a", "b");
    expect(recalcEdgeSides(edge, nodes)).toMatchObject({ id: edge.id, fromSide: "bottom", toSide: "top" });
    expect(recalcEdgeSides(createEdge("a", "zzz"), nodes)).toMatchObject({ fromSide: "right", toSide: "left" });
  });
});

describe("getAnchorPoint", () => {
  const n = node("a", 10, 20, 100, 50);
  it("returns the middle of each side", () => {
    expect(getAnchorPoint(n, "top")).toEqual({ x: 60, y: 20 });
    expect(getAnchorPoint(n, "bottom")).toEqual({ x: 60, y: 70 });
    expect(getAnchorPoint(n, "left")).toEqual({ x: 10, y: 45 });
    expect(getAnchorPoint(n, "right")).toEqual({ x: 110, y: 45 });
  });
});

describe("serialize / parse", () => {
  it("round-trips", () => {
    const data = { nodes: [node("a", 1, 2)], edges: [createEdge("a", "a")] };
    expect(parseCanvas(serializeCanvas(data))).toEqual(data);
  });
  it("uses two-space indentation", () => {
    expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n  "nodes": [],\n  "edges": []\n}');
  });
  it("falls back to an empty canvas for invalid JSON or missing arrays", () => {
    expect(parseCanvas("nope")).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas("{}")).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas('{"nodes":"x","edges":5}')).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas('{"nodes":[{"id":"a"}]}').nodes).toEqual([{ id: "a" }]);
  });
});
