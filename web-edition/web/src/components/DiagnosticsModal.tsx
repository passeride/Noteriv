"use client";

import { useCallback, useEffect, useState } from "react";
import { webApi, type ApiPlugin, type ApiSyncConnection } from "@/lib/webApi";
import { t, tOr } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

type ServerReport = Awaited<ReturnType<typeof webApi.diagnostics.get>>;

interface Props {
  vaultId: string;
  plugins: ApiPlugin[];
  denied: Record<string, string[]>;
  syncConnections: ApiSyncConnection[];
  onClose: () => void;
}

/** Unset in local builds: the copied report says "unknown", the dialog says it in the current language. */
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;

function Row({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <div className="flex gap-2 text-sm" style={{ padding: "3px 0" }}>
      <span style={{ width: 18, color: ok === null ? "var(--text-muted)" : ok ? "var(--green)" : "var(--red)" }}>
        {ok === null ? "•" : ok ? "✓" : "✗"}
      </span>
      <span style={{ minWidth: 190 }}>{label}</span>
      <span className="text-[var(--text-muted)]" style={{ wordBreak: "break-word" }}>
        {detail}
      </span>
    </div>
  );
}

/**
 * Developer > Diagnostics. Collects what is needed to explain "sync fails" / "plugin does nothing"
 * without opening DevTools: server self-check (git, object storage, Redis, worker heartbeat),
 * plugins with their permissions and blocked calls, and the last sync result per connection.
 * The dialog follows the interface language; the copied report stays in English so support reads it the same way.
 */
export default function DiagnosticsModal({ vaultId, plugins, denied, syncConnections, onClose }: Props) {
  useLocale();
  const [server, setServer] = useState<ServerReport | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setServer(null);
    setError("");
    webApi.diagnostics.get().then(setServer).catch(() => setError(t("web.diagnostics.serverFailed")));
  }, []);
  useEffect(load, [load]);

  function report(): string {
    const lines: string[] = [];
    lines.push(`Noteriv diagnostics — ${new Date().toISOString()}`);
    lines.push(`Build web: ${BUILD_TIME ?? "unknown"}`);
    lines.push(`Browser: ${navigator.userAgent}`);
    lines.push(`Vault: ${vaultId}`);
    if (server) {
      lines.push(`Server: node ${server.node}, uptime ${server.uptimeSeconds}s, db ${server.database.ok ? "ok" : "ERROR"}, redis ${server.redis.ok ? "ok" : "ERROR"}`);
      lines.push(`git: ${server.git.installed ? server.git.version : "MISSING"}`);
      lines.push(`storage: ${server.storage.ok ? "ok" : "ERROR"} (${server.storage.endpoint})${server.storage.error ? " — " + server.storage.error : ""}`);
      lines.push(`pdf: ${server.pdfService.ok ? "ok" : server.pdfService.configured ? "NOT RESPONDING" : "not configured"}`);
      lines.push(`worker: ${server.worker.alive ? "running" : "NOT RESPONDING"} (heartbeat ${server.worker.ageSeconds ?? "?"}s ago)`);
    } else {
      lines.push(`Server: ${error ? "unreachable" : "loading"}`);
    }
    for (const c of syncConnections) {
      lines.push(`sync ${c.providerType} ${c.remoteUrl ?? c.webdavUrl}: ${JSON.stringify(c.lastSyncStatus)}`);
    }
    for (const p of plugins) {
      lines.push(`plugin ${p.pluginId} (${p.enabled ? "on" : "off"}): permissions=[${(p.manifest.permissions ?? []).join(",")}] blocked=[${(denied[p.id] ?? []).join(",")}]`);
    }
    return lines.join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(report());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("web.diagnostics.copyFailed"));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-xl"
        style={{ width: 620, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto", padding: 20 }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <h2 className="text-base font-semibold">{t("web.diagnostics.title")}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)]" style={{ padding: 4 }}>
            {t("common.close")}
          </button>
        </div>

        <div className="text-xs text-[var(--text-muted)]" style={{ marginBottom: 6 }}>{t("web.diagnostics.server")}</div>
        {error && <div className="text-sm" style={{ color: "var(--red)" }}>{error}</div>}
        {!server && !error && <div className="text-sm text-[var(--text-muted)]">{t("web.diagnostics.checking")}</div>}
        {server && (
          <>
            <Row ok={server.database.ok} label={t("web.diagnostics.database")} />
            <Row ok={server.redis.ok} label={t("web.diagnostics.redis")} />
            <Row ok={server.git.installed} label="git" detail={server.git.version ?? t("web.diagnostics.gitMissing")} />
            <Row
              ok={server.storage.ok}
              label={t("web.diagnostics.storage")}
              detail={server.storage.ok ? server.storage.endpoint : `${server.storage.error ?? t("web.diagnostics.unreachable")} — ${server.storage.endpoint}`}
            />
            <Row
              ok={server.worker.alive}
              label={t("web.diagnostics.worker")}
              detail={server.worker.alive ? t("web.diagnostics.heartbeat", { seconds: server.worker.ageSeconds ?? "?" }) : t("web.diagnostics.noHeartbeat")}
            />
            <Row
              ok={server.pdfService.ok}
              label={t("web.diagnostics.pdf")}
              detail={server.pdfService.ok ? t("web.diagnostics.ready") : server.pdfService.configured ? t("web.diagnostics.notResponding") : t("web.diagnostics.notConfigured")}
            />
            {server.scratchDisk && (
              <Row ok={server.scratchDisk.freeMB > 500} label={t("web.diagnostics.scratch")} detail={t("web.diagnostics.diskFree", { free: server.scratchDisk.freeMB, total: server.scratchDisk.totalMB })} />
            )}
          </>
        )}

        <div className="text-xs text-[var(--text-muted)]" style={{ margin: "14px 0 6px" }}>{t("web.diagnostics.sync")}</div>
        {syncConnections.length === 0 && <div className="text-sm text-[var(--text-muted)]">{t("web.diagnostics.noConnections")}</div>}
        {syncConnections.map((c) => {
          const st = c.lastSyncStatus as { status?: string; error?: string; warning?: string } | null;
          const ok = st?.status === "success" ? !st.warning : st ? false : null;
          return (
            <Row
              key={c.id}
              ok={ok}
              label={`${c.providerType} · ${(c.remoteUrl ?? c.webdavUrl ?? "").replace(/^https?:\/\//, "").slice(0, 30)}`}
              detail={st ? `${tOr(`web.sync.status.${st.status}`, st.status ?? "")}${st.error ? " — " + st.error : ""}${st.warning ? " — " + st.warning : ""}` : t("web.diagnostics.neverRun")}
            />
          );
        })}

        <div className="text-xs text-[var(--text-muted)]" style={{ margin: "14px 0 6px" }}>{t("web.diagnostics.plugins")}</div>
        {plugins.length === 0 && <div className="text-sm text-[var(--text-muted)]">{t("web.diagnostics.noPlugins")}</div>}
        {plugins.map((p) => {
          const blocked = denied[p.id] ?? [];
          return (
            <Row
              key={p.id}
              ok={p.enabled ? blocked.length === 0 : null}
              label={`${p.manifest.name} ${p.enabled ? "" : t("web.diagnostics.off")}`}
              detail={`${t("web.diagnostics.permissions", { list: (p.manifest.permissions ?? []).join(", ") || t("web.diagnostics.none") })}${blocked.length ? ` · ${t("web.diagnostics.blocked", { list: blocked.join(", ") })}` : ""}`}
            />
          );
        })}

        <div className="text-xs text-[var(--text-muted)]" style={{ margin: "14px 0 6px" }}>{t("web.diagnostics.browser")}</div>
        <Row ok={null} label="Build web" detail={BUILD_TIME ?? t("web.diagnostics.unknown")} />
        <Row ok={null} label="User agent" detail={navigator.userAgent.slice(0, 90)} />

        <div className="flex gap-2" style={{ marginTop: 16 }}>
          <button className="rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-sm" style={{ padding: "7px 14px" }} onClick={load}>
            {t("web.diagnostics.recheck")}
          </button>
          <button className="rounded-md text-sm" style={{ padding: "7px 14px", background: "var(--accent)", color: "var(--bg-primary)" }} onClick={copy}>
            {copied ? t("web.diagnostics.copied") : t("web.diagnostics.copy")}
          </button>
        </div>
      </div>
    </div>
  );
}
