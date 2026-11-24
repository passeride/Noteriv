import type { PluginApi } from "@noteriv/plugin-api";

/**
 * `<base><ext>`, else `<base> 2<ext>`, `<base> 3<ext>`… at the vault root: the first path no file uses yet. `exists`
 * also sees non-markdown files on desktop (`.canvas`, `.drawing`).
 */
export async function freePath(api: PluginApi, base: string, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const path = n === 1 ? `${base}${ext}` : `${base} ${n}${ext}`;
    if (!(await api.vault.exists(path))) return path;
  }
}

/**
 * Creates a document of a kind that is a file of its own on desktop (`Board.canvas`: plain data) and a marked note on
 * web (`Board.md` with `<marker>: true` frontmatter before the data), then opens it.
 */
export async function createKindFile(
  api: PluginApi,
  opts: { base: string; desktopExt: string; marker: string; body: string }
): Promise<string> {
  const desktop = api.app.platform === "desktop";
  const path = await freePath(api, opts.base, desktop ? opts.desktopExt : ".md");
  const content = desktop ? opts.body : `---\n${opts.marker}: true\n---\n${opts.body}`;
  await api.vault.write(path, content);
  await api.workspace.openFile(path);
  return path;
}
