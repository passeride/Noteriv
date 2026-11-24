"use client";

import { useEffect, useMemo, useState } from "react";
import { parseConflictCopy } from "@noteriv/core/conflict-copy";
import { diffStrings } from "@noteriv/core/note-diff";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";

export interface ConflictLabels {
  /** "{original}" and "{stamp}" are replaced. */
  banner: string;
  compare: string;
  hideCompare: string;
  keepOriginal: string;
  useThisVersion: string;
  keepBoth: string;
  originalMissing: string;
  legendOriginal: string;
  legendThis: string;
  identical: string;
  working: string;
}

const defaultLabels = (): ConflictLabels => ({
  banner: t("panels.conflict.banner"),
  compare: t("panels.conflict.compare"),
  hideCompare: t("panels.conflict.hideCompare"),
  keepOriginal: t("panels.conflict.keepOriginal"),
  useThisVersion: t("panels.conflict.useThisVersion"),
  keepBoth: t("panels.conflict.keepBoth"),
  originalMissing: t("panels.conflict.originalMissing"),
  legendOriginal: t("panels.conflict.legendOriginal"),
  legendThis: t("panels.conflict.legendThis"),
  identical: t("panels.conflict.identical"),
  working: t("panels.conflict.working"),
});

export interface ConflictBannerProps {
  /** Path and current content of the open note (shown only when it is a conflict copy). */
  path: string;
  content: string;
  /** Current content of the original note, or null if it doesn't exist. */
  loadOriginal: (originalPath: string) => Promise<string | null>;
  /** Delete this copy. */
  onKeepOriginal: () => void | Promise<void>;
  /** Write this copy's content into the original note, then delete this copy. */
  onUseThisVersion: (originalPath: string) => void | Promise<void>;
  labels?: Partial<ConflictLabels>;
}

/**
 * Shown above the editor of a sync conflict copy: explains what it is, compares it with the original line by line,
 * and resolves the conflict in one click. Renders nothing for an ordinary note.
 */
export default function ConflictBanner({ path, content, loadOriginal, onKeepOriginal, onUseThisVersion, labels }: ConflictBannerProps) {
  useLocale();
  const text = { ...defaultLabels(), ...labels };
  const info = useMemo(() => parseConflictCopy(path), [path]);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [original, setOriginal] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOpen(false);
    setDismissed(false);
    setOriginal(undefined);
  }, [path]);

  useEffect(() => {
    if (!info) return;
    let cancelled = false;
    loadOriginal(info.originalPath)
      .then((c) => !cancelled && setOriginal(c))
      .catch(() => !cancelled && setOriginal(null));
    return () => {
      cancelled = true;
    };
  }, [info, loadOriginal]);

  const diff = useMemo(() => (open && typeof original === "string" ? diffStrings(original, content) : null), [open, original, content]);

  if (!info || dismissed) return null;

  const run = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const box: React.CSSProperties = {
    margin: "8px 12px",
    padding: "8px 10px",
    border: "1px solid var(--yellow, #e5c07b)",
    borderRadius: 6,
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    fontSize: 13,
  };
  const btn: React.CSSProperties = {
    padding: "3px 8px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-tertiary)",
    color: "var(--text-primary)",
    cursor: busy ? "default" : "pointer",
    fontSize: 12,
  };

  if (original === null) {
    return (
      <div style={box} data-testid="conflict-banner">
        {text.originalMissing}
      </div>
    );
  }

  return (
    <div style={box} data-testid="conflict-banner">
      <div>{text.banner.replace("{original}", info.originalPath).replace("{stamp}", info.stamp)}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        <button type="button" style={btn} disabled={busy || original === undefined} onClick={() => setOpen((v) => !v)}>
          {open ? text.hideCompare : text.compare}
        </button>
        <button type="button" style={btn} disabled={busy} onClick={() => run(onKeepOriginal)}>
          {text.keepOriginal}
        </button>
        <button type="button" style={btn} disabled={busy || original === undefined} onClick={() => run(() => onUseThisVersion(info.originalPath))}>
          {text.useThisVersion}
        </button>
        <button type="button" style={btn} disabled={busy} onClick={() => setDismissed(true)}>
          {text.keepBoth}
        </button>
        {busy && <span style={{ color: "var(--text-muted)", alignSelf: "center" }}>{text.working}</span>}
      </div>
      {diff && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
            <span style={{ color: "var(--red, #e06c75)" }}>− {text.legendOriginal}</span>
            {"  ·  "}
            <span style={{ color: "var(--green, #98c379)" }}>+ {text.legendThis}</span>
          </div>
          {diff.every((l) => l.type === "same") ? (
            <div style={{ color: "var(--text-muted)" }}>{text.identical}</div>
          ) : (
            <pre
              data-testid="conflict-diff"
              style={{ maxHeight: 280, overflow: "auto", margin: 0, padding: 6, background: "var(--bg-primary)", borderRadius: 4, fontSize: 12, whiteSpace: "pre-wrap" }}
            >
              {diff.map((l, i) => (
                <div
                  key={i}
                  style={{
                    color: l.type === "remove" ? "var(--red, #e06c75)" : l.type === "add" ? "var(--green, #98c379)" : "var(--text-secondary)",
                  }}
                >
                  {l.type === "remove" ? "− " : l.type === "add" ? "+ " : "  "}
                  {l.text}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
