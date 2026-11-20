import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authServer } from './server.mjs';
const sha = value => createHash('sha256').update(value).digest('base64url');
async function fixture(t) {
  let now = Date.now();
  const calls = [];
  const server = authServer({ clientId: 'Iv1.test', clientSecret: 'never-send-to-client', publicUrl: 'https://auth.example', now: () => now,
    exchange: async body => { calls.push(body); return { access_token: 'ghu_test', refresh_token: 'ghr_test', expires_in: 28800 }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const state = 'a'.repeat(64), verifier = 'b'.repeat(64), claim = 'c'.repeat(64);
  const start = () => post('/sessions', { state, codeChallenge: sha(verifier), claimHash: sha(claim) });
  const callback = code => fetch(`${base}/callback?state=${state}&code=${code}`);
  return { base, post, state, verifier, claim, start, callback, calls, advance: ms => { now += ms; } };
}
test('PKCE uses a single-use claim and keeps tokens out of callback URLs', async t => {
  const f = await fixture(t), start = await f.start(), url = new URL(start.body.authorizeUrl);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://auth.example/callback');
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.deepEqual((await f.post(`/sessions/${f.state}/claim`, { claim: f.claim, verifier: f.verifier })).body, { pending: true });
  const callback = await f.callback('code');
  assert.equal(callback.status, 200); assert.equal((await callback.text()).includes('ghu_'), false);
  assert.equal((await f.post(`/sessions/${f.state}/claim`, { claim: f.claim, verifier: f.verifier })).body.access_token, 'ghu_test');
  assert.equal(f.calls[0].code_verifier, f.verifier);
  assert.equal((await f.post(`/sessions/${f.state}/claim`, { claim: f.claim, verifier: f.verifier })).status, 400);
});
test('wrong state, claim and PKCE verifier do not release tokens', async t => {
  const f = await fixture(t); await f.start();
  assert.equal((await fetch(`${f.base}/callback?state=unknown&code=code`)).status, 400);
  await f.callback('code');
  assert.equal((await f.post(`/sessions/${f.state}/claim`, { claim: 'd'.repeat(64), verifier: f.verifier })).status, 400);
  assert.equal((await f.post(`/sessions/${f.state}/claim`, { claim: f.claim, verifier: 'd'.repeat(64) })).status, 400);
  assert.equal(f.calls.length, 0);
});
test('expired sessions and duplicate state are rejected', async t => {
  const f = await fixture(t); await f.start();
  assert.equal((await f.start()).status, 400); f.advance(601_000);
  assert.equal((await f.callback('code')).status, 400);
});
test('refresh exchanges only the refresh-token grant and never returns the app secret', async t => {
  const f = await fixture(t);
  const result = await f.post('/refresh', { refresh_token: 'ghr_old', grant_type: 'ignored', client_secret: 'attacker' });
  assert.deepEqual(f.calls[0], { grant_type: 'refresh_token', refresh_token: 'ghr_old' });
  assert.equal(JSON.stringify(result).includes('never-send-to-client'), false);
});
