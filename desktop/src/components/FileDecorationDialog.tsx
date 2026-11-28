"use client";

import { useEffect, useRef, useState } from "react";
import type { FileDecoration } from "@/lib/file-decorations";

export default function FileDecorationDialog({ name, initial, onSave, onClose }: {
  name: string;
  initial: FileDecoration;
  onSave: (decoration: FileDecoration) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [symbol, setSymbol] = useState(initial.symbol ?? "");
  const [color, setColor] = useState(initial.color ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave({ symbol: symbol.trim() || undefined, color: color || undefined });
      onClose();
    } catch (cause) {
      setError(String(cause));
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="file-decoration-dialog" aria-labelledby="file-decoration-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h2 id="file-decoration-title">Icon and color</h2>
        <p>{name}</p>
        <label>Icon or emoji <input value={symbol} maxLength={24} onChange={(event) => setSymbol(event.target.value)} /></label>
        <label><input type="checkbox" checked={!!color}
          onChange={(event) => setColor(event.target.checked ? "#6278b5" : "")} /> Show color ring</label>
        <label>Ring color <input type="color" value={color || "#6278b5"} disabled={!color}
          onChange={(event) => setColor(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="file-decoration-actions">
          <button type="button" className="workspace-control" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="workspace-control" disabled={busy}>Save</button>
        </div>
      </form>
    </dialog>
  );
}
