import { describe, expect, it } from "vitest";
import { activityFolder, activityTimeline, orderFileEntries, parseFileOrder, relativeGitPath } from "../../../../packages/git-client/path-history";

describe("folder history", () => {
  it("uses the containing folder for the wildcard or an explicit vault-relative folder", () => {
    expect(activityFolder(".*.*", "Prosjekt/Timegrapher/00_Start_her.md")).toBe("Prosjekt/Timegrapher");
    expect(activityFolder("folder: Prosjekt/Discyboi/", "Home.md")).toBe("Prosjekt/Discyboi");
    expect(activityFolder("/", "Prosjekt/Timegrapher/00_Start_her.md")).toBe("");
    expect(() => activityFolder("../private", "Home.md")).toThrow();
    expect(relativeGitPath("C:\\vault", "C:\\vault\\Fyllepenn\\note.md")).toBe("Fyllepenn/note.md");
    expect(relativeGitPath("/vault", "/vault-copy/note.md")).toBeNull();
  });

  it("draws gaps and counts commits rather than paths", () => {
    const at = (date: string, paths: string[]) => ({
      date: String(Date.parse(date) / 1000), paths, hash: date, message: "change", author: "Test",
    });
    const result = activityTimeline([at("2026-11-27", ["a.md", "b.md"]), at("2026-11-25", ["c.md"])]);
    expect(result?.total).toBe(2);
    expect(result?.buckets.map(bucket => bucket.count)).toEqual([1, 0, 1]);
    expect(activityTimeline([at("2026-01-31", ["a"]), at("2026-05-01", ["a"])])?.buckets.map(bucket => bucket.label))
      .toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
  });
});

it("applies hand-written order, leaving unnamed files in their original order", () => {
  const files = ["Folder", "A.md", "B.md", "New.md"].map(name => ({ name }));
  const order = parseFileOrder("B.md\r\nFolder\nB.md\n") ?? [];
  expect(orderFileEntries(files, order).map(file => file.name)).toEqual(["B.md", "Folder", "A.md", "New.md"]);
});
