"use client";
import { useEffect, useRef, useState } from 'react';
import { login, type OAuthConfig, type OAuthIO } from '../../../packages/git-client/oauth';
interface Status {
  inProgress: boolean; isRepo: boolean; changes: number; changedFiles: string[]; conflicts: string[];
  branch: string | null; ahead: number; behind: number; mergePending: boolean;
  sync: { lastSuccess: number | null; lastError: string | null };
}
export default function GitSyncPanel({ vault, before, section = "status" }: { vault: Vault; before: () => Promise<void>; section?: "status" | "author" | "ssh" | "github" }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [username, setUsername] = useState('git'), [key, setKey] = useState(''), [passphrase, setPassphrase] = useState(''), [fingerprint, setFingerprint] = useState('');
  const [clientId, setClientId] = useState(''), [brokerUrl, setBrokerUrl] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [appMethod, setAppMethod] = useState<'device' | 'browser'>('device');
  const controller = useRef<AbortController | null>(null);
  const read = async () => {
    const value = await window.electronAPI!.gitNative<Status>({ action: 'status', dir: vault.path }, vault.id);
    setStatus(value);
  };
  useEffect(() => {
    let live = true;
    const refresh = () => window.electronAPI?.gitNative<Status>({ action: 'status', dir: vault.path }, vault.id).then(s => { if (live) setStatus(s); }).catch(e => { if (live) setError(String(e)); });
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { live = false; clearInterval(timer); controller.current?.abort(); };
  }, [vault.id, vault.path]);
  async function task(label: string, work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label); setError('');
    try { await work(); } catch (e) { setError(String(e)); }
    finally { try { await read(); } catch (e) { setError(String(e)); } setBusy(''); }
  }
  const run = (action: string, extra: Record<string, unknown> = {}) => task(action, async () => {
    await before();
    if (!status?.isRepo) await window.electronAPI!.gitInit(vault.path);
    await window.electronAPI!.gitNative({ action, dir: vault.path, ...extra }, vault.id);
  });
  const signIn = () => task('GitHub sign-in', async () => {
    const config: OAuthConfig = { clientId: clientId.trim(), brokerUrl: appMethod === 'browser' ? brokerUrl.trim() : undefined };
    const io: OAuthIO = {
      post: (url, body) => window.electronAPI!.authOAuthHttp(url, body),
      random: async () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join(''),
      sha256: async value => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      open: url => window.electronAPI!.openExternal(url),
    };
    controller.current = new AbortController();
    const token = await login(config, io, controller.current.signal, setLoginMessage);
    if (controller.current.signal.aborted) return;
    await window.electronAPI!.gitSaveCredentials(vault.id, { username: 'x-access-token', token: token.accessToken, oauth: { config, token } });
    setLoginMessage('Signed in. Access is limited to the GitHub App’s installed repositories.');
  });
  const input = (placeholder: string, value: string, change: (v: string) => void, secret = false) => <input className="st-text-input" aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => change(e.target.value)} type={secret ? 'password' : 'text'} autoComplete="off" />;
  return <div style={{ padding: '12px 0', display: 'grid', gap: 10 }}>
    {section !== "status" && error && <div role="alert">{error}</div>}
    {section !== "status" && busy && <div role="status" aria-live="polite">{busy}...</div>}
    {section === "status" && <>
    <div className="st-group-label">Sync status</div>
    <div role="status" aria-live="polite">{busy || (status?.inProgress ? 'Syncing' : '') || (status?.conflicts.length ? 'Paused: conflicts need attention' : 'Ready')} · {status?.branch || 'No branch'} · {status?.ahead ?? 0} ahead / {status?.behind ?? 0} behind</div>
    <div>Last successful sync: {status?.sync.lastSuccess ? new Date(status.sync.lastSuccess * 1000).toLocaleString() : 'Never'}</div>
    {(error || status?.sync.lastError) && <div role="alert">{error || status?.sync.lastError}</div>}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{['fetch', 'commit', 'pull', 'push', 'sync'].map(action => <button className="st-test-btn" key={action} disabled={!!busy || !!status?.conflicts.length} onClick={() => run(action)}>{action}</button>)}</div>
    <details><summary>{status?.changes ?? 0} changed files</summary><ul>{status?.changedFiles.map(path => <li key={path}>{path}</li>)}</ul></details>
    {!!status?.conflicts.length && <div><p>Choose which version to keep for each file. Both original versions remain in Git history. A recovery copy of the current working file is kept before replacement.</p>{status.conflicts.map(path => <div key={path} style={{ margin: '8px 0' }}><code>{path}</code> <button disabled={!!busy} onClick={() => run('resolve', { path, side: 'ours' })}>Keep local</button> <button disabled={!!busy} onClick={() => run('resolve', { path, side: 'theirs' })}>Keep remote</button></div>)}</div>}
    {status?.mergePending && !status.conflicts.length && <button disabled={!!busy} onClick={() => run('finishMerge')}>Finish resolved merge</button>}
    </>}
    {section === "author" && <section aria-label="Git author" style={{ display: 'grid', gap: 10 }}><div className="st-group-label">Git author</div><p>Used for commits on this device.</p>{input('Author name', name, setName)} {input('Author email', email, setEmail)} <button disabled={!!busy} onClick={() => run('identity', { name, email })}>Save author</button></section>}
    {section === "ssh" && <section aria-label="SSH credentials" style={{ display: 'grid', gap: 10 }}><div className="st-group-label">SSH credentials</div><p>Leave the private key blank to use the desktop SSH agent. Verify the server’s SHA256 fingerprint through a trusted source.</p>
      {input('SSH username', username, setUsername)} {input('SHA256 host fingerprint', fingerprint, setFingerprint)}
      <textarea aria-label="SSH private key" placeholder="SSH private key (optional)" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" />
      {input('SSH key passphrase', passphrase, setPassphrase, true)}
      <button disabled={!!busy || !fingerprint.trim()} onClick={() => task('Saving SSH credentials', async () => { await window.electronAPI!.gitSaveCredentials(vault.id, { username, sshPrivateKey: key || null, sshPassphrase: passphrase || null, hostKeySha256: fingerprint.trim() }); setKey(''); setPassphrase(''); })}>Save in OS credential store</button>
    </section>}
    {section === "github" && <section aria-label="GitHub App" style={{ display: 'grid', gap: 10 }}><div className="st-group-label">Sign in with GitHub App</div><p>Enter your GitHub App client ID and choose how to sign in.</p>
      <label className="st-row-label">Sign-in method <select className="st-select" value={appMethod} disabled={!!busy} onChange={e => setAppMethod(e.target.value as 'device' | 'browser')}><option value="device">Device code (no backend)</option><option value="browser">Browser OAuth</option></select></label>
      <div style={{ display: 'grid', gap: 10 }}>
      {input('GitHub App client ID', clientId, setClientId)} {appMethod === 'browser' && input('OAuth broker HTTPS URL', brokerUrl, setBrokerUrl)}
      <p>{appMethod === 'device' ? 'Enter the code in GitHub. No backend is needed.' : 'Your trusted broker exchanges and refreshes the tokens.'}</p>
      <button disabled={!!busy || !clientId.trim() || (appMethod === 'browser' && !brokerUrl.trim())} onClick={signIn}>Sign in with GitHub</button> {busy === 'GitHub sign-in' && <button onClick={() => controller.current?.abort()}>Cancel</button>}
      <div role="status">{loginMessage}</div>
      </div>
    </section>}
  </div>;
}
