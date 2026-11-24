// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCodeBlockProcessor,
  getRegistryVersion,
  registerCodeBlockProcessor,
  subscribeCodeBlockRegistry,
  unregisterAllCodeBlockProcessorsForPlugin,
  unregisterCodeBlockProcessor,
} from "../src/markdown-code-block-registry";

// The registry is module-level state, so every test uses its own language names and cleans up after itself.
const proc = () => vi.fn();
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  for (const p of ["p1", "p2"]) unregisterAllCodeBlockProcessorsForPlugin(p);
  vi.restoreAllMocks();
});

describe("register / get", () => {
  it("looks processors up case-insensitively and ignoring surrounding spaces", () => {
    const f = proc();
    registerCodeBlockProcessor("p1", " ChessBoard ", f);
    expect(getCodeBlockProcessor("chessboard")).toEqual({ pluginId: "p1", processor: f });
    expect(getCodeBlockProcessor("  CHESSBOARD ")?.pluginId).toBe("p1");
    expect(getCodeBlockProcessor("unknown-lang")).toBeUndefined();
  });
  it("ignores an empty language", () => {
    const v = getRegistryVersion();
    registerCodeBlockProcessor("p1", "   ", proc());
    expect(getRegistryVersion()).toBe(v);
  });
  it("lets plugins register mermaid and dataview (core plugins since 2.5; nothing is reserved any more)", () => {
    registerCodeBlockProcessor("p1", "Mermaid", proc());
    registerCodeBlockProcessor("p1", "dataview", proc());
    expect(getCodeBlockProcessor("mermaid")?.pluginId).toBe("p1");
    expect(getCodeBlockProcessor("dataview")?.pluginId).toBe("p1");
    expect(warn).not.toHaveBeenCalled();
  });
  it("lets another plugin override a language, with a warning", () => {
    const a = proc();
    const b = proc();
    registerCodeBlockProcessor("p1", "shared-lang", a);
    registerCodeBlockProcessor("p2", "shared-lang", b);
    expect(getCodeBlockProcessor("shared-lang")).toEqual({ pluginId: "p2", processor: b });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('previously registered by "p1"');
  });
  it("lets a plugin replace its own processor silently", () => {
    const b = proc();
    registerCodeBlockProcessor("p1", "own-lang", proc());
    registerCodeBlockProcessor("p1", "own-lang", b);
    expect(getCodeBlockProcessor("own-lang")?.processor).toBe(b);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("unregister", () => {
  it("removes a processor only for the plugin that owns it", () => {
    registerCodeBlockProcessor("p1", "mine", proc());
    unregisterCodeBlockProcessor("p2", "mine");
    expect(getCodeBlockProcessor("mine")).toBeDefined();
    unregisterCodeBlockProcessor("p1", "MINE");
    expect(getCodeBlockProcessor("mine")).toBeUndefined();
  });
  it("unregisterAll removes every processor of one plugin and leaves the others", () => {
    registerCodeBlockProcessor("p1", "a-lang", proc());
    registerCodeBlockProcessor("p1", "b-lang", proc());
    registerCodeBlockProcessor("p2", "c-lang", proc());
    unregisterAllCodeBlockProcessorsForPlugin("p1");
    expect(getCodeBlockProcessor("a-lang")).toBeUndefined();
    expect(getCodeBlockProcessor("b-lang")).toBeUndefined();
    expect(getCodeBlockProcessor("c-lang")?.pluginId).toBe("p2");
  });
});

describe("version and subscribers", () => {
  it("bumps the version and notifies subscribers on register and unregister", () => {
    const listener = vi.fn();
    const off = subscribeCodeBlockRegistry(listener);
    const v0 = getRegistryVersion();
    registerCodeBlockProcessor("p1", "v-lang", proc());
    expect(getRegistryVersion()).toBe(v0 + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unregisterCodeBlockProcessor("p1", "v-lang");
    expect(getRegistryVersion()).toBe(v0 + 2);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });
  it("does not bump when nothing was removed", () => {
    const v = getRegistryVersion();
    unregisterCodeBlockProcessor("p1", "never-registered");
    unregisterAllCodeBlockProcessorsForPlugin("p1");
    expect(getRegistryVersion()).toBe(v);
  });
  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    subscribeCodeBlockRegistry(listener)();
    registerCodeBlockProcessor("p1", "u-lang", proc());
    expect(listener).not.toHaveBeenCalled();
  });
});
