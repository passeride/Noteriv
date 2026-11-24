"use client";

import { useEffect, useRef } from "react";
import { mountMirror, type MirrorEvent } from "./mirror";

/**
 * Shows a plugin's sandbox-rendered panel (sanitised, CSS-scoped copy of its DOM) and
 * forwards clicks/input back to it. See lib/plugin-sandbox/mirror.ts for the model.
 */
export default function PluginMirror({
  html,
  css,
  onEvent,
}: {
  html: string;
  css: string;
  onEvent: (e: MirrorEvent) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<ReturnType<typeof mountMirror> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mirror = mountMirror(host, (e) => onEventRef.current(e));
    mirrorRef.current = mirror;
    return () => {
      mirror.dispose();
      mirrorRef.current = null;
    };
  }, []);

  useEffect(() => {
    mirrorRef.current?.update({ html, css });
  }, [html, css]);

  return <div ref={hostRef} />;
}
