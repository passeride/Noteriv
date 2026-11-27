export interface PluginSource {
  repository: string;
  branch: string;
}

export interface CatalogPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  dir: string;
  files: string[];
  source: PluginSource;
  revision: string;
}

export const COMMUNITY_SOURCE: PluginSource = { repository: "thejacedev/NoterivPlugins", branch: "master" };
export const PLUGIN_SOURCES_PATH = ".noteriv/plugin-sources.json";

const MAX_MAIN_BYTES = 500_000;
const MAX_ASSET_BYTES = 131_072;
const MAX_MANIFEST_BYTES = 262_144;
const MAX_PLUGIN_BYTES = 5_000_000;
const MAX_ASSETS = 64;

export function sourceKey(source: PluginSource): string {
  return source.repository.toLowerCase() + "@" + source.branch;
}

export type InstalledCatalogPlugin = Pick<CatalogPlugin, "id" | "version" | "name" | "author"> & {
  catalogSource?: PluginSource;
};

function compareVersions(a: string, b: string): number {
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(value);
  const left = parse(a), right = parse(b);
  if (!left || !right) return 0;
  for (let i = 1; i <= 3; i++) {
    const difference = BigInt(left[i]) - BigInt(right[i]);
    if (difference) return difference > 0 ? 1 : -1;
  }
  if (!left[4] || !right[4]) return Number(!left[4]) - Number(!right[4]);
  const first = left[4].split("."), second = right[4].split(".");
  for (let i = 0; i < Math.min(first.length, second.length); i++) {
    if (first[i] === second[i]) continue;
    const numericFirst = /^\d+$/.test(first[i]), numericSecond = /^\d+$/.test(second[i]);
    if (numericFirst && numericSecond) return BigInt(first[i]) > BigInt(second[i]) ? 1 : -1;
    if (numericFirst !== numericSecond) return numericFirst ? -1 : 1;
    return first[i] > second[i] ? 1 : -1;
  }
  return first.length - second.length;
}

export function isCatalogUpdate(installed: InstalledCatalogPlugin, entry: CatalogPlugin): boolean {
  if (installed.id !== entry.id || compareVersions(entry.version, installed.version) <= 0) return false;
  const source = installed.catalogSource;
  // Older installations did not save their source. Require their catalog identity to match.
  return source
    ? typeof source.repository === "string" && typeof source.branch === "string" && sourceKey(source) === sourceKey(entry.source)
    : installed.name === entry.name && installed.author === entry.author;
}

export function parsePluginSource(value: string, ref: string): PluginSource {
  let repository = value.trim().replace(/\/$/, "");
  if (/^https:\/\//i.test(repository)) {
    const match = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)$/i.exec(repository);
    repository = match?.[1] ?? "";
  }
  repository = repository.replace(/\.git$/i, "");
  const [owner, repo, extra] = repository.split("/");
  if (extra !== undefined || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(owner ?? "") ||
      !/^[a-z\d_.-]{1,100}$/i.test(repo ?? "") || repo === "." || repo === "..") {
    throw new Error("Enter a GitHub repository as owner/repo or an https://github.com repository URL.");
  }

  const branch = ref.trim();
  const parts = branch.split("/");
  if (!branch || branch.length > 255 || branch.startsWith("-") ||
      /[~^:?*[\\\s\u0000-\u001f\u007f]/.test(branch) || branch.includes("..") ||
      branch.includes("@{") || branch === "@" || branch.endsWith(".") ||
      parts.some(part => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    throw new Error("Enter a valid GitHub branch, for example main or feature/plugins.");
  }

  return { repository, branch };
}

export function parseStoredPluginSources(text: string | null): PluginSource[] {
  if (text === null) return [];
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Invalid saved plugin sources.");
  const sources = new Map<string, PluginSource>();
  for (const item of data) {
    if (!isRecord(item) || typeof item.repository !== "string" || typeof item.branch !== "string") {
      throw new Error("Invalid saved plugin source.");
    }
    const source = parsePluginSource(item.repository, item.branch);
    sources.set(sourceKey(source), source);
  }
  sources.delete(sourceKey(COMMUNITY_SOURCE));
  return [...sources.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeName(name: unknown): name is string {
  return typeof name === "string" && /^[a-z\d][a-z\d._-]{0,100}$/i.test(name) &&
    !name.endsWith(".") && !/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(name);
}

function isSafeDirectory(dir: unknown): dir is string {
  return typeof dir === "string" && dir.length <= 300 &&
    dir.split("/").every(part => part && !part.startsWith(".") && !/[\\:<>"|?*\u0000-\u001f]/.test(part));
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  let size = 0;
  for (const character of text) {
    if (character.length === 2) size += 4;
    else {
      const code = character.charCodeAt(0);
      size += code < 128 ? 1 : code < 2048 ? 2 : 3;
    }
  }
  return size;
}

async function downloadText(url: string, label: string, limit: number, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error("Unable to fetch " + label + " (HTTP " + response.status + ").");
    if (Number(response.headers.get("content-length")) > limit) throw new Error(label + " exceeds the size limit.");
    const text = await response.text();
    if (byteLength(text) > limit) throw new Error(label + " exceeds the size limit.");
    return text;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function rawUrl(source: PluginSource, sha: string, path: string): string {
  return "https://raw.githubusercontent.com/" + source.repository + "/" + sha + "/" +
    path.split("/").map(encodeURIComponent).join("/");
}

function parseCatalogEntry(value: unknown, source: PluginSource, revision: string, single: boolean): CatalogPlugin {
  if (!isRecord(value) || !isSafeName(value.id) || typeof value.name !== "string" || !value.name.trim() ||
      typeof value.version !== "string" || (!single && !isSafeDirectory(value.dir))) {
    throw new Error("The plugin catalog contains an invalid entry.");
  }
  const files = value.files ?? [];
  if (!Array.isArray(files) || files.length > MAX_ASSETS || !files.every(isSafeName) ||
      new Set(files.map(name => name.toLowerCase())).size !== files.length) {
    throw new Error("Invalid asset names in " + value.id + ".");
  }
  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === "string" ? value.description : "",
    author: typeof value.author === "string" ? value.author : "",
    version: value.version,
    dir: single ? "" : value.dir as string,
    files,
    source,
    revision,
  };
}

export async function fetchPluginCatalog(source: PluginSource, signal?: AbortSignal): Promise<CatalogPlugin[]> {
  const selected = parsePluginSource(source.repository, source.branch);
  const branchUrl = "https://api.github.com/repos/" + selected.repository + "/branches/" + encodeURIComponent(selected.branch);
  const branch = JSON.parse(await downloadText(branchUrl, "GitHub branch " + selected.branch, MAX_MANIFEST_BYTES, signal));
  const revision: unknown = branch?.commit?.sha;
  if (typeof revision !== "string" || !/^[a-f\d]{40}$/i.test(revision)) {
    throw new Error("GitHub did not return a commit for the selected branch.");
  }

  const text = await downloadText(rawUrl(selected, revision, "manifest.json"), "the root manifest.json", MAX_MANIFEST_BYTES, signal);
  const data: unknown = JSON.parse(text);
  const single = isRecord(data) && typeof data.id === "string" && !("plugins" in data);
  const values = single ? [data] : Array.isArray(data) ? data : isRecord(data) ? data.plugins : null;
  if (!Array.isArray(values) || values.length > 1_000) throw new Error("The repository has an invalid plugin catalog.");
  const entries = values.map(value => parseCatalogEntry(value, selected, revision, single));
  if (new Set(entries.map(entry => entry.id.toLowerCase())).size !== entries.length) {
    throw new Error("The plugin catalog contains duplicate IDs.");
  }
  return entries;
}

export async function downloadCatalogPlugin(entry: CatalogPlugin): Promise<Map<string, string>> {
  function download(file: string, limit: number): Promise<string> {
    const path = entry.dir ? entry.dir + "/" + file : file;
    return downloadText(rawUrl(entry.source, entry.revision, path), file, limit);
  }

  const manifest: unknown = JSON.parse(await download("manifest.json", MAX_MANIFEST_BYTES));
  if (!isRecord(manifest) || manifest.id !== entry.id ||
      typeof manifest.name !== "string" || !manifest.name.trim() || typeof manifest.version !== "string") {
    throw new Error("The plugin manifest does not match " + entry.id + ".");
  }
  const languages = manifest.codeBlockLanguages;
  if (languages !== undefined && (!Array.isArray(languages) || !languages.every(language => typeof language === "string"))) {
    throw new Error("The plugin manifest has invalid code block languages.");
  }
  const main = manifest.main ?? "main.js";
  if (!isSafeName(main) || !/\.m?js$/i.test(main)) throw new Error("The plugin must have a JavaScript entry file.");
  const names = entry.files.filter(file => !["manifest.json", main.toLowerCase()].includes(file.toLowerCase()));
  const code = await download(main, MAX_MAIN_BYTES);
  if (!code.trim()) throw new Error("The plugin entry file is empty.");

  const files = new Map<string, string>([[main, code]]);
  let total = byteLength(code);
  for (let i = 0; i < names.length; i += 4) {
    const assets = await Promise.all(names.slice(i, i + 4).map(async name => [name, await download(name, MAX_ASSET_BYTES)] as const));
    for (const [name, content] of assets) {
      total += byteLength(content);
      if (total > MAX_PLUGIN_BYTES) throw new Error("The plugin exceeds the total size limit.");
      files.set(name, content);
    }
  }
  files.set("manifest.json", JSON.stringify({
    ...manifest, main,
    catalogSource: entry.source,
    description: typeof manifest.description === "string" ? manifest.description : entry.description,
    author: typeof manifest.author === "string" ? manifest.author : entry.author,
  }, null, 2) + "\n");
  return files;
}

type InstallIO = {
  hasPlugin: () => boolean | Promise<boolean>;
  createStage: () => boolean | Promise<boolean>;
  write: (name: string, content: string) => boolean | Promise<boolean>;
  publish: () => boolean | Promise<boolean>;
  discardStage: () => unknown | Promise<unknown>;
};

export async function installCatalogPlugin(entry: CatalogPlugin, io: InstallIO, updating = false): Promise<void> {
  async function checkInstalled() {
    if (await io.hasPlugin() !== updating) {
      throw new Error(updating ? "The installed plugin was removed." : "A plugin with this ID is already installed.");
    }
  }
  await checkInstalled();
  const files = await downloadCatalogPlugin(entry);
  if (updating && JSON.parse(files.get("manifest.json")!).version !== entry.version) {
    throw new Error("The plugin version does not match its catalog entry.");
  }
  if (!await io.createStage()) throw new Error("Unable to prepare the plugin folder.");
  let installed = false;
  try {
    for (const [name, content] of files) {
      if (!await io.write(name, content)) throw new Error("Unable to save " + name + ".");
    }
    await checkInstalled();
    if (!await io.publish()) throw new Error(updating ? "Unable to update the plugin." : "Unable to install the plugin.");
    installed = true;
  } finally {
    if (!installed) await io.discardStage();
  }
}
