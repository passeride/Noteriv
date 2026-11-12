// Provider-independent Git protocol; no per-file forge API sync.
import { GitProvider } from '@/types';
import { getItem, setItem, KEYS } from './storage';
import { getVaults } from './vault';
import { refresh, type OAuthConfig, type OAuthToken, type OAuthIO } from '../../packages/git-client/oauth';

export type SyncProvider = GitProvider;
export interface NativeStatus {
  isRepo: boolean; branch: string | null; remote: string | null;
  inProgress: boolean; pulled: number; pushed: number;
  changes: number; changedFiles: string[]; conflicts: string[];
  ahead: number; behind: number; mergePending: boolean;
  sync: { lastSuccess: number | null; lastError: string | null };
}
export interface Credentials {
  origin?: string; username?: string; token?: string; sshPrivateKey?: string; sshPassphrase?: string; hostKeySha256?: string;
  oauth?: { config: OAuthConfig; token: OAuthToken };
}
export interface SyncResult { pulled: number; pushed: number; errors: string[]; conflicts?: string[] }
export function detectProvider(remote: string, hint?: SyncProvider): SyncProvider | null {
  if (hint) return hint;
  let host = '';
  try { host = new URL(remote).hostname; } catch { host = remote.match(/@([^:/]+)/)?.[1] ?? ''; }
  if (host === 'github.com') return 'github';
  if (host.includes('gitlab')) return 'gitlab';
  if (/gitea|forgejo|codeberg/.test(host)) return 'gitea';
  return null; // native Git accepts this URL without knowing the forge
}
export async function getVaultToken(id: string): Promise<string | null> {
  const credentials = await getItem<Credentials>(KEYS.GIT_CREDENTIALS(id));
  return credentials?.token ?? (await getItem<string>(KEYS.GIT_TOKEN(id))) ?? await getItem<string>(KEYS.GITHUB_TOKEN(id));
}
function remoteOrigin(remote: string): string {
  try { const url = new URL(remote); return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'https:' ? '443' : '22')}`; }
  catch { return `ssh://${remote.match(/@([^:]+)/)?.[1]?.toLowerCase() ?? ''}:22`; }
}
export async function saveCredentials(id: string, value: Credentials): Promise<void> {
  const vault = (await getVaults()).find(v => v.id === id);
  if (!vault) throw new Error('Unknown vault');
  const origin = value.oauth ? 'https://github.com:443' : vault.gitRemote ? remoteOrigin(vault.gitRemote) : undefined;
  await setItem(KEYS.GIT_CREDENTIALS(id), { ...value, origin });
}
export async function native<T = NativeStatus>(request: Record<string, unknown>): Promise<T> {
  // Dynamic import keeps Expo Go usable for local notes, but sync requires a native build.
  let module;
  try { module = (await import('../modules/noteriv-git')).default; }
  catch { throw new Error('Git sync requires a Noteriv native build with the Git module; it is unavailable in Expo Go'); }
  const response = JSON.parse(await module.execute(JSON.stringify(request)));
  if (!response.ok) throw new Error(response.error || 'Git operation failed');
  return response.value as T;
}
export function nativeDir(uri: string): string {
  if (!uri.startsWith('file://')) throw new Error('Git vaults must use local app storage');
  return decodeURIComponent(uri.slice('file://'.length)).replace(/\/$/, '');
}
// The secure store is read only at the adapter boundary; never store secrets in a vault.
export async function vaultCredentials(id: string, io?: OAuthIO): Promise<Credentials> {
  const credentials = await getItem<Credentials>(KEYS.GIT_CREDENTIALS(id)) ?? { token: await getVaultToken(id) ?? '' };
  if (credentials.oauth && io) {
    const updated = await refresh(credentials.oauth.config, credentials.oauth.token, io);
    if (updated !== credentials.oauth.token) {
      credentials.oauth.token = updated; credentials.token = updated.accessToken;
      await saveCredentials(id, credentials);
    }
  }
  return credentials;
}
let hooks: { before: () => Promise<void>; after: () => Promise<void> } | undefined;
let oauthIO: OAuthIO | undefined;
export async function withEditor<T>(work: () => Promise<T>): Promise<T> {
  await hooks?.before();
  try { return await work(); } finally { await hooks?.after(); }
}
export function setOAuthIO(io: OAuthIO): void { oauthIO = io; }
export function setSyncHooks(value: typeof hooks): void { hooks = value; }
const running = new Set<string>();
async function run(action: string, vaultPath: string, token: string, remote: string, branch?: string): Promise<SyncResult> {
  if (running.has(vaultPath)) return { pulled: 0, pushed: 0, errors: ['Another sync is already running'] };
  running.add(vaultPath);
  let started = false;
  try {
    await hooks?.before(); started = true;
    const dir = nativeDir(vaultPath);
    const vault = (await getVaults()).find(v => v.path === vaultPath);
    if (!vault) throw new Error('Unknown vault');
    const credentials = await vaultCredentials(vault.id, oauthIO);
    // Legacy callers pass an ephemeral token while connecting a new remote.
    if (token) credentials.token = credentials.oauth ? credentials.token : token;
    const before = await native({ action: 'status', dir });
    if (!before.isRepo) {
      await native({ action: 'init', dir, branch: branch || 'main' });
      await native({ action: 'remote', dir, remote });
    } else if (before.remote !== remote) {
      // Changing the server must be accompanied by explicitly saved credentials.
      await native({ action: 'remote', dir, remote });
    }
    const status = await native({ action, dir, credentials });
    return { pulled: status.pulled, pushed: status.pushed, conflicts: status.conflicts,
      errors: status.conflicts.length ? [`Sync paused: ${status.conflicts.length} file(s) have conflicts. Resolve them in Settings.`] : [] };
  } catch (error) { return { pulled: 0, pushed: 0, errors: [error instanceof Error ? error.message : String(error)] }; }
  finally { try { if (started) await hooks?.after(); } finally { running.delete(vaultPath); } }
}
export async function sync(v: string, t: string, r: string, b?: string, _hint?: SyncProvider): Promise<SyncResult> { return run('sync', v, t, r, b); }
export async function pull(v: string, t: string, r: string, b?: string, _hint?: SyncProvider): Promise<SyncResult> { return run('pull', v, t, r, b); }
export async function push(v: string, t: string, r: string, b?: string, _hint?: SyncProvider): Promise<SyncResult> { return run('push', v, t, r, b); }
export async function freshClone(_v: string, _t: string, _r: string, _b?: string, _hint?: SyncProvider): Promise<SyncResult> {
  return { pulled: 0, pushed: 0, errors: ['Create a new vault to clone a fresh working copy. Existing notes are never deleted by sync.'] };
}
