import { expect, it } from "vitest";
import { decorationKey, fileDecoration, parseDecorationFile, updateDecoration } from "../file-decorations";

it("uses the same vault paths as Android on Windows desktop", () => {
  expect(decorationKey("C:\\Vault\\Main", "c:/vault/Main/Prosjekt/Plan.md")).toBe("Prosjekt/Plan.md");
  expect(decorationKey("C:\\Vault\\Main", "C:\\Vault\\Main2\\Plan.md")).toBeNull();
  expect(decorationKey("/vault", "/vault/Prosjekt/Deler/")).toBe("Prosjekt/Deler");
});

it("preserves banners and supports a ring without an emoji", () => {
  const entries = parseDecorationFile('{"Plan.md":{"symbol":"🛠️","color":"#6278B5","banner":"cover.png"},"Folder":{"symbol":"📁"}}');
  const updated = updateDecoration(entries, "Plan.md", { color: "#556677" });
  expect(JSON.parse(JSON.stringify(updated))).toEqual({
    "Plan.md": { color: "#556677", banner: "cover.png" },
    Folder: { symbol: "📁" },
  });
  expect(fileDecoration({ color: "red" }).color).toBeUndefined();
});
