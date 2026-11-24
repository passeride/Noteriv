import { describe, expect, it } from "vitest";
import { aggregateTags, parseTags } from "../src/tag-utils";
import type { NoteRef } from "../src/vault-adapter";

describe("parseTags", () => {
  it("finds plain, nested and dashed tags once each", () => {
    expect(parseTags("a #one and #two/sub and #with-dash and #one again")).toEqual([
      "#one",
      "#two/sub",
      "#with-dash",
    ]);
  });
  it("ignores headings, pure numbers and mid-word hashes", () => {
    expect(parseTags("# Heading\n## Another\n#123 abc#nope")).toEqual([]);
  });
  it("ignores fenced code, inline code and URLs", () => {
    const text = "```\n#infence\n```\n`#inline` see https://x.test/p#anchor #real";
    expect(parseTags(text)).toEqual(["#real"]);
  });
  it("handles empty input", () => {
    expect(parseTags("")).toEqual([]);
  });
});

describe("aggregateTags", () => {
  const ref = (id: string): NoteRef => ({ id, path: `${id}.md`, name: `${id}.md` });
  const notes = [ref("a"), ref("b"), ref("c"), ref("gone")];
  const bodies: Record<string, string> = { a: "#x #y", b: "#x", c: "#x #z #z" };
  const read = async (id: string) => bodies[id] ?? null;

  it("counts distinct notes per tag, sorted by count then name", async () => {
    const out = await aggregateTags(notes, read);
    expect(out.map((t) => [t.tag, t.count])).toEqual([
      ["#x", 3],
      ["#y", 1],
      ["#z", 1],
    ]);
    expect(out[0].notes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
  it("skips notes that cannot be read", async () => {
    const out = await aggregateTags([ref("gone")], read);
    expect(out).toEqual([]);
  });
  it("works across more than one batch", async () => {
    const out = await aggregateTags(notes, read, 2);
    expect(out[0]).toMatchObject({ tag: "#x", count: 3 });
  });
});
