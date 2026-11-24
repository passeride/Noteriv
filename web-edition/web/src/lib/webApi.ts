/**
 * Thin REST client for the Noteriv web backend.
 *
 * Phase 1 only covers auth + vault/folder/note CRUD. The end goal (per
 * docs/plans/2026-10-12-noteriv-web-version.md §3) is for this module to grow
 * into a drop-in implementation of desktop's `ElectronAPI` interface
 * (desktop/src/types/electron.d.ts) so components ported from desktop/src/
 * can call `window.electronAPI.readFile(...)`-shaped methods unchanged. For
 * now call sites use this module directly; the ElectronAPI-shaped facade
 * gets added once enough surface area exists (Phase 2+).
 */

import type { Locale } from "@noteriv/ui/i18n";
import type { UsageSnapshot } from "../types/usage";
import { setReportingUser } from "./error-reporting";

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  /** Only set by /auth/me: true once the user followed a link sent to `email`. */
  emailVerified?: boolean;
  /** Only set by /auth/me: true when the email is in the server's ADMIN_EMAILS list. */
  isAdmin?: boolean;
  /** Only set by /auth/me: false until the account accepted the current Terms and Privacy Policy (TermsGate asks). */
  termsAccepted?: boolean;
}

export type RegistrationMode = "invite" | "open" | "closed";

export interface ApiInvite {
  id: string;
  code: string;
  note: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: "active" | "used_up" | "expired" | "revoked";
}

/** Usage counts for the admin Stats tab (web/server/src/lib/activity.ts). Retention is a share 0..1, null until known. */
export interface ApiUsageStats {
  users: { total: number; verified: number; locked: number; new7: number; new30: number };
  active: { day1: number; day7: number; day30: number };
  content: { vaults: number; notes: number; attachmentBytes: number };
  weeks: { week: string; signups: number; active: number; retentionWeek1: number | null; retentionWeek4: number | null }[];
}

/** A row of the admin users list (web/server/src/routes/admin.ts). */
export interface ApiAdminUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  emailVerified: boolean;
  locked: boolean;
  planId: string;
  role: "user" | "admin";
  isAdmin: boolean;
  /** Admin through the server's ADMIN_EMAILS: the page cannot take the role away. */
  envAdmin: boolean;
  usage: { vaults: number; attachmentBytes: number; syncConnections: number };
}

export interface ApiAuditEntry {
  id: string;
  createdAt: string;
  action: string;
  userEmail: string | null;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  metadata: unknown;
}

export interface ApiVault {
  id: string;
  workspaceId: string;
  name: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiFolder {
  id: string;
  vaultId: string;
  parentId: string | null;
  name: string;
  path: string;
  position: number;
  createdAt: string;
}

export interface ApiNote {
  id: string;
  vaultId: string;
  folderId: string | null;
  name: string;
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiNoteSummary {
  id: string;
  name: string;
  path: string;
  folderId: string | null;
  frontmatter: Record<string, unknown>;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

/** Body of a 409 from a note save whose base text was out of date: the stored note, and the copy holding the edit. */
export interface StaleNote {
  error: "stale";
  note: ApiNote;
  copy: { id: string; path: string; name: string };
}

export interface VaultIndex {
  folders: ApiFolder[];
  notes: ApiNoteSummary[];
}

export interface ApiSearchResult {
  id: string;
  name: string;
  path: string;
  snippet: string;
  rank: number;
  /** Lines containing the search words (1-based); absent from older servers. */
  matches?: { line: number; text: string }[];
}

export interface ApiBacklink {
  id: string;
  name: string;
  path: string;
}

export type ViewMode = "live" | "source" | "view";

export interface ApiOpenTab {
  noteId: string;
  path: string;
  name: string;
}

export interface ApiWorkspaceState {
  openTabs: ApiOpenTab[];
  activeTabId: string | null;
  pinnedTabIds: string[];
  fileViewModes: Record<string, ViewMode>;
  /** GET only: the open tabs' notes, inlined so restoring needs no extra request per tab (may be partial). */
  notes?: Record<string, { id: string; path: string; name: string; content: string }>;
  /** GET only: open-tab ids whose note no longer exists. */
  missingNoteIds?: string[];
}

export type SyncProviderType = "github" | "gitlab" | "gitea" | "forgejo" | "webdav";
export type SyncDirection = "push" | "pull" | "both";
export type SyncJobStatus = "queued" | "running" | "success" | "conflict" | "error";

export interface ApiSyncConnection {
  id: string;
  vaultId: string;
  providerType: SyncProviderType;
  remoteUrl: string | null;
  branch: string;
  authUsername: string | null;
  webdavUrl: string | null;
  webdavPath: string | null;
  direction: SyncDirection;
  autoSync: boolean;
  syncIntervalMinutes: number;
  commitTemplate: string;
  syncOnSave: boolean;
  pullOnOpen: boolean;
  accountLogin: string | null;
  accountAvatarUrl: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: Record<string, unknown> | null;
  createdAt: string;
}

export interface ApiSyncOptions {
  direction?: SyncDirection;
  autoSync?: boolean;
  syncIntervalMinutes?: number;
  commitTemplate?: string;
  syncOnSave?: boolean;
  pullOnOpen?: boolean;
}

export interface ApiGithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface ApiGithubRepo {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  description: string | null;
  updatedAt: string;
}

/** Either a freshly pasted token (before a connection exists) or an existing connection to borrow it from. */
export type GithubTokenSource = { token: string } | { connectionId: string };

export interface ApiSyncJob {
  id: string;
  syncConnectionId: string;
  status: SyncJobStatus;
  pushedCount: number;
  pulledCount: number;
  errorMessage: string | null;
  conflictFiles?: string[] | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ApiAttachment {
  id: string;
  vaultId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  createdAt: string;
  // PDF annotations (Phase D4) — only ever populated for mimeType
  // "application/pdf". Shape: packages/plugins/src/pdf-viewer/annotations.ts.
  metadata?: unknown;
}

export interface ApiAttachmentList {
  attachments: ApiAttachment[];
  /** Attachment storage of the vault owner's whole account (not this vault alone). */
  usedBytes: number;
  /** The owner's plan limit; null = no limit. */
  quotaBytes: number | null;
}

export type PlanLimitKind = "vaults" | "attachmentBytes" | "syncConnections";

/** GET /users/me/plan: the plan's limits (null = no limit) and what the account uses (web/server/src/lib/plans.ts). */
export interface ApiPlan {
  plan: { id: string; name: string };
  limits: { vaults: number | null; attachmentBytes: number | null; syncConnections: number | null; snapshotsPerNote: number };
  usage: { vaults: number; attachmentBytes: number; syncConnections: number };
}

export interface ApiNoteSnapshot {
  id: string;
  createdAt: string;
  size: number;
}

export interface ApiHistoryEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface ApiTrashedItem {
  id: string;
  name: string;
  path: string;
  deletedAt: string;
}

export interface ApiTrash {
  notes: ApiTrashedItem[];
  folders: ApiTrashedItem[];
}

export interface ApiUserPreferences {
  hotkeys: Record<string, string>;
  editorSettings: {
    editorFont?: string;
    fontSize?: number;
    lineHeight?: number;
    autoSaveInterval?: number;
    vimModeEnabled?: boolean;
    language?: "en" | "vi";
  };
}

export interface ApiPlugin {
  id: string;
  vaultId: string;
  pluginId: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    main: string;
    permissions: string[];
  };
  mainJs: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  installedAt: string;
}

class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API error ${status}`);
  }
}

/** The `error` code of a failed API call (e.g. "email_taken"), or null. */
export function apiErrorCode(err: unknown): string | null {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "error" in err.body) {
    return String((err.body as { error: unknown }).error);
  }
  return null;
}

/** The server refused because a plan limit was reached: which one, the limit and what is used. */
export function planLimit(err: unknown): { limit: PlanLimitKind; max: number; used: number } | null {
  if (apiErrorCode(err) !== "plan_limit") return null;
  const body = (err as ApiError).body as { limit: PlanLimitKind; max: number; used: number };
  return { limit: body.limit, max: body.max, used: body.used };
}

/** The server refused because the account's email is not verified yet (web/server/src/lib/emailGate.ts). */
export const isEmailUnverified = (err: unknown): boolean => apiErrorCode(err) === "email_unverified";

// The access token (15min TTL, see server/src/lib/jwt.ts) expires mid-session
// on any long-lived tab. A single in-flight refresh is shared across
// concurrent 401s so a burst of requests doesn't each race their own
// /auth/refresh call (which would revoke-then-reissue the refresh token
// multiple times and strand the losers with an already-rotated token).
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit, _retrying = false): Promise<T> {
  // Any change to sync connections (create, edit, delete, trigger, resolve…) drops the shared list.
  if (init?.method && init.method !== "GET" && path.includes("/sync-connections")) syncLists.clear();
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      // Only set when there's an actual JSON body — Fastify's JSON body
      // parser rejects a request carrying Content-Type: application/json
      // with an empty body (e.g. every DELETE call) with a 400, confirmed
      // live via a real browser delete: the exact same route accepted a
      // bodyless fetch() with no Content-Type header but 400'd when webApi
      // sent one. A FormData body (file upload) must NOT get this header
      // either — the browser sets its own `multipart/form-data; boundary=`
      // automatically, and overriding it here would drop the boundary and
      // break every upload.
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401 && !_retrying && path !== "/auth/login" && path !== "/auth/refresh") {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, true);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // no body
    }
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** POST that returns a binary body (e.g. a PDF). Retries once after refreshing the session, like request(). */
async function requestBlob(path: string, body: unknown, _retrying = false): Promise<Blob> {
  const res = await fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && !_retrying && (await refreshSession())) return requestBlob(path, body, true);
  if (!res.ok) {
    let errBody: unknown = null;
    try {
      errBody = await res.json();
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, errBody);
  }
  return res.blob();
}

/**
 * `GET /vaults/:id` is asked for by several parts of the vault page at once (the page itself, CSS snippets, custom
 * themes, the core plugin host's settings). Requests within VAULT_GET_TTL_MS share one response; any write to the
 * vault through this client drops it. Each caller gets its own copy, so nobody can change another's object.
 */
const VAULT_GET_TTL_MS = 2000;
const vaultGets = new Map<string, { at: number; vault: Promise<ApiVault> }>();
function getVaultShared(id: string): Promise<ApiVault> {
  const hit = vaultGets.get(id);
  if (!hit || Date.now() - hit.at > VAULT_GET_TTL_MS) {
    const entry = { at: Date.now(), vault: request<ApiVault>(`/vaults/${id}`) };
    vaultGets.set(id, entry);
    entry.vault.catch(() => {
      if (vaultGets.get(id) === entry) vaultGets.delete(id);
    });
    return entry.vault.then((v) => structuredClone(v));
  }
  return hit.vault.then((v) => structuredClone(v));
}

/**
 * `GET /sync-connections`, shared for 2 s like `vaults.get`: opening a vault asked twice (the page's sync status
 * and the note-history plugin's "git history available?" check). Writes clear it (see `request`).
 */
const SYNC_LIST_TTL_MS = 2000;
const syncLists = new Map<string, { at: number; list: Promise<ApiSyncConnection[]> }>();
function syncListShared(vaultId: string): Promise<ApiSyncConnection[]> {
  const hit = syncLists.get(vaultId);
  if (!hit || Date.now() - hit.at > SYNC_LIST_TTL_MS) {
    const entry = { at: Date.now(), list: request<ApiSyncConnection[]>(`/vaults/${vaultId}/sync-connections`) };
    syncLists.set(vaultId, entry);
    entry.list.catch(() => {
      if (syncLists.get(vaultId) === entry) syncLists.delete(vaultId);
    });
    return entry.list.then((l) => structuredClone(l));
  }
  return hit.list.then((l) => structuredClone(l));
}

export const webApi = {
  auth: {
    register: (data: { email: string; password: string; displayName: string; inviteCode?: string; acceptTerms: true; locale?: Locale; captchaToken?: string }) =>
      request<ApiUser>("/auth/register", { method: "POST", body: JSON.stringify(data) }),
    /** `turnstileSiteKey` is set when the server asks for the bot check on sign-up and forgot-password. */
    registration: () => request<{ mode: RegistrationMode; emailEnabled?: boolean; turnstileSiteKey?: string | null }>("/auth/registration"),
    /** Always answers ok for a well-formed address, whether or not it has an account. */
    forgotPassword: (data: { email: string; locale?: Locale; captchaToken?: string }) =>
      request<{ ok: true }>("/auth/forgot-password", { method: "POST", body: JSON.stringify(data) }),
    resetPassword: (data: { token: string; password: string }) =>
      request<{ ok: true }>("/auth/reset-password", { method: "POST", body: JSON.stringify(data) }),
    /** Verifies the sign-up address or confirms a new one, whichever link the token came from. */
    verifyEmail: (token: string) =>
      request<{ ok: true; purpose: "verify_email" | "change_email" }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
    login: (data: { email: string; password: string }) =>
      request<ApiUser>("/auth/login", { method: "POST", body: JSON.stringify(data) }),
    logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }).finally(() => setReportingUser(null)),
    // Error reports name the signed-in account by id only (lib/error-reporting.ts).
    me: () =>
      request<ApiUser>("/auth/me").then((u) => {
        setReportingUser(u.id);
        return u;
      }),
  },

  vaults: {
    list: () => request<ApiVault[]>("/vaults"),
    create: (data: { name: string; workspaceId?: string }) =>
      request<ApiVault>("/vaults", { method: "POST", body: JSON.stringify(data) }),
    get: (id: string) => getVaultShared(id),
    update: (id: string, data: Partial<Pick<ApiVault, "name" | "settings">>) => {
      vaultGets.delete(id);
      return request<ApiVault>(`/vaults/${id}`, { method: "PATCH", body: JSON.stringify(data) });
    },
    remove: (id: string) => {
      vaultGets.delete(id);
      return request<{ ok: true }>(`/vaults/${id}`, { method: "DELETE" });
    },
    index: (id: string) => request<VaultIndex>(`/vaults/${id}/index`),
    search: (id: string, query: string) =>
      request<ApiSearchResult[]>(`/vaults/${id}/search?q=${encodeURIComponent(query)}`),
  },

  folders: {
    create: (vaultId: string, data: { name: string; parentId?: string | null }) =>
      request<ApiFolder>(`/vaults/${vaultId}/folders`, { method: "POST", body: JSON.stringify(data) }),
    update: (vaultId: string, folderId: string, data: { name?: string; parentId?: string | null }) =>
      request<ApiFolder>(`/vaults/${vaultId}/folders/${folderId}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (vaultId: string, folderId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/folders/${folderId}`, { method: "DELETE" }),
  },

  notes: {
    get: (vaultId: string, noteId: string) => request<ApiNote>(`/vaults/${vaultId}/notes/${noteId}`),
    create: (vaultId: string, data: { name: string; folderId?: string | null; content?: string }) =>
      request<ApiNote>(`/vaults/${vaultId}/notes`, { method: "POST", body: JSON.stringify(data) }),
    update: (
      vaultId: string,
      noteId: string,
      data: Partial<Pick<ApiNote, "content" | "frontmatter" | "name" | "folderId">> & {
        /** SHA-256 of the text the edit started from; a changed note then answers 409 { error: "stale" } (StaleNote). */
        baseHash?: string;
        /** SHA-256 the stored text must still have; otherwise nothing is written: 409 { error: "changed" }, no copy. */
        expectHash?: string;
      }
    ) => request<ApiNote>(`/vaults/${vaultId}/notes/${noteId}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (vaultId: string, noteId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/notes/${noteId}`, { method: "DELETE" }),
    /** Quick note: files `content` into `folder` (default Inbox), named after its first line or `fallbackName`. */
    quick: (vaultId: string, data: { content: string; folder?: string; fallbackName?: string }) =>
      request<{ id: string; path: string }>(`/vaults/${vaultId}/quick-note`, { method: "POST", body: JSON.stringify(data) }),
    backlinks: (vaultId: string, noteId: string) =>
      request<ApiBacklink[]>(`/vaults/${vaultId}/notes/${noteId}/backlinks`),
    /** The start of every note with front matter (enough to hold the block), for the Properties view. */
    frontmatterHeads: (vaultId: string) =>
      request<{ id: string; name: string; path: string; head: string }[]>(`/vaults/${vaultId}/frontmatter`),
    /** Notes whose text contains any of `terms` (case-insensitive, at most 200 terms), with that text; `truncated` past the server's cap. */
    containing: (vaultId: string, terms: string[]) =>
      request<{ notes: { id: string; name: string; path: string; content: string }[]; truncated: boolean }>(`/vaults/${vaultId}/notes/containing`, {
        method: "POST",
        body: JSON.stringify({ terms }),
      }),
    /** Batch reads note contents in one request (Bug #5). Used by plugins to scan notes without N individual requests. */
    batch: (vaultId: string, options: { noteIds?: string[]; paths?: string[]; all?: boolean }) =>
      request<{ notes: { id: string; name: string; path: string; content: string }[] }>(
        `/vaults/${vaultId}/notes/batch`,
        { method: "POST", body: JSON.stringify(options) }
      ),
    // D5 — File Recovery / Time Scrubber.
    snapshots: (vaultId: string, noteId: string) =>
      request<ApiNoteSnapshot[]>(`/vaults/${vaultId}/notes/${noteId}/snapshots`),
    snapshotContent: (vaultId: string, noteId: string, snapshotId: string) =>
      request<{ content: string }>(`/vaults/${vaultId}/notes/${noteId}/snapshots/${snapshotId}`),
    // D6 — Note History (git log), only meaningful when `available` is true.
    history: (vaultId: string, noteId: string) =>
      request<{ available: boolean; entries: ApiHistoryEntry[] }>(`/vaults/${vaultId}/notes/${noteId}/history`),
    historyAt: (vaultId: string, noteId: string, hash: string) =>
      request<{ content: string }>(`/vaults/${vaultId}/notes/${noteId}/history/${hash}`),
  },

  plugins: {
    list: (vaultId: string) => request<ApiPlugin[]>(`/vaults/${vaultId}/plugins`),
    install: (vaultId: string, data: { manifest: ApiPlugin["manifest"]; mainJs: string }) =>
      request<ApiPlugin>(`/vaults/${vaultId}/plugins/install`, { method: "POST", body: JSON.stringify(data) }),
    update: (
      vaultId: string,
      pluginDbId: string,
      data: { enabled?: boolean; settings?: Record<string, unknown>; permissions?: string[] }
    ) =>
      request<ApiPlugin>(`/vaults/${vaultId}/plugins/${pluginDbId}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (vaultId: string, pluginDbId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/plugins/${pluginDbId}`, { method: "DELETE" }),
  },

  users: {
    exportData: () => request<Record<string, unknown>>("/users/me/export"),
    deleteAccount: (password: string) => request<{ ok: true }>("/users/me", { method: "DELETE", body: JSON.stringify({ password }) }),
    plan: () => request<ApiPlan>("/users/me/plan"),
    resendVerification: (locale?: Locale) =>
      request<{ ok: true; alreadyVerified?: boolean }>("/users/me/verification-email", { method: "POST", body: JSON.stringify({ locale }) }),
    /** Sends a confirmation link to `newEmail`; the address changes once it is followed. */
    changeEmail: (data: { newEmail: string; password: string; locale?: Locale }) =>
      request<{ ok: true }>("/users/me/email", { method: "POST", body: JSON.stringify(data) }),
    /** Accepts the Terms and Privacy Policy of `version` (lib/legal.ts); 409 terms_outdated when the server has a newer one. */
    acceptTerms: (version: string) =>
      request<{ ok: true; version: string }>("/users/me/terms", { method: "POST", body: JSON.stringify({ version }) }),
  },

  workspace: {
    getState: (vaultId: string) => request<ApiWorkspaceState>(`/vaults/${vaultId}/workspace-state`),
    updateState: (vaultId: string, data: Partial<ApiWorkspaceState>) =>
      request<ApiWorkspaceState>(`/vaults/${vaultId}/workspace-state`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },

  sync: {
    list: (vaultId: string) => syncListShared(vaultId),
    createGit: (
      vaultId: string,
      data: ApiSyncOptions & {
        providerType: Exclude<SyncProviderType, "webdav">;
        remoteUrl: string;
        branch?: string;
        username?: string;
        token: string;
      }
    ) => request<ApiSyncConnection>(`/vaults/${vaultId}/sync-connections`, { method: "POST", body: JSON.stringify(data) }),
    createWebdav: (
      vaultId: string,
      data: ApiSyncOptions & {
        providerType: "webdav";
        webdavUrl: string;
        webdavPath?: string;
        username: string;
        password: string;
      }
    ) => request<ApiSyncConnection>(`/vaults/${vaultId}/sync-connections`, { method: "POST", body: JSON.stringify(data) }),
    update: (
      vaultId: string,
      connectionId: string,
      patch: ApiSyncOptions & {
        remoteUrl?: string;
        branch?: string;
        username?: string;
        token?: string;
        webdavUrl?: string;
        webdavPath?: string;
        password?: string;
      }
    ) =>
      request<ApiSyncConnection>(`/vaults/${vaultId}/sync-connections/${connectionId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    resolve: (vaultId: string, connectionId: string, strategy: "web" | "remote") =>
      request<{ ok: true; queued: true }>(`/vaults/${vaultId}/sync-connections/${connectionId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ strategy }),
      }),
    pullOnOpen: (vaultId: string) =>
      request<{ ok: true; queued: number }>(`/vaults/${vaultId}/sync-connections/pull-on-open`, { method: "POST" }),
    remove: (vaultId: string, connectionId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/sync-connections/${connectionId}`, { method: "DELETE" }),
    test: (vaultId: string, connectionId: string) =>
      request<{ ok: boolean; error?: string }>(`/vaults/${vaultId}/sync-connections/${connectionId}/test`, { method: "POST" }),
    trigger: (vaultId: string, connectionId: string) =>
      request<{ ok: true; queued: true }>(`/vaults/${vaultId}/sync-connections/${connectionId}/trigger`, { method: "POST" }),
    status: (vaultId: string, connectionId: string, withRemote = false) =>
      request<{
        connection: ApiSyncConnection;
        latestJob: ApiSyncJob | null;
        changesSinceSync: number;
        remote: { remoteChanged: boolean; remoteReachable: boolean; error?: string } | null;
      }>(`/vaults/${vaultId}/sync-connections/${connectionId}/status${withRemote ? "?remote=1" : ""}`),
    log: (vaultId: string, connectionId: string) =>
      request<ApiSyncJob[]>(`/vaults/${vaultId}/sync-connections/${connectionId}/log`),
  },

  github: {
    user: (vaultId: string, src: GithubTokenSource) =>
      request<ApiGithubUser>(`/vaults/${vaultId}/github/user`, { method: "POST", body: JSON.stringify(src) }),
    repos: (vaultId: string, src: GithubTokenSource, page = 1) =>
      request<ApiGithubRepo[]>(`/vaults/${vaultId}/github/repos`, { method: "POST", body: JSON.stringify({ ...src, page }) }),
    createRepo: (vaultId: string, src: GithubTokenSource, name: string, isPrivate: boolean) =>
      request<ApiGithubRepo>(`/vaults/${vaultId}/github/repos/create`, {
        method: "POST",
        body: JSON.stringify({ ...src, name, private: isPrivate }),
      }),
    branches: (vaultId: string, src: GithubTokenSource, fullName: string) =>
      request<string[]>(`/vaults/${vaultId}/github/branches`, { method: "POST", body: JSON.stringify({ ...src, fullName }) }),
  },

  preferences: {
    get: () => request<ApiUserPreferences>("/users/me/preferences"),
    update: (data: Partial<ApiUserPreferences>) =>
      request<ApiUserPreferences>("/users/me/preferences", { method: "PUT", body: JSON.stringify(data) }),
  },

  attachments: {
    list: (vaultId: string) => request<ApiAttachmentList>(`/vaults/${vaultId}/attachments`),
    upload: (vaultId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<ApiAttachment>(`/vaults/${vaultId}/attachments`, { method: "POST", body: form });
    },
    remove: (vaultId: string, attachmentId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/attachments/${attachmentId}`, { method: "DELETE" }),
    updateMetadata: (vaultId: string, attachmentId: string, metadata: unknown) =>
      request<ApiAttachment>(`/vaults/${vaultId}/attachments/${attachmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ metadata }),
      }),
    // Not a fetch() call — this is a plain same-origin URL for <img src>/<a href>,
    // auth rides along via the existing httpOnly cookie, same as any other asset.
    downloadUrl: (vaultId: string, attachmentId: string) => `/api/v1/vaults/${vaultId}/attachments/${attachmentId}/download`,
  },

  diagnostics: {
    get: () =>
      request<{
        time: string;
        node: string;
        uptimeSeconds: number;
        git: { installed: boolean; version: string | null };
        storage: { configured: boolean; ok: boolean; endpoint: string; error?: string };
        database: { ok: boolean };
        redis: { ok: boolean };
        worker: { alive: boolean; lastHeartbeat: string | null; ageSeconds: number | null };
        scratchDisk: { freeMB: number; totalMB: number } | null;
        pdfService: { configured: boolean; ok: boolean };
      }>("/diagnostics"),
  },

  clipper: {
    list: () =>
      request<{ id: string; name: string; vaultId: string; vaultName: string; tokenHint: string; createdAt: string; lastUsedAt: string | null }[]>(
        "/users/me/clip-tokens"
      ),
    create: (name: string, vaultId: string) =>
      request<{ id: string; name: string; vaultId: string; tokenHint: string; token: string }>("/users/me/clip-tokens", {
        method: "POST",
        body: JSON.stringify({ name, vaultId }),
      }),
    revoke: (id: string) => request<{ ok: true }>(`/users/me/clip-tokens/${id}`, { method: "DELETE" }),
  },

  admin: {
    invites: {
      list: () => request<ApiInvite[]>("/admin/invites"),
      create: (data: { note: string; maxUses: number; expiresInDays?: number }) =>
        request<{ id: string; code: string }>("/admin/invites", { method: "POST", body: JSON.stringify(data) }),
      revoke: (id: string) => request<{ ok: true }>(`/admin/invites/${id}`, { method: "DELETE" }),
    },
    users: {
      list: (q: string, page: number) =>
        request<{ users: ApiAdminUser[]; total: number; page: number; pageSize: number }>(
          `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page) })}`
        ),
      update: (id: string, data: { planId?: string; locked?: boolean; role?: "user" | "admin" }) =>
        request<{ ok: true }>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
      passwordReset: (id: string) => request<{ ok: true }>(`/admin/users/${id}/password-reset`, { method: "POST", body: "{}" }),
      verifyEmail: (id: string) => request<{ ok: true }>(`/admin/users/${id}/verify-email`, { method: "POST", body: "{}" }),
      remove: (id: string) => request<{ ok: true }>(`/admin/users/${id}`, { method: "DELETE" }),
    },
    plans: () => request<{ id: string; name: string }[]>("/admin/plans"),
    stats: () => request<ApiUsageStats>("/admin/stats"),
    audit: (filter: { action?: string; email?: string; before?: string }) =>
      request<{ entries: ApiAuditEntry[]; next: string | null }>(
        `/admin/audit?${new URLSearchParams(Object.entries(filter).filter((e): e is [string, string] => !!e[1]))}`
      ),
  },

  usage: {
    /** Token and cost usage against this month's limits (the chat header's usage counter). */
    current: () => request<UsageSnapshot>("/usage/current"),
  },

  pdf: {
    /** Server-rendered PDF (headless Chromium) of a full HTML document built by lib/pdf-export.ts. */
    render: (vaultId: string, noteId: string, html: string, title: string) =>
      requestBlob(`/vaults/${vaultId}/notes/${noteId}/pdf`, { html, title }),
  },

  vaultTransfer: {
    importNotes: (vaultId: string, files: { path: string; content: string }[], onConflict: "skip" | "overwrite") =>
      request<{ created: number; updated: number; skipped: number; errors: { path: string; error: string }[] }>(
        `/vaults/${vaultId}/import/notes`,
        { method: "POST", body: JSON.stringify({ files, onConflict }) }
      ),
    finalize: (vaultId: string) =>
      request<{ ok: true; notes: number }>(`/vaults/${vaultId}/import/finalize`, { method: "POST" }),
    // Plain same-origin URL: the browser downloads the zip using the auth cookie.
    exportUrl: (vaultId: string) => `/api/v1/vaults/${vaultId}/export`,
  },

  trash: {
    list: (vaultId: string) => request<ApiTrash>(`/vaults/${vaultId}/trash`),
    restoreNote: (vaultId: string, noteId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/trash/notes/${noteId}/restore`, { method: "POST" }),
    restoreFolder: (vaultId: string, folderId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/trash/folders/${folderId}/restore`, { method: "POST" }),
    deleteNote: (vaultId: string, noteId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/trash/notes/${noteId}`, { method: "DELETE" }),
    deleteFolder: (vaultId: string, folderId: string) =>
      request<{ ok: true }>(`/vaults/${vaultId}/trash/folders/${folderId}`, { method: "DELETE" }),
    empty: (vaultId: string) => request<{ ok: true }>(`/vaults/${vaultId}/trash/empty`, { method: "POST" }),
  },
};

export { ApiError };
