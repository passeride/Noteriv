"use client";

import { useEffect, useRef } from "react";
import type { CorePluginHost } from "./core-plugin-host";
import type { ActiveCorePluginView } from "./use-core-plugin-host";

/**
 * Shows the view a core plugin opened (`workspace.openView`) over the page: the plugin mounts its own DOM into the
 * centre slot; Escape or a click on the backdrop closes it, which runs the plugin's cleanup. Views open as an overlay
 * for now (it is how the pre-plugin features looked); tabs can replace this later without changing the plugin API.
 */
export function CorePluginViewOverlay({
  host,
  view,
  onClose,
}: {
  host: CorePluginHost | null;
  view: ActiveCorePluginView | null;
  onClose: () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const factory = view && host ? host.getView(view.type) : undefined;

  useEffect(() => {
    const slotEl = slot.current;
    if (!view || !factory || !slotEl) return;
    // Each mount gets its own element, detached afterwards without touching what is inside: a plugin's React root may
    // finish unmounting a tick later (closeView called from its own click handler), and must find its nodes intact.
    const el = document.createElement("div");
    el.style.display = "contents";
    slotEl.appendChild(el);
    let cleanup: void | (() => void);
    try {
      cleanup = factory().mount(el, view.state);
    } catch (e) {
      console.error(`[core-plugin view ${view.type}] mount failed:`, e);
    }
    return () => {
      try {
        cleanup?.();
      } catch (e) {
        console.error(`[core-plugin view ${view.type}] cleanup failed:`, e);
      }
      el.remove();
    };
  }, [view, factory]);

  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, onClose]);

  if (!view || !factory) return null;
  return (
    <div
      data-core-view={view.type}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div ref={slot} onClick={(e) => e.stopPropagation()} style={{ display: "contents" }} />
    </div>
  );
}
