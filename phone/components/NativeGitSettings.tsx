import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import * as Git from '@/lib/provider-sync';
import * as VaultOps from '@/lib/vault';
import { removeItem, KEYS } from '@/lib/storage';
import { oauthIO } from '@/lib/github-login';
import { login } from '../../packages/git-client/oauth';
export default function NativeGitSettings({ onChooseRepository }: { onChooseRepository?: () => void } = {}) {
  const { vault, refreshVaults, refreshFiles, settings, updateSettings } = useApp();
  const { colors } = useTheme();
  const [status, setStatus] = useState<Git.NativeStatus | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [remote, setRemote] = useState(vault?.gitRemote ?? ''), [branch, setBranch] = useState(vault?.gitBranch || 'main');
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [username, setUsername] = useState(''), [token, setToken] = useState(''), [key, setKey] = useState(''), [passphrase, setPassphrase] = useState(''), [fingerprint, setFingerprint] = useState('');
  const [clientId, setClientId] = useState(''), [brokerUrl, setBrokerUrl] = useState(''), [message, setMessage] = useState('');
  const [tab, setTab] = useState<'status' | 'github' | 'self-hosted' | 'options'>(vault?.gitRemote ? 'status' : 'github');
  const [githubMethod, setGithubMethod] = useState<'token' | 'app'>('token');
  const [serverMethod, setServerMethod] = useState<'https' | 'ssh'>(vault?.gitRemote && !vault.gitRemote.startsWith('https://') ? 'ssh' : 'https');
  const [appMethod, setAppMethod] = useState<'device' | 'browser'>('device');
  const [showChanges, setShowChanges] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const dir = vault ? Git.nativeDir(vault.path) : '';
  const read = async () => { if (vault) setStatus(await Git.native({ action: 'status', dir })); };
  useEffect(() => { let live = true; const poll = () => { if (vault) Git.native({ action: 'status', dir }).then(s => { if (live) setStatus(s); }).catch(e => { if (live) setError(String(e)); }); }; poll(); const t = setInterval(poll, 5000); return () => { live = false; clearInterval(t); controller.current?.abort(); }; }, [dir]);
  useEffect(() => { setRemote(vault?.gitRemote ?? ''); }, [vault?.gitRemote]);
  if (!vault) return null;
  async function task(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label); setError('');
    try { await fn(); await read(); refreshFiles(); } catch (e) { setError(String(e)); }
    finally { setBusy(''); }
  }
  const input = (label: string, value: string, set: (v: string) => void, secret = false, multiline = false) => <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.textMuted} value={value} onChangeText={set} secureTextEntry={secret} multiline={multiline} autoCapitalize="none" autoCorrect={false} style={{ color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, padding: 10, borderRadius: 6 }} />;
  const run = (action: string) => task(action, async () => {
    const result = action === 'pull' ? await Git.pull(vault.path, '', vault.gitRemote!, vault.gitBranch) : await Git.sync(vault.path, '', vault.gitRemote!, vault.gitBranch);
    if (result.errors.length) throw new Error(result.errors.join('\n'));
  });
  const resolve = (path: string, side: string) => Alert.alert('Resolve conflict', `Keep the ${side === 'ours' ? 'local' : 'remote'} version of ${path}? Original versions remain in Git history.`, [{ text: 'Cancel' }, { text: 'Keep version', onPress: () => task('Resolving conflict', () => Git.withEditor(() => Git.native({ action: 'resolve', dir, path, side }))) }]);
  const tabs = <T extends string,>(id: string, label: string, selected: T, change: (value: T) => void, items: { value: T; label: string }[]) => <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
    {items.map(item => <Pressable key={item.value} nativeID={`${id}-${item.value}`} accessibilityRole="tab" accessibilityState={{ selected: selected === item.value, disabled: !!busy }} disabled={!!busy} onPress={() => change(item.value)} style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: selected === item.value ? colors.accent : colors.bgSecondary }}><Text style={{ color: selected === item.value ? colors.bgPrimary : colors.textPrimary }}>{item.label}</Text></Pressable>)}
  </View>;
  const tokenFields = <>
    <Text style={{ color: colors.textMuted }}>{tab === 'github' ? 'Use a personal access token without creating a GitHub App. Tokens are stored securely on this device.' : 'Use your Git server username and access token. Credentials are stored securely on this device.'}</Text>
    {input('Username (optional for GitHub/GitLab)', username, setUsername)}
    {input('Personal access token', token, setToken, true)}
    <Button title="Save token" disabled={!!busy || !token.trim()} onPress={() => task('Saving token', async () => { await Git.saveCredentials(vault.id, { username: username.trim(), token: token.trim() }); setToken(''); })} />
    {tab === 'github' && onChooseRepository && <Button title="Choose a GitHub repository using a token" disabled={!!busy} onPress={onChooseRepository} />}
  </>;
  const sshFields = <>
    <Text style={{ color: colors.textMuted }}>Enter the SSH key and the server fingerprint you have verified.</Text>
    {input('SSH username', username, setUsername)}
    {input('SSH private key (PEM)', key, setKey, false, true)}
    {input('SSH passphrase', passphrase, setPassphrase, true)}
    {input('Trusted SHA256 host fingerprint', fingerprint, setFingerprint)}
    <Button title="Save SSH credentials" disabled={!!busy || !key.trim() || !fingerprint.trim()} onPress={() => task('Saving SSH credentials', async () => { await Git.saveCredentials(vault.id, { username: username.trim() || 'git', sshPrivateKey: key, sshPassphrase: passphrase || undefined, hostKeySha256: fingerprint.trim() }); setKey(''); setPassphrase(''); })} />
  </>;
  return <View style={{ padding: 16, gap: 10 }}>
    {tabs('git-setup', 'Git sync settings', tab, setTab, [{ value: 'status', label: 'Status' }, { value: 'github', label: 'GitHub' }, { value: 'self-hosted', label: 'Self-hosted' }, { value: 'options', label: 'Options' }])}
    {tab === 'status' && <>
    <Text style={{ color: colors.textPrimary }}>{busy || (status?.inProgress ? 'Syncing' : '') || (status?.conflicts.length ? 'Paused: conflicts' : 'Ready')} · {status?.branch ?? 'No branch'}</Text>
    <Text style={{ color: colors.textPrimary }}>Last successful sync: {status?.sync.lastSuccess ? new Date(status.sync.lastSuccess * 1000).toLocaleString() : 'Never'}</Text>
    <Text style={{ color: colors.textPrimary }}>{status?.changes ?? 0} changed · {status?.ahead ?? 0} ahead · {status?.behind ?? 0} behind</Text>
    {!!(error || status?.sync.lastError) && <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{error || status?.sync.lastError}</Text>}
    <Button title={showChanges ? "Hide changed files" : "Show changed files"} onPress={() => setShowChanges(v => !v)} />
    {showChanges && status?.changedFiles.map(p => <Text key={p} style={{ color: colors.textPrimary }}>{p}</Text>)}
    {status?.conflicts.map(path => <View key={path}><Text style={{ color: colors.textPrimary }}>{path}</Text><Button title="Keep local" disabled={!!busy} onPress={() => resolve(path, 'ours')} /><Button title="Keep remote" disabled={!!busy} onPress={() => resolve(path, 'theirs')} /></View>)}
    {status?.mergePending && !status.conflicts.length && <Button title="Finish resolved merge" disabled={!!busy} onPress={() => task('Finishing merge', () => Git.withEditor(() => Git.native({ action: 'finishMerge', dir })))} />}
    <Button title="Sync now" disabled={!!busy || !vault.gitRemote || !!status?.conflicts.length} onPress={() => run('sync')} />
    <Button title="Disconnect remote" disabled={!!busy || !vault.gitRemote} onPress={() => task('Disconnecting', async () => {
      await removeItem(KEYS.GIT_CREDENTIALS(vault.id)); await removeItem(KEYS.GIT_TOKEN(vault.id)); await removeItem(KEYS.GITHUB_TOKEN(vault.id));
      if (status?.isRepo) await Git.native({ action: 'remote', dir, remote: '' });
      await VaultOps.updateVault(vault.id, { gitRemote: null, autoSync: false }); await refreshVaults();
    })} />

    </>}
    {(tab === 'github' || tab === 'self-hosted') && <>
      <Text style={{ color: colors.textPrimary, fontWeight: 'bold', fontSize: 17 }}>{tab === 'github' ? 'Connect GitHub' : 'Connect your Git server'}</Text>
      {tab === 'github' ? tabs('github-method', 'GitHub connection method', githubMethod, setGithubMethod, [{ value: 'token', label: 'Personal access token' }, { value: 'app', label: 'GitHub App' }]) : tabs('server-method', 'Server connection method', serverMethod, setServerMethod, [{ value: 'https', label: 'HTTPS token' }, { value: 'ssh', label: 'SSH key' }])}
    {input('Remote HTTPS or SSH URL', remote, setRemote)}
    {input('Branch (used when initializing a vault)', branch, setBranch)}
    <Button title="Save remote" disabled={!!busy || !remote.trim()} onPress={() => task('Saving remote', async () => {
      if (!status?.isRepo) await Git.native({ action: 'init', dir, branch });
      await Git.native({ action: 'remote', dir, remote: remote.trim() });
      if (vault.gitRemote !== remote.trim()) { await removeItem(KEYS.GIT_CREDENTIALS(vault.id)); await removeItem(KEYS.GIT_TOKEN(vault.id)); await removeItem(KEYS.GITHUB_TOKEN(vault.id)); }
      await VaultOps.updateVault(vault.id, { gitRemote: remote.trim(), gitBranch: branch }); await refreshVaults();
    })} />

      {tab === 'github' && githubMethod === 'token' && tokenFields}
      {tab === 'github' && githubMethod === 'app' && <>
    <Text style={{ color: colors.textPrimary }}>GitHub App sign-in</Text>
    {tabs('github-app-method', 'GitHub App sign-in method', appMethod, setAppMethod, [{ value: 'device', label: 'Device code' }, { value: 'browser', label: 'Browser OAuth' }])}
    {input('GitHub App client ID', clientId, setClientId)} {appMethod === 'browser' && input('Trusted OAuth broker HTTPS URL', brokerUrl, setBrokerUrl)}
    <Text style={{ color: colors.textMuted }}>{appMethod === 'device' ? 'Enter the code in GitHub to sign in. No backend is needed.' : 'Your trusted broker exchanges and refreshes the tokens.'}</Text>
    <Button title="Sign in with GitHub" disabled={!!busy || !clientId.trim() || (appMethod === 'browser' && !brokerUrl.trim())} onPress={() => task('GitHub sign-in', async () => {
      const config = { clientId: clientId.trim(), brokerUrl: appMethod === 'browser' ? brokerUrl.trim() : undefined };
      controller.current = new AbortController();
      const auth = await login(config, oauthIO, controller.current.signal, setMessage);
      await Git.saveCredentials(vault.id, { username: 'x-access-token', token: auth.accessToken, oauth: { config, token: auth } });
      setMessage('Signed in with GitHub');
    })} />
    {busy === 'GitHub sign-in' && <Button title="Cancel login" onPress={() => controller.current?.abort()} />}
    <Text style={{ color: colors.textPrimary }}>{message}</Text>

      </>}
      {tab === 'self-hosted' && serverMethod === 'https' && tokenFields}
      {tab === 'self-hosted' && serverMethod === 'ssh' && sshFields}
    </>}
    {tab === 'options' && <>
      <Text style={{ color: colors.textPrimary, fontWeight: 'bold' }}>Git author</Text>
    {input('Git author name', name, setName)} {input('Git author email', email, setEmail)}
    <Button title="Save author" disabled={!!busy} onPress={() => task('Saving author', async () => { if (!status?.isRepo) await Git.native({ action: 'init', dir, branch }); await Git.native({ action: 'identity', dir, name, email }); })} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={{ color: colors.textPrimary }}>Automatic sync</Text><Switch value={vault.autoSync} disabled={!!busy} onValueChange={value => task('Saving auto-sync', async () => { if (value && settings.gitSyncInterval <= 0) await updateSettings({ gitSyncInterval: 60 }); await VaultOps.updateVault(vault.id, { autoSync: value }); await refreshVaults(); })} /></View>
    <Text style={{ color: colors.textMuted }}>Automatic sync uses the configured interval, with a minimum of one minute.</Text>

    </>}
    {tab !== 'status' && !!busy && <Text accessibilityLiveRegion="polite" style={{ color: colors.textPrimary }}>{busy}...</Text>}
    {tab !== 'status' && !!error && <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{error}</Text>}
  </View>;
}
