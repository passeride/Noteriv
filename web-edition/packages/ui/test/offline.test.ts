import { describe, expect, it } from "vitest";
// Offline reading and writing (stage 4, session 4.8): the client and the server must agree on the version hash, and
// the store keeps the most recently used notes.
import { contentHash as clientHash } from "../../../web/src/lib/content-hash";
import { contentHash as serverHash } from "../../../web/server/src/lib/contentHash";
import { isNetworkError, pickEvictions, staleNote } from "../../../web/src/lib/offline";
import { ApiError } from "../../../web/src/lib/webApi";

describe("content hash", () => {
  it("is the same on the client and the server", async () => {
    for (const text of ["", "# Hello\n\nworld", "Tiếng Việt có dấu — and emoji 🙂", "a\r\nb\n"]) {
      expect(await clientHash(text)).toBe(serverHash(text));
    }
  });

  it("tells different texts apart", async () => {
    expect(await clientHash("a")).not.toBe(await clientHash("a "));
  });
});

describe("isNetworkError", () => {
  it("is true for a failed fetch and for an unreachable app behind the proxy", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    for (const status of [502, 503, 504]) expect(isNetworkError(new ApiError(status, null))).toBe(true);
  });

  it("is false when the server answered", () => {
    for (const status of [400, 401, 403, 404, 409, 500]) expect(isNetworkError(new ApiError(status, null))).toBe(false);
    expect(isNetworkError(new Error("boom"))).toBe(false);
  });
});

describe("staleNote", () => {
  const body = { error: "stale", note: { id: "n" }, copy: { id: "c", path: "a (conflict 2026-10-18 1200).md", name: "a (conflict 2026-10-18 1200).md" } };

  it("reads the conflict answer of a save", () => {
    expect(staleNote(new ApiError(409, body))?.copy.id).toBe("c");
  });

  it("ignores other conflicts and errors", () => {
    expect(staleNote(new ApiError(409, { error: "path_exists" }))).toBeNull();
    expect(staleNote(new ApiError(500, body))).toBeNull();
    expect(staleNote(new TypeError("x"))).toBeNull();
  });
});

describe("pickEvictions", () => {
  const notes = [
    { id: "old", size: 10, touchedAt: 1 },
    { id: "mid", size: 10, touchedAt: 2 },
    { id: "new", size: 10, touchedAt: 3 },
  ];

  it("keeps the most recently used notes within the count", () => {
    expect(pickEvictions(notes, 2, 1000)).toEqual(["old"]);
  });

  it("keeps the most recently used notes within the size", () => {
    expect(pickEvictions(notes, 10, 25).sort()).toEqual(["old"]);
    expect(pickEvictions(notes, 10, 15).sort()).toEqual(["mid", "old"]);
  });

  it("drops nothing under the limits", () => {
    expect(pickEvictions(notes, 3, 30)).toEqual([]);
  });
});
