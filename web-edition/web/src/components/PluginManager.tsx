"use client";

import { useState, useEffect } from "react";
import { webApi, type ApiPlugin } from "@/lib/webApi";
import {
  fetchCommunityPluginManifest,
  fetchCommunityPluginSource,
  inferPermissions,
  type CommunityPluginEntry,
  type CommunityPluginManifest,
} from "@/lib/plugin-community";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

/** Permission ids (stored in manifests, never translated) and their text in the current language. */
const PERMISSION_LABELS: Record<string, () => string> = {
  "vault:read": () => t("web.pluginManager.permission.vaultRead"),
  "vault:write": () => t("web.pluginManager.permission.vaultWrite"),
  "editor:read": () => t("web.pluginManager.permission.editorRead"),
  "editor:write": () => t("web.pluginManager.permission.editorWrite"),
  "ui:commands": () => t("web.pluginManager.permission.uiCommands"),
  "ui:statusbar": () => t("web.pluginManager.permission.uiStatusbar"),
  "ui:panel": () => t("web.pluginManager.permission.uiPanel"),
  "markdown:render": () => t("web.pluginManager.permission.markdownRender"),
};

/** A permission's text, or the id itself for one this version does not know. */
const permissionLabel = (id: string) => PERMISSION_LABELS[id]?.() ?? id;

export default function PluginManager({
  vaultId,
  installed,
  denied = {},
  onChanged,
  onClose,
}: {
  vaultId: string;
  installed: ApiPlugin[];
  /** Permissions each plugin tried to use without holding them (from usePluginHost). */
  denied?: Record<string, string[]>;
  onChanged: () => void;
  onClose: () => void;
}) {
  useLocale();
  const [manifestJson, setManifestJson] = useState("");
  const [mainJs, setMainJs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [tab, setTab] = useState<"installed" | "community" | "manual">("installed");
  const [communityManifest, setCommunityManifest] = useState<CommunityPluginManifest | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<{
    entry: Pick<CommunityPluginEntry, "id" | "name">;
    source: { manifest: Record<string, unknown>; mainJs: string };
    /** Run after a successful install (e.g. clear the manual-install form). */
    onInstalled?: () => void;
  } | null>(null);

  useEffect(() => {
    if (tab !== "community" || communityManifest || communityLoading) return;
    setCommunityLoading(true);
    setCommunityError(null);
    fetchCommunityPluginManifest()
      .then((m) => {
        if (!m) setCommunityError(t("web.pluginManager.communityLoadFailed"));
        setCommunityManifest(m);
      })
      .finally(() => setCommunityLoading(false));
  }, [tab, communityManifest, communityLoading]);

  const installedIds = new Set(installed.map((p) => p.pluginId));

  // Step 1: fetch the source and show the permissions it will get. Step 2
  // (confirmInstall) actually installs — community plugins have no permission
  // model of their own, so the grant is something the user explicitly accepts.
  async function installFromCommunity(entry: CommunityPluginEntry) {
    setInstallingId(entry.id);
    setCommunityError(null);
    try {
      const source = await fetchCommunityPluginSource(entry);
      if (!source) {
        setCommunityError(t("web.pluginManager.sourceMissing", { name: entry.name }));
        return;
      }
      setPendingInstall({ entry, source });
    } catch {
      setCommunityError(t("web.pluginManager.installFailed", { name: entry.name }));
    } finally {
      setInstallingId(null);
    }
  }

  async function confirmInstall() {
    if (!pendingInstall) return;
    const { entry, source, onInstalled } = pendingInstall;
    setInstallingId(entry.id);
    try {
      await webApi.plugins.install(vaultId, { manifest: source.manifest as ApiPlugin["manifest"], mainJs: source.mainJs });
      setPendingInstall(null);
      onInstalled?.();
      onChanged();
    } catch {
      setCommunityError(t("web.pluginManager.installFailed", { name: entry.name }));
    } finally {
      setInstallingId(null);
    }
  }

  async function install(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let manifest;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      setError(t("web.pluginManager.manifestInvalid"));
      return;
    }
    if (!mainJs.trim()) {
      setError(t("web.pluginManager.mainJsMissing"));
      return;
    }
    // Desktop-style manifests have no `permissions`. Without this step the plugin would install
    // with no rights and silently do nothing, so propose permissions from its code and let the
    // user confirm (same step as the Community tab).
    if (!Array.isArray(manifest.permissions)) manifest.permissions = inferPermissions(mainJs);
    setPendingInstall({
      entry: { id: String(manifest.id ?? "manual"), name: String(manifest.name ?? manifest.id ?? "plugin") },
      source: { manifest, mainJs },
      onInstalled: () => {
        setManifestJson("");
        setMainJs("");
      },
    });
  }

  async function setPermissions(p: ApiPlugin, permissions: string[]) {
    await webApi.plugins.update(vaultId, p.id, { permissions });
    onChanged();
  }

  async function toggle(p: ApiPlugin) {
    await webApi.plugins.update(vaultId, p.id, { enabled: !p.enabled });
    onChanged();
  }

  async function remove(p: ApiPlugin) {
    await webApi.plugins.remove(vaultId, p.id);
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[640px] max-h-[80vh] overflow-y-auto rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("web.pluginManager.title")}</h2>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {t("web.pluginManager.close")}
          </button>
        </div>

        <div className="flex gap-1 border-b border-[var(--border)]">
          {([
            ["installed", t("web.pluginManager.tabs.installed")],
            ["community", t("web.pluginManager.tabs.community")],
            ["manual", t("web.pluginManager.tabs.manual")],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-sm ${tab === key ? "border-b-2 border-[var(--accent)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {pendingInstall && (
          <div className="flex flex-col gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)]">
            <div className="text-sm font-medium">{t("web.pluginManager.confirmTitle", { name: pendingInstall.entry.name })}</div>
            <div className="text-xs text-[var(--text-muted)]">
              {t("web.pluginManager.grants", {
                permissions:
                  ((pendingInstall.source.manifest.permissions as string[] | undefined) ?? []).map(permissionLabel).join(", ") ||
                  t("web.pluginManager.noPermissions"),
              })}
            </div>
            <div className="flex gap-2">
              <button
                onClick={confirmInstall}
                disabled={installingId === pendingInstall.entry.id}
                className="text-xs px-2 py-1 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-80 disabled:opacity-50"
              >
                {t("web.pluginManager.confirm")}
              </button>
              <button
                onClick={() => setPendingInstall(null)}
                className="text-xs px-2 py-1 rounded-md bg-[var(--bg-hover)] hover:opacity-80"
              >
                {t("web.pluginManager.cancel")}
              </button>
            </div>
          </div>
        )}

        {tab === "installed" && (
          <div className="flex flex-col gap-2">
            {installed.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">
                {t("web.pluginManager.noneInstalled")}{" "}
                <button className="text-[var(--accent)] hover:underline" onClick={() => setTab("community")}>
                  {t("web.pluginManager.browseCommunity")}
                </button>
              </p>
            )}
            {installed.map((p) => {
              const granted = (p.manifest.permissions ?? []) as string[];
              const missing = (denied[p.id] ?? []).filter((d) => !granted.includes(d));
              const fromCode = inferPermissions(p.mainJs);
              const canGrantFromCode = fromCode.some((x) => !granted.includes(x));
              const excess = granted.filter((g) => !fromCode.includes(g));
              return (
                <div key={p.id} className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">
                        {p.manifest.name} <span className="text-[var(--text-muted)]">v{p.manifest.version}</span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {granted.map(permissionLabel).join(", ") || t("web.pluginManager.noneGranted")}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => toggle(p)} className="text-xs px-2 py-1 rounded-md bg-[var(--bg-hover)] hover:opacity-80">
                        {p.enabled ? t("web.pluginManager.disable") : t("web.pluginManager.enable")}
                      </button>
                      <button onClick={() => remove(p)} className="text-xs px-2 py-1 rounded-md bg-[var(--bg-hover)] text-[var(--red)] hover:opacity-80">
                        {t("web.pluginManager.uninstall")}
                      </button>
                    </div>
                  </div>

                  {(missing.length > 0 || canGrantFromCode) && (
                    <div className="flex flex-col gap-1 text-xs" style={{ color: "var(--yellow)" }}>
                      {missing.length > 0 && (
                        <span>
                          {t("web.pluginManager.blocked", { permissions: missing.map(permissionLabel).join(", ") })}
                        </span>
                      )}
                      {missing.length === 0 && canGrantFromCode && (
                        <span>{t("web.pluginManager.needsMore")}</span>
                      )}
                      <div>
                        <button
                          onClick={() => setPermissions(p, Array.from(new Set([...granted, ...missing, ...fromCode])))}
                          className="text-xs px-2 py-1 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] hover:opacity-80"
                        >
                          {t("web.pluginManager.grantNeeded")}
                        </button>
                      </div>
                    </div>
                  )}

                  {excess.length > 0 && (
                    <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                      <span>
                        {t("web.pluginManager.unused", { permissions: excess.map(permissionLabel).join(", ") })}
                      </span>
                      <div>
                        <button
                          onClick={() => setPermissions(p, granted.filter((g) => fromCode.includes(g)))}
                          className="text-xs px-2 py-1 rounded-md bg-[var(--bg-hover)] hover:opacity-80"
                        >
                          {t("web.pluginManager.keepNeeded")}
                        </button>
                      </div>
                    </div>
                  )}

                  <details className="text-xs text-[var(--text-muted)]">
                    <summary className="cursor-pointer">{t("web.pluginManager.editPermissions")}</summary>
                    <div className="flex flex-col gap-1 pt-1">
                      {Object.entries(PERMISSION_LABELS).map(([perm, label]) => (
                        <label key={perm} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={granted.includes(perm)}
                            onChange={(e) =>
                              setPermissions(p, e.target.checked ? [...granted, perm] : granted.filter((g) => g !== perm))
                            }
                          />
                          {label()}
                        </label>
                      ))}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}

        {tab === "community" && (
          <div className="flex flex-col gap-2">
            {communityLoading && <p className="text-sm text-[var(--text-muted)]">{t("web.pluginManager.loadingList")}</p>}
            {communityError && <p className="text-xs text-[var(--red)]">{communityError}</p>}
            {communityManifest?.plugins.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-tertiary)]">
                <div>
                  <div className="text-sm font-medium">
                    {entry.name} <span className="text-[var(--text-muted)]">v{entry.version}</span>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{entry.description} — {entry.author}</div>
                </div>
                <button
                  onClick={() => installFromCommunity(entry)}
                  disabled={installingId === entry.id || installedIds.has(entry.id)}
                  className="text-xs px-2 py-1 rounded-md bg-[var(--bg-hover)] hover:opacity-80 disabled:opacity-50"
                >
                  {installedIds.has(entry.id) ? t("web.pluginManager.installed") : installingId === entry.id ? t("web.pluginManager.installing") : t("web.pluginManager.install")}
                </button>
              </div>
            ))}
            {communityManifest && communityManifest.plugins.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">{t("web.pluginManager.noneCommunity")}</p>
            )}
          </div>
        )}

        {tab === "manual" && (
          <form onSubmit={install} className="flex flex-col gap-2 pt-2">
            <h3 className="text-sm font-medium text-[var(--text-secondary)]">{t("web.pluginManager.manualTitle")}</h3>
            <textarea
              value={manifestJson}
              onChange={(e) => setManifestJson(e.target.value)}
              placeholder={t("web.pluginManager.manifestPlaceholder")}
              className="h-20 text-xs font-mono px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            <textarea
              value={mainJs}
              onChange={(e) => setMainJs(e.target.value)}
              placeholder="main.js — module.exports.onLoad = function(api) { ... }"
              className="h-32 text-xs font-mono px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            {error && <p className="text-xs text-[var(--red)]">{error}</p>}
            <button
              type="submit"
              disabled={installing}
              className="self-start px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] text-sm font-medium disabled:opacity-50"
            >
              {installing ? t("web.pluginManager.installing") : t("web.pluginManager.install")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
