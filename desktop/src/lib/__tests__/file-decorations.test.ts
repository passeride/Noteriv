import { expect, it } from "vitest";
import { decorationKey, fileDecoration, parseDecorationFile, updateDecoration } from "../file-decorations";

it("uses the same vault paths as Android on Windows desktop", () => {
  expect(decorationKey("C:\\Vault\\Main", "c:/vault/Main/Prosjekt/Plan.md")).toBe("Prosjekt/Plan.md");
  expect(decorationKey("C:\\Vault\\Main", "C:\\Vault\\Main2\\Plan.md")).toBeNull();
  expect(decorationKey("/vault", "/vault/Prosjekt/Deler/")).toBe("Prosjekt/Deler");
});

it("keeps existing icons without treating their Android tint as a ring", () => {
  expect(fileDecoration({ symbol: "🛠️", color: "#6278B5" })).toEqual({ symbol: "🛠️" });
  expect(fileDecoration({ ringColor: "red" }).color).toBeUndefined();
});

it("sets and clears a ring independently of the Android tint and banner", () => {
  const entries = parseDecorationFile('{"Plan.md":{"symbol":"🛠️","color":"#6278B5","banner":"cover.png"},"Folder":{"symbol":"📁"}}');
  const updated = updateDecoration(entries, "Plan.md", { color: "#556677" });
  expect(JSON.parse(JSON.stringify(updated))).toEqual({
    "Plan.md": { color: "#6278B5", ringColor: "#556677", banner: "cover.png" },
    Folder: { symbol: "📁" },
  });
  expect(fileDecoration(updated["Plan.md"]).color).toBe("#556677");

  const cleared = updateDecoration(updated, "Plan.md", {});
  expect(JSON.parse(JSON.stringify(cleared))["Plan.md"]).toEqual({
    color: "#6278B5",
    banner: "cover.png",
  });
  expect(fileDecoration(cleared["Plan.md"]).color).toBeUndefined();
});
