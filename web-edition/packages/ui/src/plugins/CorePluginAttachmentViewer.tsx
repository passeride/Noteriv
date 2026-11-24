"use client";

import { useEffect, useRef } from "react";
import type { HostAttachmentViewer } from "./core-plugin-host";

/** The first attachment viewer (registration order) for this attachment, from `contributions.attachmentViewers`. */
export function matchAttachmentViewer(
  viewers: HostAttachmentViewer[],
  file: { target: string; name: string }
): HostAttachmentViewer | undefined {
  return viewers.find((v) => v.match(file));
}

/**
 * One plugin attachment viewer (`ui.registerAttachmentViewer`), filling its parent: a desktop tab, or the overlay the
 * web app puts over the page. The plugin mounts into an element of its own; it is mounted again for another target.
 */
export function CorePluginAttachmentViewer({
  viewer,
  target,
  name,
  onClose,
}: {
  viewer: HostAttachmentViewer;
  target: string;
  name: string;
  onClose: () => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const slotEl = slot.current;
    if (!slotEl) return;
    const el = document.createElement("div");
    el.style.height = "100%";
    slotEl.appendChild(el);
    let cleanup: void | (() => void);
    try {
      cleanup = viewer.mount(el, { target, name, close: () => onCloseRef.current() });
    } catch (e) {
      console.error(`[core-plugin attachment viewer ${viewer.key}] mount failed:`, e);
    }
    return () => {
      try {
        cleanup?.();
      } catch (e) {
        console.error(`[core-plugin attachment viewer ${viewer.key}] cleanup failed:`, e);
      }
      el.remove();
    };
  }, [viewer, target, name]);

  return <div ref={slot} data-core-attachment-viewer={viewer.key} style={{ height: "100%", width: "100%", position: "relative" }} />;
}
