import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import * as Git from '@/lib/provider-sync';
import * as VaultOps from '@/lib/vault';
import { removeItem, KEYS } from '@/lib/storage';
import { oauthIO } from '@/lib/github-login';
import { login } from '../../packages/git-client/oauth';
export default function NativeGitSettings() {
  const { vault, refreshVaults, refreshFiles } = useApp();
  const { colors } = useTheme();
  const [status, setStatus] = useState<Git.NativeStatus | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [remote, setRemote] = useState(vault?.gitRemote ?? ''), [branch, setBranch] = useState(vault?.gitBranch || 'main');
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [username, setUsername] = useState(''), [token, setToken] = useState(''), [key, setKey] = useState(''), [passphrase, setPassphrase] = useState(''), [fingerprint, setFingerprint] = useState('');
  const [clientId, setClientId] = useState(''), [brokerUrl, setBrokerUrl] = useState(''), [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const dir = vault ? Git.nativeDir(vault.path) : '';
  const read = async () => { if (vault) setStatus(await Git.native({ action: 'status', dir })); };
  useEffect(() => { let live = true; const poll = () => { if (vault) Git.native({ action: 'status', dir }).then(s => { if (live) setStatus(s); }).catch(e => { if (live) setError(String(e)); }); }; poll(); const t = setInterval(poll, 5000); return () => { live = false; clearInterval(t); controller.current?.abort(); }; }, [dir]);
  if (!vault) return null;
  async function task(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label); setError('');
    try { await fn(); await read(); refreshFiles(); } catch (e) { setError(String(e)); }
    finally { setBusy(''); }
  }
  const input = (label: string, value: string, set: (v: string) => void, secret = false) => <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.textMuted} value={value} onChangeText={set} secureTextEntry={secret} autoCapitalize="none" autoCorrect={false} style={{ color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, padding: 10, borderRadius: 6 }} />;
  const run = (action: string) => task(action, async () => {
    const result = action === 'pull' ? await Git.pull(vault.path, '', vault.gitRemote!, vault.gitBranch) : await Git.sync(vault.path, '', vault.gitRemote!, vault.gitBranch);
    if (result.errors.length) throw new Error(result.errors.join('\n'));
  });
  const resolve = (path: string, side: string) => Alert.alert('Resolve conflict', `Keep the ${side === 'ours' ? 'local' : 'remote'} version of ${path}? Original versions remain in Git history.`, [{ text: 'Cancel' }, { text: 'Keep version', onPress: () => task('Resolving conflict', () => Git.withEditor(() => Git.native({ action: 'resolve', dir, path, side }))) }]);
  return <View style={{ padding: 16, gap: 10 }}>
    <Text style={{ color: colors.textPrimary, fontWeight: 'bold', fontSize: 18 }}>Git sync</Text>
    <Text style={{ color: colors.textPrimary }}>{busy || (status?.conflicts.length ? 'Paused: conflicts' : 'Ready')} · {status?.branch ?? 'No branch'}</Text>
    <Text style={{ color: colors.textPrimary }}>Last successful sync: {status?.sync.lastSuccess ? new Date(status.sync.lastSuccess * 1000).toLocaleString() : 'Never'}</Text>
    <Text style={{ color: colors.textPrimary }}>{status?.changes ?? 0} changed · {status?.ahead ?? 0} ahead · {status?.behind ?? 0} behind</Text>
    {!!(error || status?.sync.lastError) && <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{error || status?.sync.lastError}</Text>}
    {status?.changedFiles.map(p => <Text key={p} style={{ color: colors.textPrimary }}>{p}</Text>)}
    {status?.conflicts.map(path => <View key={path}><Text style={{ color: colors.textPrimary }}>{path}</Text><Button title="Keep local" disabled={!!busy} onPress={() => resolve(path, 'ours')} /><Button title="Keep remote" disabled={!!busy} onPress={() => resolve(path, 'theirs')} /></View>)}
    <Button title="Sync now" disabled={!!busy || !vault.gitRemote || !!status?.conflicts.length} onPress={() => run('sync')} />
    {input('Remote HTTPS or SSH URL', remote, setRemote)}
    {input('Branch (used when initializing a vault)', branch, setBranch)}
    <Button title="Save remote" disabled={!!busy || !remote.trim()} onPress={() => task('Saving remote', async () => {
      if (!status?.isRepo) await Git.native({ action: 'init', dir, branch });
      await Git.native({ action: 'remote', dir, remote: remote.trim() });
      if (vault.gitRemote !== remote.trim()) { await removeItem(KEYS.GIT_CREDENTIALS(vault.id)); await removeItem(KEYS.GIT_TOKEN(vault.id)); await removeItem(KEYS.GITHUB_TOKEN(vault.id)); }
      await VaultOps.updateVault(vault.id, { gitRemote: remote.trim(), gitBranch: branch }); await refreshVaults();
    })} />
    {input('Git author name', name, setName)} {input('Git author email', email, setEmail)}
    <Button title="Save author" disabled={!!busy} onPress={() => task('Saving author', async () => { if (!status?.isRepo) await Git.native({ action: 'init', dir, branch }); await Git.native({ action: 'identity', dir, name, email }); })} />
    <Text style={{ color: colors.textPrimary }}>HTTPS token or SSH key (stored securely on this device)</Text>
    {input('Username (HTTPS or SSH)', username, setUsername)} {input('HTTPS access token', token, setToken, true)}
    {input('SSH private key (PEM)', key, setKey, true)} {input('SSH passphrase', passphrase, setPassphrase, true)} {input('Trusted SHA256 host fingerprint', fingerprint, setFingerprint)}
    <Button title="Save credentials" disabled={!!busy} onPress={() => task('Saving credentials', async () => { await Git.saveCredentials(vault.id, { username, token, sshPrivateKey: key || undefined, sshPassphrase: passphrase || undefined, hostKeySha256: fingerprint || undefined }); setToken(''); setKey(''); setPassphrase(''); })} />
    <Text style={{ color: colors.textPrimary }}>GitHub App sign-in</Text>
    {input('GitHub App client ID', clientId, setClientId)} {input('Trusted OAuth broker HTTPS URL (optional)', brokerUrl, setBrokerUrl)}
    <Text style={{ color: colors.textMuted }}>Leave the broker blank for Device Flow. A broker receives your tokens during exchange and refresh.</Text>
    <Button title="Sign in with GitHub" disabled={!!busy || !clientId.trim()} onPress={() => task('GitHub sign-in', async () => {
      const config = { clientId: clientId.trim(), brokerUrl: brokerUrl.trim() || undefined };
      controller.current = new AbortController();
      const auth = await login(config, oauthIO, controller.current.signal, setMessage);
      await Git.saveCredentials(vault.id, { username: 'x-access-token', token: auth.accessToken, oauth: { config, token: auth } });
      setMessage('Signed in with GitHub');
    })} />
    {busy === 'GitHub sign-in' && <Button title="Cancel login" onPress={() => controller.current?.abort()} />}
    <Text style={{ color: colors.textPrimary }}>{message}</Text>
  </View>;
}
