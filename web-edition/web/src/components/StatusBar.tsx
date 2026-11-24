"use client";

import type { ViewMode } from "@/lib/webApi";
import type { PluginStatusItem } from "@noteriv/ui/plugins/sandbox";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

interface StatusBarProps {
  viewMode: ViewMode;
  vaultName: string;
  notePath: string | null;
  content: string;
  dirty: boolean;
  /** The last save of this note failed; it is retried in the background. */
  saveFailed?: boolean;
  /** The server cannot be reached: an unsaved edit is kept on this device and sent later. */
  keptLocally?: boolean;
  syncSummary?: string | null;
  syncTone?: "muted" | "warn" | "error";
  onOpenSync?: () => void;
  pluginItems?: PluginStatusItem[];
  onPluginItemClick?: (pluginDbId: string, itemId: string) => void;
  /** Status items of core plugins, rendered by @noteriv/ui (CorePluginStatusItems). */
  coreItems?: React.ReactNode;
}


/**
 * Bottom status bar — ported from the inline block in desktop's
 * app/page.tsx (~L1998-2047: mode · vault · path · saved state · sync status
 * · line/char count · plugin status-bar items). Replaces the standalone
 * save-indicator that used to live in NoteToolbar.tsx.
 *
 * Sync status (Phase B1) shows a one-line summary for the vault's first sync
 * connection, if any — clicking it opens Settings > Sync rather than
 * duplicating the connection list/job-polling UI that already lives there.
 * The trailing flex container is reserved for plugin-registered status-bar
 * items once the plugin sandbox gains a `ui.addStatusBarItem` RPC method
 * (not yet implemented, see usePluginHost.ts's METHOD_PERMISSIONS).
 */
export default function StatusBar({
  viewMode,
  vaultName,
  notePath,
  content,
  dirty,
  saveFailed = false,
  keptLocally = false,
  syncSummary,
  syncTone = "muted",
  onOpenSync,
  pluginItems = [],
  onPluginItemClick,
  coreItems,
}: StatusBarProps) {
  useLocale();
  return (
    <div className="flex items-center justify-between h-6 px-3 bg-[var(--bg-secondary)] border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] select-none shrink-0">
      <div className="web-status-left flex items-center gap-3 min-w-0 whitespace-nowrap">
        <span>{t(`shell.status.mode.${viewMode}`)}</span>
        {vaultName && <span>{vaultName}</span>}
        {notePath && <span className="truncate max-w-md">{notePath}</span>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {notePath && (
          <span
            className={saveFailed && !keptLocally ? "text-[var(--red)]" : dirty ? "text-[var(--yellow)]" : "text-[var(--green)]"}
            title={saveFailed ? (keptLocally ? t("shell.status.keptLocallyHint") : t("shell.status.saveFailedHint")) : undefined}
          >
            {saveFailed
              ? keptLocally
                ? t("shell.status.keptLocally")
                : t("shell.status.saveFailed")
              : dirty
              ? t("shell.status.unsaved")
              : t("shell.status.saved")}
          </span>
        )}
        {notePath && (
          <>
            <span>{t("shell.status.lines", { count: content.split("\n").length })}</span>
            <span>{t("shell.status.chars", { count: content.length })}</span>
          </>
        )}
        {syncSummary && (
          <button
            onClick={onOpenSync}
            className="hover:text-[var(--text-primary)]"
            style={syncTone === "error" ? { color: "var(--red)" } : syncTone === "warn" ? { color: "var(--yellow)" } : undefined}
            title={t("web.status.openSync")}
          >
            {syncSummary}
          </button>
        )}
        <div className="flex items-center gap-3">
          {coreItems}
          {pluginItems.map((item) =>
            item.clickable ? (
              <button
                key={`${item.pluginDbId}:${item.id}`}
                onClick={() => onPluginItemClick?.(item.pluginDbId, item.id)}
                title={item.title}
                className="hover:text-[var(--text-primary)]"
              >
                {item.text}
              </button>
            ) : (
              <span key={`${item.pluginDbId}:${item.id}`} title={item.title}>
                {item.text}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}
