"use client";

import { useEffect, useRef } from "react";
import type { HostPanel } from "./core-plugin-host";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";

/**
 * Sidebar panels of core plugins (`ui.addSidebarPanel`), shown as columns on the right of the editor next to
 * Outline / Backlinks. `open` lists the namespaced keys the user (ribbon button) or the plugin (`ui.toggleSidebarPanel`)
 * opened; a panel whose plugin was turned off simply disappears with its contribution.
 */
export function CorePluginSidePanels({
  panels,
  open,
  onClose,
  closeLabel,
}: {
  panels: HostPanel[];
  open: string[];
  onClose: (key: string) => void;
  closeLabel?: string;
}) {
  useLocale();
  const shown = open.map((k) => panels.find((p) => p.key === k)).filter((p): p is HostPanel => !!p);
  return (
    <>
      {shown.map((p) => (
        <aside key={p.key} className="core-panel" data-core-panel={p.key}>
          <div className="core-panel-header">
            <span className="core-panel-title">{p.title}</span>
            <button className="core-panel-close" title={closeLabel ?? t("common.close")} aria-label={closeLabel ?? t("common.close")} onClick={() => onClose(p.key)}>
              ×
            </button>
          </div>
          <PanelBody panel={p} />
        </aside>
      ))}
    </>
  );
}

/**
 * Mounts the plugin's own DOM (side panels, settings tabs); like CorePluginViewOverlay, each render gets its own
 * element, detached afterwards.
 */
export function PanelBody({ panel }: { panel: HostPanel }) {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const slotEl = slot.current;
    if (!slotEl) return;
    const el = document.createElement("div");
    el.className = "core-panel-mount";
    slotEl.appendChild(el);
    let cleanup: void | (() => void);
    try {
      cleanup = panel.render(el);
    } catch (e) {
      console.error(`[core-plugin panel ${panel.key}] render failed:`, e);
    }
    return () => {
      try {
        cleanup?.();
      } catch (e) {
        console.error(`[core-plugin panel ${panel.key}] cleanup failed:`, e);
      }
      el.remove();
    };
  }, [panel]);
  return <div ref={slot} className="core-panel-body" />;
}
