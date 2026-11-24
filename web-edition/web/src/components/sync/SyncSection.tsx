"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  webApi,
  ApiError,
  type ApiSyncConnection,
  type ApiSyncJob,
  type ApiSyncOptions,
  type ApiGithubRepo,
  type ApiGithubUser,
  type SyncDirection,
  type SyncProviderType,
} from "@/lib/webApi";
import { formatDate, t, tOr } from "@noteriv/ui/i18n";
import { planLimitText } from "@/lib/plan";
import { useLocale } from "@noteriv/ui/i18n/react";

/**
 * Sync tab. Parity with desktop's Sync settings (docs/plans/2026-10-14-noteriv-web-desktop-parity-v2.md
 * Pha 2): GitHub token check + repo picker + create repo + branch list, editable
 * connections, auto-sync / sync-on-save / pull-on-open, commit template, run log,
 * and conflict resolution. "Folder" provider is intentionally absent (no server
 * equivalent). Layout classes (st-*) come from the Settings modal's stylesheet.
 */

interface JobView {
  latestJob: ApiSyncJob | null;
  changesSinceSync: number;
  remote: { remoteChanged: boolean; remoteReachable: boolean; error?: string } | null;
}

const INTERVALS = [1, 5, 10, 30, 60];
const DIRECTIONS: SyncDirection[] = ["both", "push", "pull"];

/** Extract the hostname from an https or SSH git remote URL. */
function gitRemoteHost(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  const ssh = u.match(/^(?:ssh:\/\/)?[^@/]+@([^:/]+)/);
  if (ssh) return ssh[1].toLowerCase();
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function providerForHost(host: string): Exclude<SyncProviderType, "webdav"> {
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  if (host.includes("forgejo")) return "forgejo";
  return "gitea"; // gitea/forgejo/codeberg/self-hosted all speak the same REST shape server-side
}

function tokenPageUrl(host: string): string | null {
  if (host === "github.com" || host.endsWith(".github.com")) {
    return "https://github.com/settings/tokens/new?scopes=repo&description=Noteriv";
  }
  if (host.includes("gitlab")) return `https://${host}/-/user_settings/personal_access_tokens`;
  if (host.includes("gitea") || host.includes("forgejo") || host === "codeberg.org") {
    return `https://${host}/user/settings/applications`;
  }
  if (host.includes("bitbucket")) return "https://bitbucket.org/account/settings/app-passwords/";
  return null;
}

/** Dates in sync status and the run log, in the current language. */
const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null;
    if (body?.error === "email_unverified") return t("web.account.verifyFirst");
    const overLimit = planLimitText(err);
    if (overLimit) return `${overLimit} ${t("web.plan.seePlan")}`;
    if (body?.message) return body.message;
    if (body?.error === "forbidden") return t("web.sync.forbidden");
  }
  return fallback;
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-info">
        <span className="st-row-label">{label}</span>
        {desc && <span className="st-row-desc">{desc}</span>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Direction / auto-sync / template controls shared by the add wizard and the edit panel. */
function OptionsFields({
  value,
  onChange,
  isGit,
}: {
  value: Required<ApiSyncOptions>;
  onChange: (patch: ApiSyncOptions) => void;
  isGit: boolean;
}) {
  return (
    <>
      {isGit && (
        <Row label={t("web.sync.direction.label")}>
          <select
            className="st-text-input"
            value={value.direction}
            onChange={(e) => onChange({ direction: e.target.value as SyncDirection })}
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {t(`web.sync.direction.${d}`)}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label={t("web.sync.auto.label")} desc={t("web.sync.auto.desc")}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Toggle checked={value.autoSync} onChange={(v) => onChange({ autoSync: v })} label={t("web.sync.on")} />
          <select
            className="st-text-input"
            disabled={!value.autoSync}
            value={value.syncIntervalMinutes}
            onChange={(e) => onChange({ syncIntervalMinutes: Number(e.target.value) })}
          >
            {INTERVALS.map((m) => (
              <option key={m} value={m}>
                {t("web.sync.every", { count: m })}
              </option>
            ))}
          </select>
        </div>
      </Row>
      {isGit && (
        <>
          <Row label={t("web.sync.onSave.label")} desc={t("web.sync.onSave.desc")}>
            <Toggle checked={value.syncOnSave} onChange={(v) => onChange({ syncOnSave: v })} label={t("web.sync.on")} />
          </Row>
          <Row label={t("web.sync.pullOnOpen.label")} desc={t("web.sync.pullOnOpen.desc")}>
            <Toggle checked={value.pullOnOpen} onChange={(v) => onChange({ pullOnOpen: v })} label={t("web.sync.on")} />
          </Row>
          <Row label={t("web.sync.commitTemplate.label")} desc={t("web.sync.commitTemplate.desc")}>
            <input
              className="st-text-input"
              value={value.commitTemplate}
              onChange={(e) => onChange({ commitTemplate: e.target.value })}
              style={{ minWidth: 220 }}
            />
          </Row>
        </>
      )}
    </>
  );
}

const DEFAULT_OPTIONS: Required<ApiSyncOptions> = {
  direction: "both",
  autoSync: false,
  syncIntervalMinutes: 10,
  commitTemplate: "Sync notes {date}",
  syncOnSave: false,
  pullOnOpen: false,
};

function optionsOf(c: ApiSyncConnection): Required<ApiSyncOptions> {
  return {
    direction: c.direction,
    autoSync: c.autoSync,
    syncIntervalMinutes: c.syncIntervalMinutes ?? 10,
    commitTemplate: c.commitTemplate ?? "Sync notes {date}",
    syncOnSave: c.syncOnSave ?? false,
    pullOnOpen: c.pullOnOpen ?? false,
  };
}

export default function SyncSection({ vaultId }: { vaultId: string }) {
  useLocale();
  const [connections, setConnections] = useState<ApiSyncConnection[] | null>(null);
  const [views, setViews] = useState<Record<string, JobView>>({});
  const [adding, setAdding] = useState<"github" | "git" | "webdav" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<string | null>(null);
  const [log, setLog] = useState<ApiSyncJob[]>([]);
  const [armed, setArmed] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "fail"; text: string } | null>(null);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const loadStatus = useCallback(
    async (connId: string, withRemote = false) => {
      try {
        const res = await webApi.sync.status(vaultId, connId, withRemote);
        setViews((prev) => ({
          ...prev,
          [connId]: { latestJob: res.latestJob, changesSinceSync: res.changesSinceSync, remote: res.remote ?? prev[connId]?.remote ?? null },
        }));
        return res;
      } catch {
        return null;
      }
    },
    [vaultId]
  );

  const refresh = useCallback(async () => {
    try {
      const list = await webApi.sync.list(vaultId);
      setConnections(list);
      list.forEach((c) => loadStatus(c.id));
    } catch {
      setConnections([]);
    }
  }, [vaultId, loadStatus]);

  useEffect(() => {
    refresh();
    const timers = pollTimers.current;
    return () => {
      Object.values(timers).forEach(clearInterval);
    };
  }, [refresh]);

  function pollUntilDone(connId: string) {
    if (pollTimers.current[connId]) clearInterval(pollTimers.current[connId]);
    pollTimers.current[connId] = setInterval(async () => {
      const res = await loadStatus(connId);
      const st = res?.latestJob?.status;
      if (st && st !== "queued" && st !== "running") {
        clearInterval(pollTimers.current[connId]);
        delete pollTimers.current[connId];
        refresh();
      }
    }, 2000);
  }

  async function run(action: () => Promise<unknown>, connId: string, failText: string) {
    setNotice(null);
    try {
      await action();
      // Show "queued" immediately; the poll replaces it with the real result.
      setViews((prev) => ({
        ...prev,
        [connId]: { ...(prev[connId] ?? { changesSinceSync: 0, remote: null }), latestJob: { status: "queued" } as ApiSyncJob },
      }));
      pollUntilDone(connId);
    } catch (err) {
      setNotice({ kind: "fail", text: describeError(err, failText) });
    }
  }

  async function testConnection(connId: string) {
    setNotice(null);
    try {
      const r = await webApi.sync.test(vaultId, connId);
      setNotice(r.ok ? { kind: "ok", text: t("web.sync.testOk") } : { kind: "fail", text: r.error || t("web.sync.testFailed") });
    } catch (err) {
      setNotice({ kind: "fail", text: describeError(err, t("web.sync.testError")) });
    }
  }

  function confirmThen(key: string, fn: () => void) {
    if (armed !== key) {
      setArmed(key);
      setTimeout(() => setArmed((k) => (k === key ? null : k)), 4000);
      return;
    }
    setArmed(null);
    fn();
  }

  async function removeConnection(connId: string) {
    if (pollTimers.current[connId]) clearInterval(pollTimers.current[connId]);
    try {
      await webApi.sync.remove(vaultId, connId);
    } catch (err) {
      setNotice({ kind: "fail", text: describeError(err, t("web.sync.removeFailed")) });
    }
    refresh();
  }

  async function openLog(connId: string) {
    if (logFor === connId) {
      setLogFor(null);
      return;
    }
    setLogFor(connId);
    setLog(await webApi.sync.log(vaultId, connId).catch(() => []));
  }

  return (
    <div className="st-section">
      <div className="st-group-label">{t("web.sync.connections")}</div>
      {notice && <div className={`st-test-result ${notice.kind === "ok" ? "st-test-ok" : "st-test-fail"}`}>{notice.text}</div>}
      {connections === null && <div className="st-row-desc">{t("web.sync.loading")}</div>}
      {connections?.length === 0 && !adding && (
        <div className="st-row-desc" style={{ padding: "8px 0" }}>
          {t("web.sync.none")}
        </div>
      )}

      {connections?.map((c) => {
        const view = views[c.id];
        const job = view?.latestJob;
        const running = job?.status === "queued" || job?.status === "running";
        const conflict = job?.status === "conflict";
        const isGit = c.providerType !== "webdav";
        return (
          <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div className="st-row" style={{ paddingTop: 0 }}>
              <div className="st-row-info">
                <span className="st-row-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {c.accountAvatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.accountAvatarUrl} alt="" width={18} height={18} style={{ borderRadius: "50%" }} />
                  )}
                  {isGit ? `${c.providerType}${c.accountLogin ? ` · @${c.accountLogin}` : ""}` : "WebDAV"}
                </span>
                <span className="st-row-desc" style={{ wordBreak: "break-all" }}>
                  {isGit ? `${c.remoteUrl} (${c.branch})` : c.webdavUrl}
                </span>
                <span className="st-row-desc">
                  {c.lastSyncedAt ? t("web.sync.lastSynced", { time: formatDate(new Date(c.lastSyncedAt), DATE_TIME) }) : t("web.sync.neverSynced")}
                  {running && t("web.sync.syncing")}
                  {!running && job?.status === "success" && ` · ↑${job.pushedCount} ↓${job.pulledCount}`}
                  {view && view.changesSinceSync > 0 && t("web.sync.unsynced", { count: view.changesSinceSync })}
                  {view?.remote?.remoteChanged && t("web.sync.remoteChanged")}
                  {view?.remote && !view.remote.remoteReachable && t("web.sync.remoteUnreachable", { error: view.remote.error ?? "" })}
                  {c.autoSync && t("web.sync.autoEvery", { count: c.syncIntervalMinutes })}
                </span>
                {job?.status === "success" && job.errorMessage && (
                  <span className="st-row-desc" style={{ color: "var(--yellow)" }}>
                    ⚠ {job.errorMessage}
                  </span>
                )}
                {job?.status === "error" && job.errorMessage && (
                  <span className="st-row-desc" style={{ color: "var(--red)" }}>
                    {t("web.sync.errorPrefix", { message: job.errorMessage })}
                  </span>
                )}
              </div>
            </div>

            {conflict && isGit && (
              <div style={{ background: "var(--bg-tertiary)", borderRadius: 6, padding: 10, margin: "6px 0" }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--yellow)" }}>
                  {t("web.sync.conflictTitle")}
                </div>
                {job?.conflictFiles && job.conflictFiles.length > 0 && (
                  <ul style={{ fontSize: 12, margin: "6px 0 6px 16px", listStyle: "disc" }}>
                    {job.conflictFiles.slice(0, 8).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                    {job.conflictFiles.length > 8 && <li>{t("web.sync.moreFiles", { count: job.conflictFiles.length - 8 })}</li>}
                  </ul>
                )}
                <div className="st-row-desc">{t("web.sync.conflictHint")}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    className="st-test-btn"
                    onClick={() =>
                      confirmThen(`rw-${c.id}`, () => run(() => webApi.sync.resolve(vaultId, c.id, "web"), c.id, t("web.sync.resolveFailed")))
                    }
                  >
                    {armed === `rw-${c.id}` ? t("web.sync.keepWebConfirm") : t("web.sync.keepWeb")}
                  </button>
                  <button
                    className="st-test-btn"
                    onClick={() =>
                      confirmThen(`rr-${c.id}`, () => run(() => webApi.sync.resolve(vaultId, c.id, "remote"), c.id, t("web.sync.resolveFailed")))
                    }
                  >
                    {armed === `rr-${c.id}` ? t("web.sync.keepRepoConfirm") : t("web.sync.keepRepo")}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <button
                className="st-test-btn"
                disabled={running}
                onClick={() => run(() => webApi.sync.trigger(vaultId, c.id), c.id, t("web.sync.startFailed"))}
              >
                {running ? t("web.sync.syncingButton") : t("web.sync.syncNow")}
              </button>
              <button className="st-test-btn" onClick={() => testConnection(c.id)}>
                {t("web.sync.test")}
              </button>
              {isGit && (
                <button className="st-test-btn" onClick={() => loadStatus(c.id, true)}>
                  {t("web.sync.checkRemote")}
                </button>
              )}
              <button className="st-test-btn" onClick={() => setEditingId(editingId === c.id ? null : c.id)}>
                {editingId === c.id ? t("web.sync.closeEdit") : t("web.sync.edit")}
              </button>
              <button className="st-test-btn" onClick={() => openLog(c.id)}>
                {t("web.sync.log")}
              </button>
              <button className="st-test-btn" onClick={() => confirmThen(`rm-${c.id}`, () => removeConnection(c.id))}>
                {armed === `rm-${c.id}` ? t("web.sync.removeConfirm") : t("web.sync.remove")}
              </button>
            </div>

            {editingId === c.id && (
              <EditPanel
                vaultId={vaultId}
                connection={c}
                onSaved={() => {
                  setEditingId(null);
                  refresh();
                }}
              />
            )}

            {logFor === c.id && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {log.length === 0 && <div className="st-row-desc">{t("web.sync.logEmpty")}</div>}
                {log.map((j) => (
                  <div key={j.id} style={{ display: "flex", gap: 8, padding: "2px 0", borderTop: "1px solid var(--border)" }}>
                    <span style={{ minWidth: 130 }}>{formatDate(new Date(j.createdAt), DATE_TIME)}</span>
                    <span
                      style={{
                        minWidth: 70,
                        color: j.status === "success" ? "var(--green)" : j.status === "error" ? "var(--red)" : j.status === "conflict" ? "var(--yellow)" : undefined,
                      }}
                    >
                      {tOr(`web.sync.status.${j.status}`, j.status)}
                    </span>
                    <span style={{ flex: 1, wordBreak: "break-word" }}>
                      {j.status === "success" ? `↑${j.pushedCount} ↓${j.pulledCount}${j.errorMessage ? ` · ⚠ ${j.errorMessage.slice(0, 140)}` : ""}` : j.errorMessage?.slice(0, 160)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="st-divider" />

      {!adding ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="st-test-btn" onClick={() => setAdding("github")}>
            {t("web.sync.addGithub")}
          </button>
          <button className="st-test-btn" onClick={() => setAdding("git")}>
            {t("web.sync.addGit")}
          </button>
          <button className="st-test-btn" onClick={() => setAdding("webdav")}>
            {t("web.sync.addWebdav")}
          </button>
        </div>
      ) : adding === "github" ? (
        <GithubWizard
          vaultId={vaultId}
          onDone={() => {
            setAdding(null);
            refresh();
          }}
          onCancel={() => setAdding(null)}
        />
      ) : adding === "git" ? (
        <GenericGitForm
          vaultId={vaultId}
          onDone={() => {
            setAdding(null);
            refresh();
          }}
          onCancel={() => setAdding(null)}
        />
      ) : (
        <WebdavForm
          vaultId={vaultId}
          onDone={() => {
            setAdding(null);
            refresh();
          }}
          onCancel={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function EditPanel({ vaultId, connection, onSaved }: { vaultId: string; connection: ApiSyncConnection; onSaved: () => void }) {
  const isGit = connection.providerType !== "webdav";
  const [opts, setOpts] = useState<Required<ApiSyncOptions>>(optionsOf(connection));
  const [branch, setBranch] = useState(connection.branch);
  const [branches, setBranches] = useState<string[]>([]);
  const [newToken, setNewToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isGithub = connection.providerType === "github";
  useEffect(() => {
    if (!isGithub || !connection.remoteUrl) return;
    const m = connection.remoteUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
    if (!m) return;
    webApi.github.branches(vaultId, { connectionId: connection.id }, m[1]).then(setBranches).catch(() => undefined);
  }, [vaultId, connection.id, connection.remoteUrl, isGithub]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await webApi.sync.update(vaultId, connection.id, {
        ...opts,
        ...(isGit ? { branch: branch.trim() || connection.branch } : {}),
        ...(newToken.trim() ? { token: newToken.trim() } : {}),
      });
      onSaved();
    } catch (err) {
      setError(describeError(err, t("web.sync.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      {isGit && (
        <Row label={t("web.sync.branch")}>
          {branches.length > 0 ? (
            <select className="st-text-input" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {!branches.includes(branch) && <option value={branch}>{branch}</option>}
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          ) : (
            <input className="st-text-input" value={branch} onChange={(e) => setBranch(e.target.value)} />
          )}
        </Row>
      )}
      <OptionsFields value={opts} onChange={(p) => setOpts((o) => ({ ...o, ...p }))} isGit={isGit} />
      {isGit && (
        <Row label={t("web.sync.newToken.label")} desc={t("web.sync.newToken.desc")}>
          <input type="password" className="st-text-input" value={newToken} onChange={(e) => setNewToken(e.target.value)} placeholder={t("web.sync.newToken.placeholder")} />
        </Row>
      )}
      {error && <div className="st-test-result st-test-fail">{error}</div>}
      <div>
        <button className="st-test-btn" disabled={saving} onClick={save}>
          {saving ? t("web.sync.saving") : t("web.sync.saveChanges")}
        </button>
      </div>
    </div>
  );
}

export function GithubWizard({
  vaultId,
  onDone,
  onCancel,
}: {
  vaultId: string;
  onDone: (connection: ApiSyncConnection, repo: ApiGithubRepo) => void;
  onCancel: () => void;
}) {
  useLocale();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<ApiGithubUser | null>(null);
  const [repos, setRepos] = useState<ApiGithubRepo[]>([]);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<ApiGithubRepo | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("main");
  const [newName, setNewName] = useState("");
  const [newPrivate, setNewPrivate] = useState(true);
  const [opts, setOpts] = useState<Required<ApiSyncOptions>>(DEFAULT_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError("");
    try {
      const src = { token: token.trim() };
      const [u, list] = await Promise.all([webApi.github.user(vaultId, src), webApi.github.repos(vaultId, src)]);
      setUser(u);
      setRepos(list);
    } catch (err) {
      setError(describeError(err, t("web.sync.github.verifyFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function pick(repo: ApiGithubRepo) {
    setPicked(repo);
    setBranch(repo.defaultBranch || "main");
    setBranches([]);
    try {
      setBranches(await webApi.github.branches(vaultId, { token: token.trim() }, repo.fullName));
    } catch {
      // empty repo or no access to branches — fall back to the free-text default
    }
  }

  async function createRepo() {
    if (!newName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const repo = await webApi.github.createRepo(vaultId, { token: token.trim() }, newName.trim(), newPrivate);
      setRepos((r) => [repo, ...r]);
      setNewName("");
      await pick(repo);
    } catch (err) {
      setError(describeError(err, t("web.sync.github.createRepoFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const conn = await webApi.sync.createGit(vaultId, {
        providerType: "github",
        remoteUrl: picked.cloneUrl,
        branch: branch.trim() || picked.defaultBranch || "main",
        username: user?.login ?? "",
        token: token.trim(),
        ...opts,
      });
      onDone(conn, picked);
    } catch (err) {
      setError(describeError(err, t("web.sync.github.connectFailed")));
    } finally {
      setBusy(false);
    }
  }

  const shown = repos.filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase())).slice(0, 50);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="st-group-label">{t("web.sync.github.title")}</div>
      {!user ? (
        <form onSubmit={verify} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="st-row-desc">
            {t("web.sync.github.step1")}{" "}
            <a href={tokenPageUrl("github.com")!} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
              {t("web.sync.github.createToken")}
            </a>
          </div>
          <input
            type="password"
            className="st-text-input"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t("web.sync.github.tokenPlaceholder")}
            autoFocus
          />
          {error && <div className="st-test-result st-test-fail">{error}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button type="submit" className="st-test-btn" disabled={busy || !token.trim()}>
              {busy ? t("web.sync.github.verifying") : t("web.sync.github.verify")}
            </button>
            <button type="button" className="st-test-btn" onClick={onCancel}>
              {t("web.sync.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatarUrl} alt="" width={22} height={22} style={{ borderRadius: "50%" }} />
            <span>
              {t("web.sync.github.signedIn")} <b>@{user.login}</b>
              {user.name ? ` (${user.name})` : ""}
            </span>
          </div>

          {!picked ? (
            <>
              <div className="st-row-desc">{t("web.sync.github.step2")}</div>
              <input className="st-text-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("web.sync.github.filter")} />
              <div style={{ maxHeight: 190, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
                {shown.length === 0 && <div className="st-row-desc" style={{ padding: 8 }}>{t("web.sync.github.noMatch")}</div>}
                {shown.map((r) => (
                  <button
                    key={r.fullName}
                    type="button"
                    onClick={() => pick(r)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", fontSize: 12 }}
                    className="hover:bg-[var(--bg-hover)]"
                  >
                    {r.fullName} {r.private ? "🔒" : ""}
                    {r.description && <span style={{ color: "var(--text-muted)" }}> — {r.description}</span>}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="st-text-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("web.sync.github.newRepoPlaceholder")}
                />
                <Toggle checked={newPrivate} onChange={setNewPrivate} label={t("web.sync.github.private")} />
                <button type="button" className="st-test-btn" disabled={busy || !newName.trim()} onClick={createRepo}>
                  {t("web.sync.github.createRepo")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="st-row-desc">
                {t("web.sync.github.step3")} <b>{picked.fullName}</b>
                <button type="button" className="st-test-btn" style={{ marginLeft: 8 }} onClick={() => setPicked(null)}>
                  {t("web.sync.github.changeRepo")}
                </button>
              </div>
              <Row label={t("web.sync.branch")} desc={branches.length === 0 ? t("web.sync.github.emptyRepo") : ""}>
                {branches.length > 0 ? (
                  <select className="st-text-input" value={branch} onChange={(e) => setBranch(e.target.value)}>
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="st-text-input" value={branch} onChange={(e) => setBranch(e.target.value)} />
                )}
              </Row>
              <OptionsFields value={opts} onChange={(p) => setOpts((o) => ({ ...o, ...p }))} isGit />
              <div className="st-row-desc">
                {t("web.sync.github.firstSync")}
              </div>
            </>
          )}
          {error && <div className="st-test-result st-test-fail">{error}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            {picked && (
              <button type="button" className="st-test-btn" disabled={busy} onClick={connect}>
                {busy ? t("web.sync.github.connecting") : t("web.sync.github.connect")}
              </button>
            )}
            <button type="button" className="st-test-btn" onClick={onCancel}>
              {t("web.sync.cancel")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function GenericGitForm({ vaultId, onDone, onCancel }: { vaultId: string; onDone: () => void; onCancel: () => void }) {
  const [remoteUrl, setRemoteUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [opts, setOpts] = useState<Required<ApiSyncOptions>>(DEFAULT_OPTIONS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const host = gitRemoteHost(remoteUrl);
  const ptu = tokenPageUrl(host);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!remoteUrl.trim() || !token.trim()) {
      setError(t("web.sync.git.required"));
      return;
    }
    setSaving(true);
    try {
      await webApi.sync.createGit(vaultId, {
        providerType: providerForHost(host),
        remoteUrl: remoteUrl.trim(),
        branch: branch.trim() || "main",
        username: username.trim(),
        token: token.trim(),
        ...opts,
      });
      onDone();
    } catch (err) {
      setError(describeError(err, t("web.sync.git.addFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Row label={t("web.sync.field.remoteUrl")} desc={t("web.sync.git.remoteDesc")}>
        <input
          className="st-text-input"
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
          placeholder="https://gitlab.com/user/repo.git"
          style={{ minWidth: 260 }}
        />
      </Row>
      <Row label={t("web.sync.branch")}>
        <input className="st-text-input" value={branch} onChange={(e) => setBranch(e.target.value)} />
      </Row>
      {ptu && (
        <a href={ptu} target="_blank" rel="noopener noreferrer" className="st-test-btn" style={{ alignSelf: "flex-start" }}>
          {t("web.sync.git.createToken")}
        </a>
      )}
      <Row label={t("web.sync.field.username")} desc={t("web.sync.git.usernameDesc")}>
        <input className="st-text-input" value={username} onChange={(e) => setUsername(e.target.value)} />
      </Row>
      <Row label={t("web.sync.git.token")}>
        <input type="password" className="st-text-input" value={token} onChange={(e) => setToken(e.target.value)} />
      </Row>
      <OptionsFields value={opts} onChange={(p) => setOpts((o) => ({ ...o, ...p }))} isGit />
      {error && <div className="st-test-result st-test-fail">{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" className="st-test-btn" disabled={saving}>
          {saving ? t("web.sync.saving") : t("web.sync.save")}
        </button>
        <button type="button" className="st-test-btn" onClick={onCancel}>
          {t("web.sync.cancel")}
        </button>
      </div>
    </form>
  );
}

function WebdavForm({ vaultId, onDone, onCancel }: { vaultId: string; onDone: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("/Noteriv");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [opts, setOpts] = useState<Required<ApiSyncOptions>>(DEFAULT_OPTIONS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!url.trim() || !user.trim() || !pass.trim()) {
      setError(t("web.sync.webdav.required"));
      return;
    }
    setSaving(true);
    try {
      await webApi.sync.createWebdav(vaultId, {
        providerType: "webdav",
        webdavUrl: url.trim(),
        webdavPath: path.trim() || "/",
        username: user.trim(),
        password: pass,
        autoSync: opts.autoSync,
        syncIntervalMinutes: opts.syncIntervalMinutes,
      });
      onDone();
    } catch (err) {
      setError(describeError(err, t("web.sync.webdav.addFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Row label={t("web.sync.field.serverUrl")} desc={t("web.sync.webdav.serverDesc")}>
        <input
          className="st-text-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://cloud.example.com/remote.php/dav"
          style={{ minWidth: 260 }}
        />
      </Row>
      <Row label={t("web.sync.field.username")}>
        <input className="st-text-input" value={user} onChange={(e) => setUser(e.target.value)} />
      </Row>
      <Row label={t("web.sync.field.password")}>
        <input type="password" className="st-text-input" value={pass} onChange={(e) => setPass(e.target.value)} />
      </Row>
      <Row label={t("web.sync.field.remotePath")}>
        <input className="st-text-input" value={path} onChange={(e) => setPath(e.target.value)} />
      </Row>
      <OptionsFields value={opts} onChange={(p) => setOpts((o) => ({ ...o, ...p }))} isGit={false} />
      {error && <div className="st-test-result st-test-fail">{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" className="st-test-btn" disabled={saving}>
          {saving ? t("web.sync.saving") : t("web.sync.save")}
        </button>
        <button type="button" className="st-test-btn" onClick={onCancel}>
          {t("web.sync.cancel")}
        </button>
      </div>
    </form>
  );
}
