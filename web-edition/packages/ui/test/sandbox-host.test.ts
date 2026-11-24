import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryVaultAdapter } from "@noteriv/core/memory-vault-adapter";
import { getCodeBlockProcessor } from "@noteriv/core/markdown-code-block-registry";
import { useSandboxPluginHost, type SandboxPluginHost, type SandboxPluginRecord } from "../src/plugins/sandbox";

// jsdom does not run the iframe's page, so the test plays the plugin side: it posts the sandbox's messages with the
// iframe's contentWindow as `source`, and records what the host posts back.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let el: HTMLElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  el?.remove();
  root = null;
});

const editor = {
  getContent: () => "doc",
  setContent: vi.fn(),
  insertAtCursor: vi.fn(),
  getSelection: () => "",
  replaceSelection: vi.fn(),
};

function record(over: Partial<SandboxPluginRecord> = {}): SandboxPluginRecord {
  return { id: "row1", pluginId: "demo", enabled: true, permissions: [], mainJs: "/* plugin */", settings: { a: 1 }, ...over };
}

async function mount(installed: SandboxPluginRecord[], adapter = new MemoryVaultAdapter({ "a.md": "A" })) {
  const saveSettings = vi.fn(async () => undefined);
  const onVaultMutated = vi.fn();
  let host!: SandboxPluginHost;
  function Harness({ list }: { list: SandboxPluginRecord[] }) {
    host = useSandboxPluginHost({
      sandboxUrl: "/plugin-sandbox.html",
      platform: "desktop",
      appVersion: "test",
      installed: list,
      adapter,
      editor,
      onVaultMutated,
      saveSettings,
    });
    return createElement("div", { ref: host.containerRef });
  }
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => root!.render(createElement(Harness, { list: installed })));
  const rerender = (list: SandboxPluginRecord[]) => act(async () => root!.render(createElement(Harness, { list })));
  return { host: () => host, saveSettings, onVaultMutated, rerender, adapter };
}

/** Boot the plugin frame and return a helper that performs RPC calls as that plugin. */
async function boot(container: HTMLElement) {
  const iframes = container.querySelectorAll("iframe");
  expect(iframes.length).toBe(1);
  const iframe = iframes[0];
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  const win = iframe.contentWindow!;
  const posted: any[] = [];
  win.postMessage = ((msg: unknown) => void posted.push(msg)) as typeof win.postMessage;
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "noteriv:ready" }, source: win }));
  });
  let n = 0;
  const call = async (method: string, ...args: unknown[]) => {
    const callId = `t${++n}`;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "noteriv:call", callId, method, args }, source: win }));
      await new Promise((r) => setTimeout(r, 0));
    });
    const reply = posted.find((m) => m.type === "noteriv:response" && m.callId === callId);
    return reply as { ok: boolean; result?: unknown; error?: string };
  };
  return { win, posted, call, iframe };
}

describe("sandbox plugin host", () => {
  it("boots an enabled plugin with its code, platform and version", async () => {
    await mount([record()]);
    const { posted } = await boot(el!);
    expect(posted.find((m) => m.type === "noteriv:boot")).toMatchObject({ mainJs: "/* plugin */", platform: "desktop", version: "test" });
  });

  it("does not mount disabled plugins", async () => {
    await mount([record({ enabled: false })]);
    expect(el!.querySelectorAll("iframe").length).toBe(0);
  });

  it("refuses calls without the permission and records the denial", async () => {
    const { host } = await mount([record()]);
    const { call } = await boot(el!);
    const r = await call("vault.read", "a.md");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lacks permission "vault:read"/);
    expect(host().deniedPermissions).toEqual({ row1: ["vault:read"] });
    expect((await call("no.such", 1)).error).toMatch(/unknown method/);
  });

  it("serves the vault by path through the VaultAdapter when granted", async () => {
    const { onVaultMutated, adapter } = await mount([record({ permissions: ["vault:read", "vault:write"] })]);
    const { call } = await boot(el!);
    expect((await call("vault.read", "a.md")).result).toBe("A");
    expect((await call("vault.write", "b.md", "B")).ok).toBe(true);
    expect(onVaultMutated).toHaveBeenCalledOnce();
    expect((await call("vault.list")).result).toEqual([
      { path: "a.md", name: "a.md", isDir: false },
      { path: "b.md", name: "b.md", isDir: false },
    ]);
    const b = (await adapter.listNotes()).find((x) => x.path === "b.md")!;
    expect(await adapter.readNote(b.id)).toBe("B");
  });

  it("registers commands and code blocks, and removes them when the plugin is disabled", async () => {
    const { host, rerender } = await mount([record({ permissions: ["ui:commands", "markdown:render"] })]);
    const { call } = await boot(el!);
    await call("ui.addCommand", { id: "go", name: "Go" });
    await call("markdown.registerCodeBlockProcessor", "demo-board");
    expect(host().commands.map((c) => c.id)).toEqual(["go"]);
    expect(getCodeBlockProcessor("demo-board")?.pluginId).toBe("demo");

    await rerender([record({ enabled: false, permissions: ["ui:commands", "markdown:render"] })]);
    expect(host().commands).toEqual([]);
    expect(getCodeBlockProcessor("demo-board")).toBeUndefined();
    expect(el!.querySelectorAll("iframe").length).toBe(0);
  });

  it("remounts the frame when the grant changes", async () => {
    const { rerender } = await mount([record()]);
    const first = (await boot(el!)).iframe;
    await rerender([record({ permissions: ["vault:read"] })]);
    const frames = el!.querySelectorAll("iframe");
    expect(frames.length).toBe(1);
    expect(frames[0]).not.toBe(first);
  });

  it("does not create a second frame when the list changes while the first is still booting", async () => {
    const { rerender } = await mount([record()]);
    await rerender([record(), record({ id: "row2", pluginId: "other", enabled: false })]);
    expect(el!.querySelectorAll("iframe").length).toBe(1);
  });

  it("loads settings from the record and saves through the app", async () => {
    const { saveSettings } = await mount([record()]);
    const { call } = await boot(el!);
    expect((await call("app.loadSettings")).result).toEqual({ a: 1 });
    expect((await call("app.saveSettings", { a: 2 })).ok).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith("row1", { a: 2 });
    expect((await call("app.saveSettings", "nope")).ok).toBe(false);
  });
});
