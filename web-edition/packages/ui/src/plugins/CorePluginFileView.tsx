"use client";

import { useEffect, useRef } from "react";
import type { FileViewInstance } from "@noteriv/plugin-api";
import type { HostFileView } from "./core-plugin-host";

/** The first file view (registration order) that shows this file, from `useCorePlugins(...).contributions.fileViews`. */
export function matchFileView(views: HostFileView[], path: string, content: string): HostFileView | undefined {
  return views.find((v) => v.match({ path, content }));
}

/**
 * One plugin file view (`ui.registerFileView`) in place of the editor, for one tab in one pane. The plugin mounts its
 * own DOM into an element of its own (as in CorePluginViewOverlay). Its `setContent` goes to `onChange`, the pane's
 * usual content handler; later `content` changes reach the plugin through `update`, except the echo of what the view
 * itself just wrote. Give it a `key` per tab so another file gets a fresh instance.
 */
export function CorePluginFileView({
  view,
  path,
  content,
  onChange,
}: {
  view: HostFileView;
  path: string;
  content: string;
  onChange: (content: string) => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const instance = useRef<FileViewInstance | void>(undefined);
  /** The content the view has: what it was mounted with, last told about, or last wrote itself. */
  const known = useRef(content);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const slotEl = slot.current;
    if (!slotEl) return;
    const el = document.createElement("div");
    el.style.height = "100%";
    slotEl.appendChild(el);
    known.current = content;
    try {
      instance.current = view.mount(el, {
        path,
        content,
        setContent: (next) => {
          known.current = next;
          onChangeRef.current(next);
        },
      });
    } catch (e) {
      console.error(`[core-plugin file view ${view.key}] mount failed:`, e);
    }
    return () => {
      try {
        instance.current?.destroy?.();
      } catch (e) {
        console.error(`[core-plugin file view ${view.key}] destroy failed:`, e);
      }
      instance.current = undefined;
      el.remove();
    };
    // Mounted once per view and file; content changes go through update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, path]);

  useEffect(() => {
    if (content === known.current) return;
    known.current = content;
    try {
      instance.current?.update?.(content);
    } catch (e) {
      console.error(`[core-plugin file view ${view.key}] update failed:`, e);
    }
  }, [content, view]);

  return <div ref={slot} data-core-file-view={view.key} style={{ height: "100%", overflow: "auto" }} />;
}
