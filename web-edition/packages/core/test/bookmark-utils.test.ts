import { describe, expect, it } from "vitest";
import { isBookmarked, toggleBookmark } from "../src/bookmark-utils";

describe("bookmarks", () => {
  it("isBookmarked is an exact match on the key", () => {
    expect(isBookmarked(["a", "b"], "a")).toBe(true);
    expect(isBookmarked(["a", "b"], "A")).toBe(false);
    expect(isBookmarked([], "a")).toBe(false);
  });
  it("toggleBookmark appends a missing key at the end", () => {
    expect(toggleBookmark(["a"], "b")).toEqual(["a", "b"]);
  });
  it("toggleBookmark removes an existing key", () => {
    expect(toggleBookmark(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
  it("never mutates its input", () => {
    const input = ["a"];
    toggleBookmark(input, "b");
    toggleBookmark(input, "a");
    expect(input).toEqual(["a"]);
  });
});
