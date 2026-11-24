import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES, isLightTheme } from "../src/themes";

describe("built-in themes", () => {
  it("has unique ids and a full palette of hex colours for each", () => {
    expect(new Set(BUILT_IN_THEMES.map((t) => t.id)).size).toBe(BUILT_IN_THEMES.length);
    expect(BUILT_IN_THEMES[0].id).toBe("catppuccin-mocha");
    for (const theme of BUILT_IN_THEMES) {
      expect(Object.keys(theme.colors)).toHaveLength(18);
      for (const value of Object.values(theme.colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("tells light themes from dark ones (the phone's dark/light flag)", () => {
    const light = BUILT_IN_THEMES.filter((t) => isLightTheme(t.colors)).map((t) => t.id);
    expect(light).toEqual(["catppuccin-latte", "solarized-light"]);
    expect(isLightTheme({ bgPrimary: "#fff" })).toBe(true);
    expect(isLightTheme({ bgPrimary: "not a colour" })).toBe(false);
    expect(isLightTheme({ bgPrimary: " #ffffff " })).toBe(true);
    expect(isLightTheme({ bgPrimary: "#fffa" })).toBe(true);
    expect(isLightTheme({ bgPrimary: "beige" })).toBe(false);
    expect(isLightTheme({ bgPrimary: "rgb(255, 255, 255)" })).toBe(false);
  });
});
