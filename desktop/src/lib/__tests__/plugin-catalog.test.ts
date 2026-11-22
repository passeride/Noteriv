import { afterEach, expect, it, vi } from "vitest";
import {
  fetchPluginCatalog, installCatalogPlugin, parsePluginSource, parseStoredPluginSources,
} from "../../../../packages/plugin-catalog/catalog";

const source = { repository: "owner/catalog", branch: "preview/plugins" };
const revision = "a".repeat(40);
const base = "https://raw.githubusercontent.com/owner/catalog/" + revision;
const entry = { id: "preview", name: "Preview", version: "1.0.0", dir: "plugins/preview", files: ["engine-0.txt"] };
const manifest = { id: "preview", name: "Preview", version: "1.0.0", main: "start.js" };

afterEach(() => vi.unstubAllGlobals());

function catalogFetch(values: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "https://api.github.com/repos/owner/catalog/branches/preview%2Fplugins": JSON.stringify({ commit: { sha: revision } }),
    [base + "/manifest.json"]: JSON.stringify({ plugins: [entry] }),
    [base + "/plugins/preview/manifest.json"]: JSON.stringify(manifest),
    [base + "/plugins/preview/start.js"]: "module.exports.onLoad = () => null;",
    [base + "/plugins/preview/engine-0.txt"]: "an offline engine",
    ...values,
  };
  const fetcher = vi.fn(async (url: string) => Object.hasOwn(files, url)
    ? new Response(files[url]) : new Response("", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function vault() {
  return {
    hasPlugin: vi.fn(() => false),
    createStage: vi.fn(() => true),
    write: vi.fn((_name: string, _content: string) => true),
    publish: vi.fn(() => true),
    discardStage: vi.fn(),
  };
}

it("normalizes GitHub URLs and keeps distinct branches for the same repository", () => {
  expect(parsePluginSource("https://github.com/owner/catalog.git", " preview/plugins ")).toEqual(source);
  expect(parseStoredPluginSources(JSON.stringify([source, source, { ...source, branch: "main" }]))).toHaveLength(2);
  expect(() => parsePluginSource("https://other.test/owner/catalog", "main")).toThrow();
  expect(() => parsePluginSource("owner/catalog", "../main")).toThrow();
});

it("pins catalog files to the selected branch's commit and installs the declared entry plus assets", async () => {
  const fetcher = catalogFetch();
  const [plugin] = await fetchPluginCatalog(source);
  const io = vault();
  await installCatalogPlugin(plugin, io);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "https://api.github.com/repos/owner/catalog/branches/preview%2Fplugins",
    base + "/manifest.json", base + "/plugins/preview/manifest.json", base + "/plugins/preview/start.js",
    base + "/plugins/preview/engine-0.txt",
  ]);
  expect(io.write.mock.calls.map(([name]) => name)).toEqual(["start.js", "engine-0.txt", "manifest.json"]);
  expect(io.publish).toHaveBeenCalledOnce();
  expect(io.discardStage).not.toHaveBeenCalled();
});

it("supports a repository containing one plugin at its root", async () => {
  catalogFetch({
    [base + "/manifest.json"]: JSON.stringify({ ...manifest, files: ["engine-0.txt"] }),
    [base + "/start.js"]: "module.exports.onLoad = () => null;",
    [base + "/engine-0.txt"]: "an offline engine",
  });
  const [plugin] = await fetchPluginCatalog(source);
  const io = vault();
  await installCatalogPlugin(plugin, io);
  expect(plugin.dir).toBe("");
  expect(io.write).toHaveBeenCalledWith("engine-0.txt", "an offline engine");
});

it("leaves the install destination untouched if an asset cannot be downloaded", async () => {
  catalogFetch({ [base + "/manifest.json"]: JSON.stringify({ plugins: [{ ...entry, files: ["missing.js"] }] }) });
  const [plugin] = await fetchPluginCatalog(source);
  const io = vault();
  await expect(installCatalogPlugin(plugin, io)).rejects.toThrow("HTTP 404");
  expect(io.createStage).not.toHaveBeenCalled();
  expect(io.publish).not.toHaveBeenCalled();
});

it("discards the staged files when a write fails", async () => {
  catalogFetch();
  const [plugin] = await fetchPluginCatalog(source);
  const io = vault();
  io.write.mockReturnValueOnce(true).mockReturnValueOnce(false);
  await expect(installCatalogPlugin(plugin, io)).rejects.toThrow("engine-0.txt");
  expect(io.publish).not.toHaveBeenCalled();
  expect(io.discardStage).toHaveBeenCalledOnce();
});

it("rejects path traversal in a remote catalog before attempting installation", async () => {
  catalogFetch({ [base + "/manifest.json"]: JSON.stringify({ plugins: [{ ...entry, files: ["../start.js"] }] }) });
  await expect(fetchPluginCatalog(source)).rejects.toThrow("Invalid asset names");
});
