"use client";

import { useRef, useState } from "react";
import { webApi } from "@/lib/webApi";
import { planLimitNotice } from "@/components/PlanLimitNotice";
import { formatFileSize } from "@/lib/attachment-utils";
import {
  scanFolder,
  scanZip,
  scanFiles,
  intoFolder,
  runImport,
  type ImportScan,
  type ImportProgress,
  type ImportReport,
} from "@/lib/vault-import";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

interface ImportVaultProps {
  /** Existing vault to import into, or null to create a new one from the import. */
  vaultId: string | null;
  vaultName?: string;
  onClose: () => void;
  /** Called after a successful import with the vault that received the notes. */
  onFinished: (vaultId: string) => void;
  /** Folder paths of the vault, offered as the place to import into (existing vault only). */
  folders?: string[];
  /** Folder chosen up front, e.g. from the file sidebar's "Import .md files here…" ("" = vault root). */
  initialFolder?: string;
}

/** Progress phase names, read when shown. */
const PHASE_LABEL: Record<ImportProgress["phase"], () => string> = {
  attachments: () => t("web.import.phase.attachments"),
  notes: () => t("web.import.phase.notes"),
  finalize: () => t("web.import.phase.finalize"),
  done: () => t("web.import.phase.done"),
};

/**
 * Import a folder or .zip (an Obsidian/Noteriv desktop vault, a GitHub download,
 * a hand-made archive) into this vault or a brand-new one. All parsing happens in
 * the browser; see lib/vault-import.ts.
 */
export default function ImportVault({ vaultId, vaultName, onClose, onFinished, folders = [], initialFolder = "" }: ImportVaultProps) {
  useLocale();
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [scan, setScan] = useState<ImportScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<React.ReactNode>("");
  const [onConflict, setOnConflict] = useState<"skip" | "overwrite">("skip");
  const [newName, setNewName] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [targetVaultId, setTargetVaultId] = useState<string | null>(vaultId);
  const [folder, setFolder] = useState(initialFolder);

  async function onPick(files: File[], kind: "folder" | "zip" | "files") {
    setError("");
    setReport(null);
    if (files.length === 0) return;
    setScanning(true);
    try {
      const s = kind === "zip" ? await scanZip(files[0]) : kind === "files" ? scanFiles(files) : scanFolder(files);
      if (s.notes.length === 0 && s.attachments.length === 0) {
        setError(t("web.import.nothing"));
        setScan(null);
      } else {
        setScan(s);
        setNewName((n) => n || s.rootName);
      }
    } catch {
      setError(t("web.import.readFailed"));
    } finally {
      setScanning(false);
    }
  }

  async function start() {
    if (!scan) return;
    setError("");
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let target = targetVaultId;
      if (!target) {
        const name = newName.trim() || scan.rootName;
        const created = await webApi.vaults.create({ name });
        target = created.id;
        setTargetVaultId(created.id);
      }
      // A new vault has no folders yet, so the folder choice only applies to an existing one.
      const placed = vaultId ? intoFolder(scan, folder) : scan;
      const rep = await runImport(target, placed, { onConflict }, setProgress, controller.signal);
      setReport(rep);
    } catch (err) {
      setError(planLimitNotice(err) ?? t("web.import.interrupted"));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const totalBytes = scan ? [...scan.notes, ...scan.attachments].reduce((n, i) => n + i.size, 0) : 0;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}
    >
      <div
        className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-xl"
        style={{ width: 520, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: 20 }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <h2 className="text-base font-semibold">{vaultId ? t("web.import.into", { vault: vaultName ?? "vault" }) : t("web.import.newVault")}</h2>
          <button onClick={onClose} disabled={running} className="text-[var(--text-muted)]" style={{ padding: 4 }}>
            {t("common.close")}
          </button>
        </div>

        {!report && (
          <>
            <p className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 12 }}>
              {t("web.import.intro")}
            </p>
            {/* Shown before picking, so the place the notes go is clear up front. */}
            {vaultId && (
              <label className="block text-sm" style={{ marginBottom: 10 }}>
                {t("web.import.folder")}
                <select
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  disabled={running}
                  data-testid="import-folder"
                  className="w-full rounded-md bg-[var(--bg-tertiary)] outline-none text-sm"
                  style={{ padding: "6px 8px", marginTop: 4 }}
                >
                  <option value="">{t("web.import.vaultRoot")}</option>
                  {[...new Set([...folders, ...(initialFolder ? [initialFolder] : [])])]
                    .sort((a, b) => a.localeCompare(b))
                    .map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <div className="flex flex-wrap gap-2" style={{ marginBottom: 12 }}>
              <button
                className="rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm"
                style={{ padding: "8px 14px" }}
                disabled={running || scanning}
                onClick={() => filesInput.current?.click()}
              >
                {t("web.import.pickFiles")}
              </button>
              <button
                className="rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm"
                style={{ padding: "8px 14px" }}
                disabled={running || scanning}
                onClick={() => folderInput.current?.click()}
              >
                {t("web.import.pickFolder")}
              </button>
              <button
                className="rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm"
                style={{ padding: "8px 14px" }}
                disabled={running || scanning}
                onClick={() => zipInput.current?.click()}
              >
                {t("web.import.pickZip")}
              </button>
            </div>
            <input
              ref={folderInput}
              type="file"
              multiple
              hidden
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => {
                onPick(Array.from(e.target.files ?? []), "folder");
                e.target.value = "";
              }}
            />
            <input
              ref={filesInput}
              type="file"
              multiple
              hidden
              accept=".md,text/markdown,image/*,application/pdf,audio/*,video/*"
              data-testid="import-files"
              onChange={(e) => {
                onPick(Array.from(e.target.files ?? []), "files");
                e.target.value = "";
              }}
            />
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => {
                onPick(Array.from(e.target.files ?? []), "zip");
                e.target.value = "";
              }}
            />
            {scanning && <div className="text-sm text-[var(--text-muted)]">{t("web.import.scanning")}</div>}
          </>
        )}

        {scan && !report && (
          <div style={{ marginTop: 4 }}>
            <div className="rounded-lg bg-[var(--bg-tertiary)] text-sm" style={{ padding: 12, marginBottom: 12 }}>
              <div>
                {t("web.import.found", { notes: scan.notes.length, attachments: scan.attachments.length })}
                {totalBytes > 0 && <> · {formatFileSize(totalBytes)}</>}
              </div>
              {scan.skipped.length > 0 && (
                <details className="text-xs text-[var(--text-muted)]" style={{ marginTop: 6 }}>
                  <summary>{t("web.import.skipped", { count: scan.skipped.length })}</summary>
                  <ul style={{ marginLeft: 16, listStyle: "disc", maxHeight: 120, overflowY: "auto" }}>
                    {scan.skipped.slice(0, 50).map((s) => (
                      <li key={s.path}>
                        {s.path} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {!vaultId && (
              <label className="block text-sm" style={{ marginBottom: 10 }}>
                {t("web.import.newName")}
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={running || !!targetVaultId}
                  className="w-full rounded-md bg-[var(--bg-tertiary)] outline-none text-sm"
                  style={{ padding: "6px 8px", marginTop: 4 }}
                />
              </label>
            )}

            <fieldset className="text-sm" style={{ marginBottom: 12 }} disabled={running}>
              <legend className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 4 }}>
                {t("web.import.conflict")}
              </legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={onConflict === "skip"} onChange={() => setOnConflict("skip")} /> {t("web.import.keepExisting")}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={onConflict === "overwrite"} onChange={() => setOnConflict("overwrite")} /> {t("web.import.overwrite")}
              </label>
            </fieldset>

            {running && progress && (
              <div style={{ marginBottom: 12 }}>
                <div className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 4 }}>
                  {PHASE_LABEL[progress.phase]()} ({progress.done}/{progress.total})
                </div>
                <div className="rounded-full bg-[var(--bg-tertiary)]" style={{ height: 6, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                className="rounded-md text-sm font-medium"
                style={{ padding: "8px 16px", background: "var(--accent)", color: "var(--bg-primary)", opacity: running ? 0.6 : 1 }}
                disabled={running}
                onClick={start}
              >
                {running ? t("web.import.running") : t("web.import.start")}
              </button>
              {running && (
                <button
                  className="rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm"
                  style={{ padding: "8px 14px" }}
                  onClick={() => abortRef.current?.abort()}
                >
                  {t("web.import.stop")}
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm" style={{ color: "var(--red)", marginTop: 10 }}>
            {error}
          </div>
        )}

        {report && targetVaultId && (
          <div className="text-sm">
            <div className="rounded-lg bg-[var(--bg-tertiary)]" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{report.cancelled ? t("web.import.stopped") : t("web.import.done")}</div>
              <div>
                {t("web.import.reportNotes", { created: report.notesCreated, updated: report.notesUpdated, skipped: report.notesSkipped })}
              </div>
              <div>
                {t("web.import.reportAttachments", { uploaded: report.attachmentsUploaded, reused: report.attachmentsReused })}
              </div>
              {report.failures.length > 0 && (
                <details className="text-xs" style={{ marginTop: 6, color: "var(--yellow)" }}>
                  <summary>{t("web.import.failures", { count: report.failures.length })}</summary>
                  <ul style={{ marginLeft: 16, listStyle: "disc", maxHeight: 140, overflowY: "auto" }}>
                    {report.failures.slice(0, 80).map((f, i) => (
                      <li key={i}>
                        {f.path} — {f.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <button
              className="rounded-md text-sm font-medium"
              style={{ padding: "8px 16px", background: "var(--accent)", color: "var(--bg-primary)" }}
              onClick={() => onFinished(targetVaultId)}
            >
              {t("web.import.open")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
