import { describe, expect, it } from "vitest";
import { inferPermissions, permissionForMethod } from "../src/permissions";

describe("inferPermissions", () => {
  it("proposes only what api.<ns>.<method> calls use", () => {
    const code = `
      module.exports = { onLoad(api) {
        api.markdown.registerCodeBlockProcessor("chessboard", () => {});
        api.ui.addCommand({ id: "x", name: "X", callback() {} });
      } };`;
    expect(inferPermissions(code).sort()).toEqual(["markdown:render", "ui:commands"]);
  });

  it("ignores comments and strings that merely mention an API", () => {
    const code = `// api.vault.write(x)\n/* api.editor.setContent */ var s = "api.vault.read"; api.ui.showNotice("hi");`;
    expect(inferPermissions(code)).toEqual([]);
  });

  it("follows a simple alias", () => {
    expect(inferPermissions(`var vault = api.vault; vault.read("a"); vault.write("a", "b");`).sort()).toEqual(["vault:read", "vault:write"]);
  });

  it("maps methods to permissions", () => {
    expect(permissionForMethod("editor", "getContent")).toBe("editor:read");
    expect(permissionForMethod("ui", "showNotice")).toBeNull();
  });
});
