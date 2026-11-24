"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { CorePluginInfo } from "@noteriv/core/plugin-registry";
import type { CorePluginContributions, CorePluginHost, HostCommand } from "./core-plugin-host";
import { isMacPlatform, matchesHotkey } from "./hotkey";

const NO_PLUGINS: CorePluginInfo[] = [];
const NO_CONTRIBUTIONS: CorePluginContributions = {
  commands: [],
  statusItems: [],
  ribbonIcons: [],
  noteToolbarButtons: [],
  fileViews: [],
  attachmentViewers: [],
  sidebarPanels: [],
  settingsTabs: [],
  viewTypes: [],
};
const noop = () => () => {};

/** React view of a core-plugin host. `host` may be null while the vault is still loading. */
export function useCorePlugins(host: CorePluginHost | null) {
  const plugins = useSyncExternalStore(
    host ? (l) => host.registry.subscribe(l) : noop,
    () => (host ? host.registry.list() : NO_PLUGINS),
    () => NO_PLUGINS
  );
  const contributions = useSyncExternalStore(
    host ? (l) => host.subscribeContributions(l) : noop,
    () => (host ? host.getContributions() : NO_CONTRIBUTIONS),
    () => NO_CONTRIBUTIONS
  );
  const setEnabled = useCallback(
    (id: string, enabled: boolean) => (host ? host.registry.setEnabled(id, enabled) : Promise.resolve()),
    [host]
  );
  return { plugins, contributions, setEnabled };
}

/**
 * Runs plugin commands from their `hotkey`. App shortcuts win: a key an app listener handled (called
 * `preventDefault` or stopped the event) is left alone, so a plugin cannot take over Ctrl+S and the like whatever order
 * the listeners were added in. The editor's own keymap does not count as the app: CodeMirror binds Mod-g (find next)
 * and Mod-d (select next occurrence), which the app's Ctrl+G / Ctrl+D always overrode before these became plugins.
 *
 * How: the capture listener on `window` runs first. On a match it prevents the default right away (the browser's action,
 * e.g. Ctrl+D's bookmark dialog, and CodeMirror, which ignores prevented events) and watches whether anything calls
 * `preventDefault` again; then it appends a one-shot bubble listener to `window`, the last stop of the bubble phase,
 * after the app's own listeners, which runs the command unless an app listener claimed the key.
 */
export function useCorePluginHotkeys(commands: HostCommand[]) {
  const ref = useRef(commands);
  ref.current = commands;
  useEffect(() => {
    const mac = isMacPlatform();
    const onCapture = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const cmd = ref.current.find((c) => c.hotkey && matchesHotkey(e, c.hotkey, mac));
      if (!cmd) return;
      e.preventDefault();
      let appHandled = false;
      const prevent = e.preventDefault.bind(e);
      e.preventDefault = () => {
        appHandled = true;
        prevent();
      };
      const afterApp = (ev: KeyboardEvent) => {
        window.removeEventListener("keydown", afterApp);
        if (ev !== e || appHandled) return;
        cmd.run();
      };
      window.addEventListener("keydown", afterApp);
      // If the app stopped propagation the listener never ran: drop it before the next key.
      setTimeout(() => window.removeEventListener("keydown", afterApp), 0);
    };
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  }, []);
}
