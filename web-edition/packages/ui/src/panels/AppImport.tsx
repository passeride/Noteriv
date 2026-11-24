"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/react";
import { importEnex } from "../importers/enex";
import { importHtml } from "../importers/html-folder";
import { ImportLimitError, readPicked } from "../importers/input";
import { importNotion } from "../importers/notion";
import { safeName, type ImportOptions, type ImportResult, type InputFile } from "../importers/types";

export type ImportSource = "notion" | "evernote" | "html";

export interface AppImportReport {
  /** Notes and attachments written. */
  written: number;
  /** Items not written because something was already at their path (left as it was). */
  kept: number;
  failed: { path: string; error: string }[];
  /** True when the person stopped the import: what was written before stays. */
  cancelled?: boolean;
}

export interface AppImportProps {
  /** Writes the converted notes and attachments into the vault, reporting progress; stops between items once `signal` aborts. */
  write(result: ImportResult, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<AppImportReport>;
  /** Vault paths already taken: imported notes get other names (`Note 2.md`) instead of being skipped. */
  existingPaths?(): Promise<string[]>;
  onClose(): void;
  /** Opens a note once the import is done. */
  onOpen?(path: string): void;
}

const CONVERT: Record<ImportSource, (files: InputFile[], folder: string, options?: ImportOptions) => Promise<ImportResult>> = {
  notion: importNotion,
  evernote: importEnex,
  html: importHtml,
};

const DEFAULT_FOLDER: Record<ImportSource, string> = { notion: "Notion", evernote: "Evernote", html: "HTML" };

type Step =
  | { kind: "pick" }
  | { kind: "reading" }
  // Only counts are kept from the preview: the converted files are made again when importing, not held twice.
  | { kind: "ready"; files: InputFile[]; notes: number; attachments: number; skipped: ImportResult["skipped"] }
  | { kind: "importing"; done: number; total: number }
  | { kind: "done"; report: AppImportReport; first: string | null };

/**
 * Import from another app (Notion's export zip, Evernote .enex files, a folder or zip of HTML pages) into a folder of
 * the vault. Everything is read and converted on the device; the app's `write` puts the result in the vault.
 */
export default function AppImport({ write, existingPaths, onClose, onOpen }: AppImportProps) {
  const t = useT();
  const [source, setSource] = useState<ImportSource>("notion");
  const [folder, setFolder] = useState(DEFAULT_FOLDER.notion);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const busy = step.kind === "reading" || step.kind === "importing";
  const dialog = useRef<HTMLDivElement>(null);
  // The running read or import; Cancel aborts it. Closing the dialog aborts it too.
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  const limitMessage = (e: ImportLimitError) =>
    e.limit === "files"
      ? t("panels.appImport.tooManyFiles", { max: e.max.toLocaleString() })
      : t("panels.appImport.tooLarge", { max: `${Math.round(e.max / 1024 ** 3)} GB` });

  // Focus starts in the dialog; Escape closes it unless an import is running.
  useEffect(() => {
    dialog.current?.querySelector<HTMLInputElement>("input[type=radio]:checked")?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  const choose = (next: ImportSource) => {
    setSource(next);
    setFolder((f) => (f === DEFAULT_FOLDER[source] || !f.trim() ? DEFAULT_FOLDER[next] : f));
    setStep({ kind: "pick" });
    setError("");
  };

  async function picked(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setError("");
    setStep({ kind: "reading" });
    const controller = new AbortController();
    running.current = controller;
    try {
      const inputs = await readPicked(files, { signal: controller.signal });
      const preview = await CONVERT[source](inputs, safeName(folder.trim() || DEFAULT_FOLDER[source]));
      // Cancelled while converting: the dialog is back at the start, the result is dropped.
      if (controller.signal.aborted) return;
      if (preview.notes.length === 0) {
        setError(t("panels.appImport.nothing"));
        setStep({ kind: "pick" });
        return;
      }
      setStep({ kind: "ready", files: inputs, notes: preview.notes.length, attachments: preview.attachments.length, skipped: preview.skipped });
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof ImportLimitError ? limitMessage(e) : t("panels.appImport.readFailed"));
      setStep({ kind: "pick" });
    } finally {
      if (running.current === controller) running.current = null;
    }
  }

  function cancel() {
    running.current?.abort();
    // A read just stops; an import ends when `write` returns, with what it wrote so far.
    if (step.kind === "reading") setStep({ kind: "pick" });
  }

  async function start() {
    if (step.kind !== "ready") return;
    const target = safeName(folder.trim() || DEFAULT_FOLDER[source]);
    const ready = step;
    setStep({ kind: "importing", done: 0, total: 1 });
    const controller = new AbortController();
    running.current = controller;
    try {
      // Converted again: links and paths depend on the folder (which may have changed) and on what the vault holds.
      const taken = (await existingPaths?.().catch(() => [])) ?? [];
      const result = await CONVERT[source](ready.files, target, { taken });
      const report = await write(result, (done, total) => setStep({ kind: "importing", done, total }), controller.signal);
      // After a cancel the first note may not have been written: no Open button then.
      const first = report.cancelled ? null : result.notes.find((n) => !report.failed.some((f) => f.path === n.path))?.path ?? null;
      setStep({ kind: "done", report, first });
    } catch {
      setError(t("panels.appImport.writeFailed"));
      setStep(ready);
    } finally {
      if (running.current === controller) running.current = null;
    }
  }

  const accept = source === "notion" ? ".zip,application/zip" : source === "evernote" ? ".enex" : ".zip,.html,.htm,.md";

  return (
    <div className="aimp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={dialog} className="aimp-dialog" role="dialog" aria-modal="true" aria-labelledby="aimp-title">
        <div className="aimp-head">
          <h2 id="aimp-title">{t("panels.appImport.title")}</h2>
          <button type="button" className="aimp-close" onClick={onClose} disabled={busy} aria-label={t("panels.appImport.close")}>
            ×
          </button>
        </div>

        {step.kind !== "done" && (
          <>
            <fieldset className="aimp-sources" disabled={busy}>
              <legend>{t("panels.appImport.source")}</legend>
              {(["notion", "evernote", "html"] as const).map((s) => (
                <label key={s} className={`aimp-source ${source === s ? "active" : ""}`}>
                  <input type="radio" name="aimp-source" checked={source === s} onChange={() => choose(s)} />
                  <span className="aimp-source-name">{t(`panels.appImport.sources.${s}.name`)}</span>
                  <span className="aimp-hint">{t(`panels.appImport.sources.${s}.hint`)}</span>
                </label>
              ))}
            </fieldset>

            <div className="aimp-pick">
              <button type="button" className="aimp-btn" disabled={busy} onClick={() => fileInput.current?.click()}>
                {t(source === "evernote" ? "panels.appImport.pickEnex" : "panels.appImport.pickZip")}
              </button>
              {source === "html" && (
                <button type="button" className="aimp-btn" disabled={busy} onClick={() => folderInput.current?.click()}>
                  {t("panels.appImport.pickFolder")}
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                hidden
                accept={accept}
                multiple={source !== "notion"}
                data-testid="aimp-file"
                onChange={(e) => {
                  void picked(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={folderInput}
                type="file"
                hidden
                // @ts-expect-error -- a folder picker (Chromium, WebView2), not in React's types
                webkitdirectory=""
                onChange={(e) => {
                  void picked(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {step.kind === "reading" && (
              <div className="aimp-status">
                {t("panels.appImport.reading")}
                <button type="button" className="aimp-btn" onClick={cancel}>
                  {t("panels.appImport.cancel")}
                </button>
              </div>
            )}

            {(step.kind === "ready" || step.kind === "importing") && (
              <>
                <div className="aimp-summary">
                  {step.kind === "ready" && (
                    <>
                      <div>{t("panels.appImport.found", { notes: step.notes, files: step.attachments })}</div>
                      {step.skipped.length > 0 && (
                        <details>
                          <summary>{t("panels.appImport.skipped", { count: step.skipped.length })}</summary>
                          <ul>
                            {step.skipped.slice(0, 50).map((s, i) => (
                              <li key={`${i}:${s.path}`}>
                                {s.path} — {t(`panels.appImport.reasons.${s.reason}`)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                  {step.kind === "importing" && (
                    <div className="aimp-progress" role="progressbar" aria-label={t("panels.appImport.import")} aria-valuemin={0} aria-valuemax={step.total} aria-valuenow={step.done}>
                      <div style={{ width: `${Math.round((100 * step.done) / Math.max(1, step.total))}%` }} />
                    </div>
                  )}
                </div>
                <label className="aimp-folder">
                  {t("panels.appImport.folder")}
                  <input type="text" value={folder} disabled={busy} onChange={(e) => setFolder(e.target.value)} />
                  <small>{t("panels.appImport.folderHint")}</small>
                </label>
                <div className="aimp-actions">
                  <button type="button" className="aimp-btn aimp-primary" disabled={busy || step.kind !== "ready"} onClick={() => void start()}>
                    {step.kind === "importing" ? t("panels.appImport.importing", { done: step.done, total: step.total }) : t("panels.appImport.import")}
                  </button>
                  {step.kind === "importing" && (
                    <button type="button" className="aimp-btn" onClick={cancel}>
                      {t("panels.appImport.cancel")}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {step.kind === "done" && (
          <div className="aimp-summary">
            <div>{t(step.report.cancelled ? "panels.appImport.stopped" : "panels.appImport.done", { count: step.report.written })}</div>
            {step.report.kept > 0 && <div>{t("panels.appImport.kept", { count: step.report.kept })}</div>}
            {step.report.failed.length > 0 && (
              <details open>
                <summary>{t("panels.appImport.failed", { count: step.report.failed.length })}</summary>
                <ul>
                  {step.report.failed.slice(0, 50).map((f, i) => (
                    <li key={`${i}:${f.path}`}>
                      {f.path} — {f.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="aimp-actions">
              {step.first && onOpen && (
                <button
                  type="button"
                  className="aimp-btn aimp-primary"
                  onClick={() => {
                    onOpen(step.first!);
                    onClose();
                  }}
                >
                  {t("panels.appImport.open")}
                </button>
              )}
              <button type="button" className="aimp-btn" onClick={onClose}>
                {t("panels.appImport.close")}
              </button>
            </div>
          </div>
        )}

        {error && <div className="aimp-error">{error}</div>}
      </div>
    </div>
  );
}
