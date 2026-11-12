// Optional, self-hosted GitHub App code exchange. Node 22+, no dependencies.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const hash = value => createHash('sha256').update(value).digest('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
export function authServer({ clientId, clientSecret, publicUrl, exchange, now = Date.now }) {
  const base = new URL(publicUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('PUBLIC_URL must be an HTTPS origin');
  if (!clientId || !clientSecret) throw new Error('GitHub App client ID and secret are required');
  const redirectUri = `${base.origin}/callback`;
  const sessions = new Map(), rates = new Map();
  const postGitHub = exchange ?? (async body => {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, client_id: clientId, client_secret: clientSecret }),
    });
    if (!response.ok) throw new Error('GitHub token exchange failed');
    const data = await response.json();
    if (data.error || !data.access_token) throw new Error('GitHub rejected the authorization');
    return data;
  });
  return createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      // Trust the socket, not a caller-controlled X-Forwarded-For header.
      const ip = req.socket.remoteAddress;
      for (const [key, item] of sessions) if (item.expires <= now()) sessions.delete(key);
      for (const [key, item] of rates) if (item.until <= now()) rates.delete(key);
      const rate = rates.get(ip) ?? { count: 0, until: now() + 60_000 };
      if (++rate.count > 100 || rates.size > 10_000) return send(429, { error: 'Too many requests' });
      rates.set(ip, rate);
      const url = new URL(req.url, base.origin);
      if (req.method === 'GET' && url.pathname === '/callback') {
        const state = url.searchParams.get('state'), session = sessions.get(state);
        if (!session || session.code || !url.searchParams.get('code') || url.searchParams.has('error')) return send(400, { error: 'Invalid or expired login' });
        session.code = url.searchParams.get('code');
        return send(200, { message: 'GitHub sign-in received. Return to Noteriv.' });
      }
      if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') return send(405, { error: 'Use JSON POST' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 8192) return send(413, { error: 'Request too large' }); }
      const data = JSON.parse(body);
      if (url.pathname === '/sessions') {
        if (!opaque(data.state) || !opaque(data.codeChallenge) || !opaque(data.claimHash) || sessions.has(data.state)) return send(400, { error: 'Invalid session' });
        if (sessions.size >= 1000) return send(429, { error: 'Too many sessions' });
        sessions.set(data.state, { challenge: data.codeChallenge, claimHash: data.claimHash, expires: now() + 600_000 });
        const authorize = new URL('https://github.com/login/oauth/authorize');
        for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, state: data.state, code_challenge: data.codeChallenge, code_challenge_method: 'S256' })) authorize.searchParams.set(k, v);
        return send(200, { authorizeUrl: authorize.toString() });
      }
      const match = url.pathname.match(/^\/sessions\/([A-Za-z0-9_-]{43,128})\/claim$/);
      if (match) {
        const session = sessions.get(match[1]);
        if (!session || !opaque(data.claim) || !opaque(data.verifier) || !equal(hash(data.claim), session.claimHash) || !equal(hash(data.verifier), session.challenge)) return send(400, { error: 'Invalid or expired login' });
        if (!session.code) return send(200, { pending: true });
        sessions.delete(match[1]); // single use, including exchange failure
        const tokens = await postGitHub({ code: session.code, code_verifier: data.verifier, redirect_uri: redirectUri });
        return send(200, tokens);
      }
      if (url.pathname === '/refresh') {
        if (typeof data.refresh_token !== 'string' || data.refresh_token.length > 512) return send(400, { error: 'Invalid refresh token' });
        return send(200, await postGitHub({ grant_type: 'refresh_token', refresh_token: data.refresh_token }));
      }
      return send(404, { error: 'Not found' });
    } catch { send(400, { error: 'Authorization failed; start sign-in again' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  authServer({ clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET, publicUrl: process.env.PUBLIC_URL }).listen(Number(process.env.PORT || 8787), '127.0.0.1');
}
