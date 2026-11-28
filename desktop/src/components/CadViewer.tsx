"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getCodeBlockProcessor, onCodeBlockProcessorsChange } from "@/lib/markdown-code-block-registry";

const getProcessor = () => getCodeBlockProcessor("cad")?.processor;
const getServerProcessor = () => undefined;

export default function CadViewer({ path, onOpenPlugins }: {
  path: string | null;
  onOpenPlugins: () => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const processor = useSyncExternalStore(onCodeBlockProcessorsChange, getProcessor, getServerProcessor);
  const [error, setError] = useState<{ path: string; processor: typeof processor; message: string }>();

  useEffect(() => {
    const container = target.current;
    if (!container || !processor || path === null) return;
    try {
      const dispose = processor(path, container, { source: path, sourcePath: null, language: "cad", layout: "viewport" });
      return () => {
        try {
          dispose?.();
        } catch (error) {
          console.error("Could not dispose CAD preview", error);
        } finally {
          container.replaceChildren();
        }
      };
    } catch (cause) {
      container.replaceChildren();
      setError({ path, processor, message: String(cause) });
    }
  }, [path, processor]);

  return (
    <div className="cad-file-view">
      {path === null ? <p>Open this model from its vault to preview it.</p> : !processor ? (
        <div>
          <p>Install and enable CAD Viewer to open this model.</p>
          <button className="workspace-control" onClick={onOpenPlugins}>Open Plugins</button>
        </div>
      ) : <div ref={target} className="cad-file-canvas" />}
      {error?.path === path && error.processor === processor && <p role="alert">{error.message}</p>}
    </div>
  );
}
