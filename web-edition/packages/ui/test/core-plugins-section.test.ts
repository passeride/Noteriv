import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CorePluginInfo } from "@noteriv/core/plugin-registry";
import { CorePluginsSection, type HostPanel } from "../src/plugins";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(props: Parameters<typeof CorePluginsSection>[0]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(CorePluginsSection, props)));
  return host;
}

const plugin = (id: string, enabled: boolean) => ({ id, name: id, description: "", enabled, status: "ready" }) as unknown as CorePluginInfo;

describe("CorePluginsSection settings tabs", () => {
  it("shows a plugin's settings tab under its row, mounts and unmounts it", async () => {
    const cleanup = vi.fn();
    const tab: HostPanel = {
      pluginId: "daily",
      key: "daily:options",
      id: "options",
      title: "Daily notes",
      render(el) {
        el.textContent = "folder: Journal";
        return cleanup;
      },
    };
    const el = await render({ plugins: [plugin("daily", true), plugin("other", true)], onToggle: vi.fn(), settingsTabs: [tab] });

    const daily = el.querySelector('[data-core-plugin="daily"]')!;
    const other = el.querySelector('[data-core-plugin="other"]')!;
    expect(other.textContent).not.toContain("Options");
    const button = Array.from(daily.querySelectorAll("button")).find((b) => b.textContent === "Options")!;
    expect(button).toBeTruthy();

    await act(async () => button.click());
    expect(daily.querySelector('[data-settings-tab="daily:options"]')?.textContent).toContain("folder: Journal");

    await act(async () => button.click());
    expect(daily.querySelector('[data-settings-tab="daily:options"]')).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("hides the settings of a disabled plugin", async () => {
    const tab: HostPanel = { pluginId: "daily", key: "daily:options", id: "options", title: "Daily", render: () => undefined };
    const el = await render({ plugins: [plugin("daily", false)], onToggle: vi.fn(), settingsTabs: [tab] });
    expect(el.textContent).not.toContain("Options");
  });
});
