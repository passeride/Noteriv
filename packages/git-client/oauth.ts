// Shared native-client OAuth state machine. No client secret is shipped in apps.
export interface OAuthConfig { clientId: string; brokerUrl?: string }
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
}
export interface OAuthIO {
  post: (url: string, body: Record<string, string>) => Promise<Record<string, unknown>>;
  random: () => Promise<string>;
  sha256: (value: string) => Promise<string>; // base64url, no padding
  open: (url: string) => Promise<unknown>;
}
const github = 'https://github.com';
function token(data: Record<string, unknown>): OAuthToken {
  if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('GitHub did not return an access token');
  const now = Date.now();
  return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expiresAt: typeof data.expires_in === 'number' ? now + data.expires_in * 1000 : undefined,
    refreshExpiresAt: typeof data.refresh_token_expires_in === 'number' ? now + data.refresh_token_expires_in * 1000 : undefined };
}
function broker(config: OAuthConfig): string {
  const url = new URL(config.brokerUrl!);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('OAuth broker must use HTTPS without URL credentials');
  return url.toString().replace(/\/$/, '');
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Login cancelled')); return; }
    const abort = () => { clearTimeout(timer); reject(new Error('Login cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export async function login(config: OAuthConfig, io: OAuthIO, signal: AbortSignal, show: (message: string) => void): Promise<OAuthToken> {
  if (!config.clientId.trim()) throw new Error('Enter the GitHub App client ID first');
  if (config.brokerUrl) {
    const base = broker(config), state = await io.random(), verifier = await io.random(), claim = await io.random();
    const challenge = await io.sha256(verifier);
    const session = await io.post(`${base}/sessions`, { state, codeChallenge: challenge, claimHash: await io.sha256(claim) });
    const authorize = new URL(String(session.authorizeUrl));
    if (authorize.origin !== github || authorize.pathname !== '/login/oauth/authorize' || authorize.searchParams.get('state') !== state || authorize.searchParams.get('client_id') !== config.clientId || authorize.searchParams.get('code_challenge') !== challenge || authorize.searchParams.get('code_challenge_method') !== 'S256' || authorize.searchParams.get('redirect_uri') !== `${base}/callback`) throw new Error('Invalid authorization response from broker');
    await io.open(authorize.toString());
    show('Complete GitHub sign-in in your browser.');
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      await wait(2000, signal);
      const result = await io.post(`${base}/sessions/${state}/claim`, { claim, verifier });
      if (result.pending === true) continue;
      if (result.error) throw new Error(String(result.error));
      if (signal.aborted) throw new Error('Login cancelled');
      return token(result);
    }
  } else {
    const device = await io.post(`${github}/login/device/code`, { client_id: config.clientId });
    if (device.error || typeof device.device_code !== 'string' || typeof device.user_code !== 'string') throw new Error('Could not start Device Flow. Enable it in your GitHub App settings.');
    const verification = new URL(String(device.verification_uri));
    if (verification.origin !== github || verification.pathname !== '/login/device') throw new Error('Invalid GitHub verification URL');
    show(`Enter ${device.user_code} at github.com/login/device`);
    const deadline = Date.now() + Math.min(900, Math.max(1, Number(device.expires_in) || 900)) * 1000;
    await io.open(verification.toString());
    let interval = Math.max(5, Number(device.interval) || 5);
    while (Date.now() < deadline) {
      await wait(interval * 1000, signal);
      const result = await io.post(`${github}/login/oauth/access_token`, { client_id: config.clientId, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      if (result.error === 'authorization_pending') continue;
      if (result.error === 'slow_down') { interval += 5; continue; }
      if (result.error) throw new Error(`GitHub login: ${String(result.error)}`);
      if (signal.aborted) throw new Error('Login cancelled');
      return token(result);
    }
  }
  throw new Error('GitHub login expired; start again');
}
export async function refresh(config: OAuthConfig, old: OAuthToken, io: OAuthIO): Promise<OAuthToken> {
  if (!old.expiresAt || old.expiresAt > Date.now() + 60_000) return old;
  if (!old.refreshToken || (old.refreshExpiresAt && old.refreshExpiresAt <= Date.now())) throw new Error('GitHub login expired; sign in again');
  const result = await io.post(config.brokerUrl ? `${broker(config)}/refresh` : `${github}/login/oauth/access_token`,
    { client_id: config.clientId, grant_type: 'refresh_token', refresh_token: old.refreshToken });
  if (result.error) throw new Error('GitHub login expired; sign in again');
  return token(result);
}
