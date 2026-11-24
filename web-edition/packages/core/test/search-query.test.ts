import { describe, expect, it } from "vitest";
import { isPlainQuery, matchNote, parseSearch, prefilterTerms, replaceTarget, replaceInText } from "../src/search-query";

const note = (path: string, content: string) => ({ path, content });
const notes = [
  note("Projects/Plan.md", "---\nstatus: active\ntags: [work]\n---\n# Plan\nMeeting with Ann on 2026-10-22.\n- [ ] call bank #todo"),
  note("Journal/2026-10-21.md", "Walked in the park. Meeting cancelled.\n#personal"),
  note("Archive/Old plan.md", "---\nstatus: done\n---\nNothing to see"),
];

const run = (q: string) => {
  const parsed = parseSearch(q);
  if ("error" in parsed) throw new Error(parsed.error);
  return notes.filter((n) => matchNote(parsed.query, n).matches).map((n) => n.path);
};

describe("parseSearch + matchNote", () => {
  it("ANDs words, ORs with OR, negates with -, groups with parentheses (case-insensitive)", () => {
    expect(run("meeting ann")).toEqual(["Projects/Plan.md"]);
    expect(run("park OR nothing")).toEqual(["Journal/2026-10-21.md", "Archive/Old plan.md"]);
    expect(run("meeting -cancelled")).toEqual(["Projects/Plan.md"]);
    expect(run("-(meeting OR nothing)")).toEqual([]);
    expect(run('"with ann"')).toEqual(["Projects/Plan.md"]);
  });

  it("matches words in the file name too, and supports file:, path:, content:", () => {
    expect(run("old")).toEqual(["Archive/Old plan.md"]);
    expect(run("file:plan")).toEqual(["Projects/Plan.md", "Archive/Old plan.md"]);
    expect(run("path:projects")).toEqual(["Projects/Plan.md"]);
    expect(run("content:plan")).toEqual(["Projects/Plan.md"]);
  });

  it("supports regex, tag:, line:, match-case:, and properties", () => {
    // A plain regex also looks at file names (the journal note is named by its date); content: looks only inside.
    expect(run("/\\d{4}-\\d{2}-\\d{2}/")).toEqual(["Projects/Plan.md", "Journal/2026-10-21.md"]);
    expect(run("content:/\\d{4}-\\d{2}-\\d{2}/")).toEqual(["Projects/Plan.md"]);
    expect(run("tag:todo")).toEqual(["Projects/Plan.md"]);
    expect(run("tag:#work")).toEqual(["Projects/Plan.md"]);
    expect(run("tag:personal")).toEqual(["Journal/2026-10-21.md"]);
    expect(run("line:(meeting ann)")).toEqual(["Projects/Plan.md"]);
    expect(run("line:(walked cancelled)")).toEqual(["Journal/2026-10-21.md"]);
    expect(run("line:(walked personal)")).toEqual([]); // both words, but on different lines
    expect(run("match-case:Meeting")).toEqual(["Projects/Plan.md", "Journal/2026-10-21.md"]);
    expect(run("match-case:meeting")).toEqual([]);
    expect(run("[status]")).toEqual(["Projects/Plan.md", "Archive/Old plan.md"]);
    expect(run("[status:done]")).toEqual(["Archive/Old plan.md"]);
  });

  it("gives the lines that matched, for the result list", () => {
    const parsed = parseSearch("meeting");
    if ("error" in parsed) throw new Error();
    expect(matchNote(parsed.query, notes[1]).lines).toEqual([{ line: 1, text: "Walked in the park. Meeting cancelled." }]);
  });

  it("reports what it cannot read", () => {
    expect(parseSearch("/(unclosed/")).toEqual({ error: "regex" });
    expect(parseSearch('"open')).toEqual({ error: "quote" });
    expect(parseSearch("(a b")).toEqual({ error: "paren" });
  });
});

describe("review findings", () => {
  const target = (q: string) => {
    const p = parseSearch(q);
    return "error" in p ? null : replaceTarget(p.query);
  };

  it("replaces whole words only, and leaves front matter alone", () => {
    expect(replaceInText("cat category concat cat.", target("cat")!, "dog")).toBe("dog category concat dog.");
    expect(replaceInText("---\ntitle: cat\n---\na cat", target("cat")!, "dog")).toBe("---\ntitle: cat\n---\na dog");
  });

  it("refuses a regex that matches empty text as a replace target", () => {
    expect(target("/x*/")).toBeNull();
    expect(target("/^/")).toBeNull();
    expect(replaceInText("aa", target("/(?=a)a/")!, "b")).toBe("bb");
  });

  it("reports an empty side of OR or empty parentheses instead of matching everything", () => {
    expect(parseSearch("foo OR")).toEqual({ error: "operator" });
    expect(parseSearch("OR foo")).toEqual({ error: "operator" });
    expect(parseSearch("()")).toEqual({ error: "operator" });
  });

  it("reads a path with slashes as text, accepts the g flag, and a / inside a class", () => {
    expect(run("/usr/bin")).toEqual([]);
    expect(parseSearch("/usr/bin")).toEqual({ query: { kind: "term", field: "any", text: "/usr/bin", regex: null, caseSensitive: false } });
    expect(run("/meeting/g")).toEqual(["Projects/Plan.md", "Journal/2026-10-21.md"]);
    expect("error" in parseSearch("/[/]x/")).toBe(false);
  });
});

describe("helpers", () => {
  it("knows a plain query (the backend's ranked search handles it)", () => {
    expect(isPlainQuery("meeting ann")).toBe(true);
    expect(isPlainQuery("meeting OR ann")).toBe(false);
    expect(isPlainQuery("path:x")).toBe(false);
  });

  it("finds words every match must contain, to narrow which notes are read", () => {
    const terms = (q: string) => {
      const p = parseSearch(q);
      return "error" in p ? "error" : prefilterTerms(p.query);
    };
    expect(terms("meeting path:projects")).toEqual(["meeting"]);
    expect(terms("park OR nothing")).toEqual(["park", "nothing"]);
    expect(terms("path:projects")).toBeNull();
    expect(terms("-meeting")).toBeNull();
    expect(terms("/\\d+/")).toBeNull();
  });

  it("replaces the one thing searched for, keeping regex groups", () => {
    const target = (q: string) => {
      const p = parseSearch(q);
      return "error" in p ? null : replaceTarget(p.query);
    };
    expect(replaceInText("Meeting and meeting", target("meeting")!, "call")).toBe("call and call");
    expect(replaceInText("Meeting and meeting", target("match-case:meeting")!, "call")).toBe("Meeting and call");
    expect(replaceInText("on 2026-10-22", target("/(\\d{4})-(\\d{2})-(\\d{2})/")!, "$3.$2.$1")).toBe("on 22.10.2026");
    expect(replaceInText("a.b", target('"a.b"')!, "x")).toBe("x");
    expect(target("meeting path:projects")).not.toBeNull();
    expect(target("meeting OR park")).toBeNull();
    expect(target("meeting ann")).toBeNull();
  });
});
