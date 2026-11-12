import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { login, refresh, type OAuthIO } from '../../../../packages/git-client/oauth';
const io = (post: OAuthIO['post']): OAuthIO => ({ post, random: async () => 'a'.repeat(64), sha256: async v => createHash('sha256').update(v).digest('base64url'), open: async () => {} });
afterEach(() => vi.useRealTimers());
describe('GitHub native authentication', () => {
  it('respects pending and slow_down before returning a device token', async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockResolvedValueOnce({ device_code: 'device', user_code: 'ABC', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 })
      .mockResolvedValueOnce({ error: 'authorization_pending' }).mockResolvedValueOnce({ error: 'slow_down' })
      .mockResolvedValueOnce({ access_token: 'ghu_test', refresh_token: 'ghr_test', expires_in: 28800 });
    const display = vi.fn();
    const pending = login({ clientId: 'Iv1.test' }, io(post), new AbortController().signal, display);
    await vi.advanceTimersByTimeAsync(5000); expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000); expect(post).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(9000); expect(post).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000); expect((await pending).accessToken).toBe('ghu_test');
    expect(display).toHaveBeenCalledWith(expect.stringContaining('ABC'));
    expect(post.mock.calls[1][1]).not.toHaveProperty('client_secret');
  });
  it('cancels before polling and never persists a late token', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const post = vi.fn().mockResolvedValue({ device_code: 'd', user_code: 'ABC', verification_uri: 'https://github.com/login/device' });
    const promise = login({ clientId: 'Iv1.test' }, io(post), controller.signal, () => {});
    const assertion = expect(promise).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await assertion;
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('rejects a broker authorization URL for a different client', async () => {
    const post = vi.fn().mockResolvedValue({ authorizeUrl: `https://github.com/login/oauth/authorize?state=${'a'.repeat(64)}&client_id=wrong` });
    await expect(login({ clientId: 'Iv1.test', brokerUrl: 'https://auth.example' }, io(post), new AbortController().signal, () => {})).rejects.toThrow('Invalid authorization');
  });
  it('refreshes expired access tokens without embedding a client secret', async () => {
    const post = vi.fn().mockResolvedValue({ access_token: 'new', refresh_token: 'rotated', expires_in: 28800 });
    const value = await refresh({ clientId: 'Iv1.test' }, { accessToken: 'old', refreshToken: 'refresh', expiresAt: 1 }, io(post));
    expect(value.accessToken).toBe('new'); expect(value.refreshToken).toBe('rotated');
    expect(post.mock.calls[0][1]).toEqual({ client_id: 'Iv1.test', grant_type: 'refresh_token', refresh_token: 'refresh' });
  });
});
