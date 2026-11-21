import { afterEach, expect, it, vi } from "vitest";
import { PluginManager } from "../plugin-api";

afterEach(() => vi.unstubAllGlobals());

it("loads one instance, emits relative file events and unloads its handlers", async () => {
  const root = "/vault";
  const dir = `${root}/.noteriv/plugins/sample`;
  const files = new Map([
    [`${root}/.noteriv/plugin-config.json`, JSON.stringify({ enabled: ["sample"] })],
    [`${dir}/manifest.json`, JSON.stringify({ id: "sample", main: "main.js" })],
    [`${dir}/main.js`, `
      module.exports.onLoad = api => {
        api.ui.showNotice('loaded');
        api.events.on('file-save', path => api.ui.showNotice(path));
        api.ui.addCommand({ id: 'info', name: 'Live path', callback: () => api.ui.showNotice(api.app.currentFile) });
      };
    `],
  ]);
  vi.stubGlobal("window", {
    electronAPI: {
      readDir: async () => [{ isDirectory: true, name: "sample" }],
      readFile: async (path: string) => files.get(path) ?? null,
    },
  });
  const editor = {
    content: "",
    currentFile: "/vault/first.md",
    insertAtCursor: vi.fn(),
    getSelection: () => "",
    replaceSelection: vi.fn(),
    getCursorPosition: () => ({ line: 1, ch: 0 }),
    setContent: vi.fn(),
  };
  const manager = new PluginManager(root, () => editor);
  const notice = vi.fn();
  manager.setNoticeHandler(notice);
  await manager.loadAllEnabled();
  await manager.loadAllEnabled();
  expect(notice.mock.calls.map(call => call[0])).toEqual(["loaded"]);
  editor.currentFile = "/vault/notes/second.md";
  await manager.getCommands()[0].callback();
  manager.emitFile("file-save", editor.currentFile);
  manager.emitFile("file-save", "/another-vault/third.md");
  expect(notice.mock.calls.map(call => call[0])).toEqual(["loaded", "notes/second.md", "notes/second.md"]);
  await manager.unloadAll();
  manager.emitFile("file-save", editor.currentFile);
  expect(manager.getCommands()).toEqual([]);
  expect(notice).toHaveBeenCalledTimes(3);
});
