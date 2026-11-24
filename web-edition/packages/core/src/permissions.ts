/**
 * Permission proposals for community plugins.
 *
 * Desktop plugins from before the permission model have no `permissions` in their manifest, so the host derives a
 * proposal from the code. This only ever *proposes* (the user confirms before install); enforcement stays default-deny
 * at run time, so a plugin that hides a call from this scan simply has that call rejected.
 */

// api.<namespace>.<method> -> permission the sandbox requires for it.
const METHOD_TO_PERMISSION: Record<string, string> = {
  "vault.read": "vault:read",
  "vault.list": "vault:read",
  "vault.exists": "vault:read",
  "vault.write": "vault:write",
  "vault.delete": "vault:write",
  "editor.getContent": "editor:read",
  "editor.getSelection": "editor:read",
  "editor.getCursorPosition": "editor:read",
  "editor.setContent": "editor:write",
  "editor.insertAtCursor": "editor:write",
  "editor.replaceSelection": "editor:write",
  "ui.addCommand": "ui:commands",
  "ui.removeCommand": "ui:commands",
  "ui.addStatusBarItem": "ui:statusbar",
  "ui.removeStatusBarItem": "ui:statusbar",
  "ui.addSidebarPanel": "ui:panel",
  "ui.removeSidebarPanel": "ui:panel",
  "ui.addSettingsTab": "ui:panel",
  "ui.removeSettingsTab": "ui:panel",
  "markdown.registerCodeBlockProcessor": "markdown:render",
  "markdown.unregisterCodeBlockProcessor": "markdown:render",
};

/** Permission needed by `api.<namespace>.<method>`, or null when none (or unknown). */
export function permissionForMethod(namespace: string, method: string): string | null {
  return METHOD_TO_PERMISSION[`${namespace}.${method}`] ?? null;
}

/** Drops // and /* *\/ comments (not the `//` of a URL) so words inside them don't count as API calls. */
function stripComments(code: string): string {
  // Blank single/double-quoted strings too, so "api.vault.read" inside a message doesn't count.
  const noStrings = code.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  return noStrings.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

/**
 * Permissions a plugin's code actually asks for. Only `api.<ns>.<method>(...)` calls count (and calls through an
 * alias such as `var ui = api.ui`), not any text that happens to read `vault.x`: an earlier looser scan granted
 * chessboard read/write access to the vault and the editor it never touches.
 */
export function inferPermissions(mainJs: string): string[] {
  const code = stripComments(mainJs);
  const found = new Set<string>();
  const add = (ns: string, method: string) => {
    const perm = permissionForMethod(ns, method);
    if (perm) found.add(perm);
  };

  let m: RegExpExecArray | null;
  const direct = /\bapi\s*\.\s*(vault|editor|ui|markdown)\s*\.\s*(\w+)/g;
  while ((m = direct.exec(code)) !== null) add(m[1], m[2]);

  // var ui = api.ui;  /  const { addCommand } = api.ui  (the second form is not tracked per method)
  const aliases = new Map<string, string>();
  const aliasRe = /\b(?:var|let|const)\s+(\w+)\s*=\s*api\s*\.\s*(vault|editor|ui|markdown)\b(?!\s*\.)/g;
  while ((m = aliasRe.exec(code)) !== null) aliases.set(m[1], m[2]);
  for (const [alias, ns] of aliases) {
    const use = new RegExp(`\\b${alias}\\s*\\.\\s*(\\w+)`, "g");
    while ((m = use.exec(code)) !== null) add(ns, m[1]);
  }
  return Array.from(found);
}
