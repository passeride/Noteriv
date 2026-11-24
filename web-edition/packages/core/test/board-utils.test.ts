import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCard,
  addColumn,
  createBoardContent,
  isBoardContent,
  isBoardFile,
  moveCard,
  parseBoard,
  removeCard,
  removeColumn,
  reorderCard,
  serializeBoard,
  toggleCard,
  updateCard,
  type BoardData,
} from "../src/board-utils";

// Ids are built from Date.now(); pin the clock so they can be asserted exactly.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => vi.useRealTimers());

const SAMPLE = "---\nboard: true\n---\n\n## Todo\n\n- [ ] A #x @due(2024-03-15)\n- [x] B\n\n## Done\n\n";

describe("detection", () => {
  it("isBoardContent needs board: true in the frontmatter", () => {
    expect(isBoardContent("---\nboard: true\n---\n")).toBe(true);
    expect(isBoardContent("---\ntitle: x\nboard:   true\n---\n")).toBe(true);
    expect(isBoardContent("---\nboard: false\n---\n")).toBe(false);
    expect(isBoardContent("board: true")).toBe(false);
  });
  it("isBoardFile checks the .board.md suffix", () => {
    expect(isBoardFile("plans/week.board.md")).toBe(true);
    expect(isBoardFile("plans/week.md")).toBe(false);
  });
});

describe("parseBoard", () => {
  it("reads frontmatter, columns and cards with tags, due date and completion", () => {
    const b = parseBoard(SAMPLE);
    expect(b.frontmatter).toBe("---\nboard: true\n---");
    expect(b.columns.map((c) => c.title)).toEqual(["Todo", "Done"]);
    const [a, bb] = b.columns[0].cards;
    expect(a).toMatchObject({ text: "A", completed: false, tags: ["x"], dueDate: "2024-03-15" });
    expect(bb).toMatchObject({ text: "B", completed: true, tags: [], dueDate: null });
    expect(b.columns[1].cards).toEqual([]);
  });
  it("gives columns and cards time-based ids", () => {
    const b = parseBoard("## One\n- [ ] x\n## Two");
    expect(b.columns.map((c) => c.id)).toEqual(["col-1700000000000-0", "col-1700000000000-1"]);
    expect(b.columns[0].cards[0].id).toMatch(/^card-1700000000000-\d+$/);
  });
  it("accepts [X] and strips tags and @due() from the text", () => {
    const [c] = parseBoard("## C\n- [X] Fix #bug-1 now @due(2025-01-02) #p1").columns[0].cards;
    expect(c).toMatchObject({ completed: true, tags: ["bug-1", "p1"], dueDate: "2025-01-02" });
    expect(c.text).toBe("Fix  now"); // removal leaves the inner double space
  });
  it("ignores cards that appear before any column and non-card lines", () => {
    const b = parseBoard("- [ ] orphan\nsome text\n## C\nnotes\n- [ ] kept");
    expect(b.columns).toHaveLength(1);
    expect(b.columns[0].cards.map((c) => c.text)).toEqual(["kept"]);
  });
  it("handles an unterminated frontmatter block by taking everything as frontmatter", () => {
    const b = parseBoard("---\nboard: true\n## NotAColumn");
    expect(b.columns).toEqual([]);
    expect(b.frontmatter).toBe("---\nboard: true\n## NotAColumn");
  });
  it("returns an empty board for empty content", () => {
    expect(parseBoard("")).toEqual({ columns: [], frontmatter: "" });
  });
});

describe("serializeBoard", () => {
  it("round-trips a normalised board", () => {
    expect(serializeBoard(parseBoard(SAMPLE))).toBe(SAMPLE);
  });
  it("writes tags then due date after the text, and omits frontmatter when empty", () => {
    const md = serializeBoard({
      frontmatter: "",
      columns: [{ id: "c", title: "T", cards: [{ id: "1", text: "x", completed: true, tags: ["a", "b"], dueDate: "2024-01-01" }] }],
    });
    expect(md).toBe("## T\n\n- [x] x #a #b @due(2024-01-01)\n");
  });
});

describe("board operations (pure: never mutate the input)", () => {
  const board = (): BoardData => ({
    frontmatter: "",
    columns: [
      { id: "c1", title: "A", cards: [{ id: "k1", text: "one", completed: false, tags: [], dueDate: null }, { id: "k2", text: "two", completed: false, tags: [], dueDate: null }] },
      { id: "c2", title: "B", cards: [] },
    ],
  });

  it("moveCard moves between columns at the given index", () => {
    const b = board();
    const out = moveCard(b, "k1", "c1", "c2", 0);
    expect(out.columns[0].cards.map((c) => c.id)).toEqual(["k2"]);
    expect(out.columns[1].cards.map((c) => c.id)).toEqual(["k1"]);
    expect(b.columns[0].cards).toHaveLength(2);
  });
  it("moveCard returns the same board for unknown columns or cards", () => {
    const b = board();
    expect(moveCard(b, "k1", "nope", "c2", 0)).toBe(b);
    expect(moveCard(b, "k1", "c1", "nope", 0)).toBe(b);
    expect(moveCard(b, "zzz", "c1", "c2", 0)).toBe(b);
  });
  it("reorderCard changes the order inside a column", () => {
    const out = reorderCard(board(), "c1", 0, 1);
    expect(out.columns[0].cards.map((c) => c.id)).toEqual(["k2", "k1"]);
    expect(reorderCard(board(), "nope", 0, 1).columns[0].cards.map((c) => c.id)).toEqual(["k1", "k2"]);
  });
  it("addCard appends an open, untagged card", () => {
    const out = addCard(board(), "c2", "new");
    expect(out.columns[1].cards).toHaveLength(1);
    expect(out.columns[1].cards[0]).toMatchObject({ text: "new", completed: false, tags: [], dueDate: null });
  });
  it("removeCard, updateCard and toggleCard touch only the matching card", () => {
    expect(removeCard(board(), "c1", "k1").columns[0].cards.map((c) => c.id)).toEqual(["k2"]);
    expect(updateCard(board(), "c1", "k2", "TWO").columns[0].cards.map((c) => c.text)).toEqual(["one", "TWO"]);
    expect(toggleCard(board(), "c1", "k1").columns[0].cards.map((c) => c.completed)).toEqual([true, false]);
    // wrong column: nothing changes
    expect(toggleCard(board(), "c2", "k1").columns[0].cards.map((c) => c.completed)).toEqual([false, false]);
  });
  it("addColumn and removeColumn", () => {
    const withCol = addColumn(board(), "C");
    expect(withCol.columns.map((c) => c.title)).toEqual(["A", "B", "C"]);
    expect(withCol.columns[2].id).toBe("col-1700000000000");
    expect(removeColumn(board(), "c1").columns.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("createBoardContent", () => {
  it("is a board with three columns and one starter card", () => {
    const md = createBoardContent();
    expect(isBoardContent(md)).toBe(true);
    const b = parseBoard(md);
    expect(b.columns.map((c) => c.title)).toEqual(["To Do", "In Progress", "Done"]);
    expect(b.columns[0].cards.map((c) => c.text)).toEqual(["New task"]);
  });
});
