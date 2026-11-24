import { describe, expect, it } from "vitest";
import { executeQuery, parseNoteData, parseQuery, type DataviewQuery, type NoteData } from "../src/dataview";

const stats = { created: "2024-01-01", modified: "2024-02-01", size: 10 };
const parsed = (q: string) => parseQuery(q) as DataviewQuery;

describe("parseQuery", () => {
  it("rejects empty queries and unknown types", () => {
    expect(parseQuery("  ")).toEqual({ error: "Empty query" });
    expect(parseQuery("FOO bar")).toEqual({ error: "Unknown query type: FOO. Use TABLE, LIST, or TASK." });
  });

  it("parses a full TABLE query", () => {
    const q = parsed("table title, author FROM #chess WHERE rating > 1800 SORT BY title DESC LIMIT 5");
    expect(q).toEqual({
      type: "TABLE",
      fields: ["title", "author"],
      from: { type: "tag", tag: "chess" },
      where: { type: "comparison", field: "rating", op: ">", value: "1800" },
      sortBy: { field: "title", order: "DESC" },
      limit: 5,
    });
  });

  it("parses FROM as a tag, a quoted folder, an unquoted folder, or everything", () => {
    expect(parsed("LIST FROM #t").from).toEqual({ type: "tag", tag: "t" });
    expect(parsed('LIST FROM "My Notes/Sub"').from).toEqual({ type: "folder", path: "My Notes/Sub" });
    expect(parsed("LIST FROM Notes").from).toEqual({ type: "folder", path: "Notes" });
    expect(parsed('LIST FROM ""').from).toEqual({ type: "all" });
    expect(parsed("LIST").from).toEqual({ type: "all" });
  });

  // Known quirk: for TABLE, every token up to FROM is a column name, so without FROM the later clauses are swallowed.
  it("TABLE without FROM reads WHERE/SORT/LIMIT as column names", () => {
    const q = parsed("TABLE title WHERE a = 1 LIMIT 3");
    expect(q.fields).toEqual(["title", "WHERE", "a", "=", "1", "LIMIT", "3"]);
    expect(q.where).toBeNull();
    expect(q.limit).toBeNull();
  });

  it("defaults the sort order to ASC and ignores a non-numeric LIMIT", () => {
    expect(parsed("LIST SORT BY name").sortBy).toEqual({ field: "name", order: "ASC" });
    expect(parsed("LIST LIMIT abc").limit).toBeNull();
  });

  it("joins comparisons with AND / OR", () => {
    expect(parsed("LIST WHERE a = 1 AND b = 2").where).toEqual({
      type: "and",
      left: { type: "comparison", field: "a", op: "=", value: "1" },
      right: { type: "comparison", field: "b", op: "=", value: "2" },
    });
    expect(parsed("LIST WHERE a = 1 OR b != 2").where).toMatchObject({ type: "or", right: { op: "!=" } });
  });

  it("parses contains(field, \"text\")", () => {
    expect(parsed('LIST WHERE contains(title, "king")').where).toEqual({ type: "contains", field: "title", value: "king" });
  });

  // The header comment of dataview.ts shows `WHERE !completed`, but "!" only negates when it is its own token.
  it("negates only with a separate ! token; '!completed' is read as a field named '!completed'", () => {
    expect(parsed("TASK WHERE ! completed").where).toEqual({
      type: "not",
      clause: { type: "comparison", field: "completed", op: "!=", value: "" },
    });
    expect(parsed("TASK WHERE !completed").where).toEqual({ type: "comparison", field: "!completed", op: "!=", value: "" });
  });
});

describe("parseNoteData", () => {
  const content = [
    "---",
    'title: "Italian Game"',
    "tags: [opening, e4]",
    "rating: 1500",
    "---",
    "# Heading",
    "#chess #chess",
    "- [ ] study",
    "  - [x] done",
    "",
  ].join("\n");
  const n = parseNoteData("/v/Chess/Italian.md", content, stats);

  it("derives name and folder from the path and keeps the stats", () => {
    expect(n.file).toMatchObject({ name: "Italian", path: "/v/Chess/Italian.md", folder: "/v/Chess", ...stats });
  });
  it("reads frontmatter values, stripping surrounding quotes", () => {
    expect(n.frontmatter).toMatchObject({ title: "Italian Game", rating: "1500", tags: "[opening, e4]" });
  });
  it("collects unique inline #tags first, then frontmatter tags", () => {
    expect(n.file.tags).toEqual(["chess", "opening", "e4"]);
  });
  it("finds tasks with their completion state and 1-based line", () => {
    expect(n.tasks).toEqual([
      { text: "study", completed: false, line: 8 },
      { text: "done", completed: true, line: 9 },
    ]);
  });
  it("treats .markdown like .md for the name", () => {
    expect(parseNoteData("/a/b.markdown", "", stats).file.name).toBe("b");
  });
});

describe("executeQuery", () => {
  const mk = (path: string, fm: string, body = ""): NoteData => parseNoteData(path, `---\n${fm}\n---\n${body}`, stats);
  const notes = (): NoteData[] => [
    mk("/v/Chess/B.md", "title: B\nrating: 1500", "#chess\n- [ ] one"),
    mk("/v/Chess/Endgames/A.md", "title: A\nrating: 1900", "#chess\n- [x] two"),
    mk("/v/Other/C.md", "title: C\nrating: 900", "#other"),
  ];
  const names = (r: { rows: Record<string, string>[] }) => r.rows.map((x) => x["file.name"] ?? x["title"]);

  it("filters FROM a tag", () => {
    expect(names(executeQuery(parsed("TABLE title FROM #chess"), notes()))).toEqual(["B", "A"]);
  });
  it("filters FROM a folder by path prefix (subfolders included)", () => {
    expect(names(executeQuery(parsed('TABLE title FROM "/v/Chess"'), notes()))).toEqual(["B", "A"]);
    expect(names(executeQuery(parsed('TABLE title FROM "/v/Chess/Endgames"'), notes()))).toEqual(["A"]);
  });
  it("TABLE returns the requested fields plus file.path; defaults to file.name", () => {
    const r = executeQuery(parsed("TABLE title, rating FROM #other"), notes());
    expect(r.fields).toEqual(["title", "rating"]);
    expect(r.rows).toEqual([{ title: "C", rating: "900", "file.path": "/v/Other/C.md" }]);
    expect(executeQuery(parsed("TABLE"), notes()).fields).toEqual(["file.name"]);
  });
  it("LIST returns file.name and file.path", () => {
    const r = executeQuery(parsed("LIST FROM #other"), notes());
    expect(r.fields).toEqual(["file.name"]);
    expect(r.rows).toEqual([{ "file.name": "C", "file.path": "/v/Other/C.md" }]);
  });
  it("TASK returns every task of the matching notes", () => {
    const r = executeQuery(parsed("TASK FROM #chess"), notes());
    expect(r.tasks).toEqual([
      { text: "one", completed: false, filePath: "/v/Chess/B.md", fileName: "B" },
      { text: "two", completed: true, filePath: "/v/Chess/Endgames/A.md", fileName: "A" },
    ]);
  });

  describe("WHERE", () => {
    const run = (q: string) => names(executeQuery(parsed(`TABLE title FROM "" ${q}`), notes()));
    it("= and != compare as strings", () => {
      expect(run("WHERE title = B")).toEqual(["B"]);
      expect(run("WHERE title != B")).toEqual(["A", "C"]);
    });
    it("contains is case-insensitive", () => {
      expect(run('WHERE contains(title, "b")')).toEqual(["B"]);
    });
    it("supports file.* fields and tags", () => {
      expect(run("WHERE file.folder = /v/Other")).toEqual(["C"]);
      expect(run("WHERE file.name = A")).toEqual(["A"]);
    });
    it("AND, OR and a separate ! negation", () => {
      expect(run("WHERE title = A OR title = C")).toEqual(["A", "C"]);
      expect(run("WHERE title != A AND title != B")).toEqual(["C"]);
      expect(run("WHERE ! title")).toEqual([]); // "title" is non-empty for every note
    });
    it("the field name 'completed' always matches", () => {
      expect(run("WHERE completed")).toEqual(["B", "A", "C"]);
    });
    // Known quirk: ordering operators compare strings, not numbers, so "900" > "1000".
    it("> and < are lexicographic (numbers are not parsed)", () => {
      expect(run("WHERE rating > 1000")).toEqual(["B", "A", "C"]);
      expect(run("WHERE rating > 1600")).toEqual(["A", "C"]);
    });
  });

  it("sorts by a field ascending or descending, and applies LIMIT", () => {
    expect(names(executeQuery(parsed("TABLE title FROM \"\" SORT BY title ASC"), notes()))).toEqual(["A", "B", "C"]);
    expect(names(executeQuery(parsed("TABLE title FROM \"\" SORT BY title DESC LIMIT 2"), notes()))).toEqual(["C", "B"]);
    expect(names(executeQuery(parsed("TABLE title FROM \"\" LIMIT 0"), notes()))).toEqual(["B", "A", "C"]); // 0 means no limit
  });

  // Known quirk: with no FROM/WHERE the query sorts the caller's array in place.
  it("sorts the input array in place when nothing filters it", () => {
    const input = notes();
    executeQuery(parsed("TABLE title FROM \"\" SORT BY title ASC"), input);
    expect(input.map((n) => n.frontmatter.title)).toEqual(["A", "B", "C"]);
    const filtered = notes();
    executeQuery(parsed("TABLE title FROM #chess SORT BY title ASC"), filtered);
    expect(filtered.map((n) => n.frontmatter.title)).toEqual(["B", "A", "C"]);
  });
});
