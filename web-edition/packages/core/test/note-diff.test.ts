import { describe, expect, it } from "vitest";
import { diffStrings } from "../src/note-diff";

describe("diffStrings", () => {
  it("returns only same lines for identical text", () => {
    expect(diffStrings("a\nb", "a\nb")).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
    ]);
  });

  it("marks added and removed lines in document order", () => {
    expect(diffStrings("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
      { type: "add", text: "d" },
    ]);
  });

  it("handles an empty side", () => {
    expect(diffStrings("", "a")).toEqual([
      { type: "remove", text: "" },
      { type: "add", text: "a" },
    ]);
  });
});
