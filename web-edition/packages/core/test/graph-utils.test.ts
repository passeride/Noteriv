import { describe, expect, it } from "vitest";
import { buildLinkGraph, neighborhood } from "../src/graph-utils";
import type { NoteRef } from "../src/vault-adapter";

const ref = (path: string): NoteRef => ({ id: path, path, name: path.split("/").pop()! });
const notes = [ref("A.md"), ref("dir/B.md"), ref("C.md"), ref("D.md")];

function graph(contents: Record<string, string>) {
  return buildLinkGraph(notes, new Map(Object.entries(contents)));
}

describe("buildLinkGraph", () => {
  it("makes one edge per linked pair, marking the pair reciprocal when both directions exist", () => {
    const g = graph({ "A.md": "to [[B]]", "dir/B.md": "back [[A]] and on [[C]]", "C.md": "", "D.md": "" });
    expect(g.edges).toEqual([
      { source: "A.md", target: "dir/B.md", reciprocal: true },
      { source: "dir/B.md", target: "C.md", reciprocal: false },
    ]);
    expect(g.connections.get("A.md")).toBe(1);
    expect(g.connections.get("dir/B.md")).toBe(2);
    expect(g.connections.get("C.md")).toBe(1);
    expect(g.connections.has("D.md")).toBe(false);
  });

  it("resolves aliases and case, ignores unknown targets, self links and repeats", () => {
    const g = graph({ "A.md": "[[b|alias]] [[B]] [[Nope]] [[A]]", "dir/B.md": "", "C.md": "", "D.md": "" });
    expect(g.edges).toEqual([{ source: "A.md", target: "dir/B.md", reciprocal: false }]);
  });

  it("treats a note without content as having no links, and an empty vault as an empty graph", () => {
    expect(graph({}).edges).toEqual([]);
    expect(buildLinkGraph([], new Map()).edges).toEqual([]);
  });
});

describe("local graph", () => {
  it("links to a heading or a block count as links to the note", () => {
    const g = graph({ "A.md": "see [[B#Plan]] and [[C^x1]]", "dir/B.md": "", "C.md": "", "D.md": "" });
    expect(g.edges.map((e) => e.target)).toEqual(["dir/B.md", "C.md"]);
  });

  it("a note whose name has # in it is still found by its whole name", () => {
    const named = [ref("A.md"), ref("C# tips.md"), ref("C.md")];
    const g = buildLinkGraph(named, new Map([["A.md", "[[C# tips]] and [[C#Intro]]"]]));
    expect(g.edges.map((e) => e.target)).toEqual(["C# tips.md", "C.md"]);
  });

  it("follows links written as paths, and prefers the same-named note in the linking note's folder", () => {
    const named = [ref("x/Home.md"), ref("x/Note.md"), ref("y/Note.md"), ref("y/Other.md")];
    const g = buildLinkGraph(named, new Map([["x/Home.md", "[[y/Note]] [[Note]]"], ["y/Other.md", "[[Note]]"]]));
    expect(g.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["x/Home.md>y/Note.md", "x/Home.md>x/Note.md", "y/Other.md>y/Note.md"]);
  });

  it("finds the notes within a depth of links, whichever way they point", () => {
    // A → B → C → D: from B, depth 1 is A and C; depth 2 adds D.
    const g = graph({ "A.md": "[[B]]", "dir/B.md": "[[C]]", "C.md": "[[D]]", "D.md": "" });
    expect([...neighborhood(g.edges, "dir/B.md", 1)].sort()).toEqual(["A.md", "C.md", "dir/B.md"]);
    expect([...neighborhood(g.edges, "dir/B.md", 2)].sort()).toEqual(["A.md", "C.md", "D.md", "dir/B.md"]);
    expect([...neighborhood(g.edges, "D.md", 0)]).toEqual(["D.md"]);
    expect([...neighborhood([], "X.md", 2)]).toEqual(["X.md"]);
  });
});
