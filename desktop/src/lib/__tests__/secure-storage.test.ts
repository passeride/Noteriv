import { describe, expect, it, vi } from 'vitest';
import { createStorage } from '../../../../packages/git-client/secure-storage';
function fixture() {
  const plain = new Map<string, string>(), secure = new Map<string, string>();
  const remove = vi.fn(async (k: string) => { plain.delete(k); });
  const put = vi.fn(async (k: string, v: string) => { plain.set(k, v); });
  const secret = { available: vi.fn(async () => true), get: vi.fn(async (k: string) => secure.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { secure.set(k, v); }), remove: vi.fn(async (k: string) => { secure.delete(k); }) };
  return { plain, secure, secret, put, remove, store: createStorage({ getItem: async k => plain.get(k) ?? null, setItem: put, removeItem: remove }, secret) };
}
const key = 'noteriv:gitToken:vault';
describe('credential migration and failure handling', () => {
  it('verifies the secure value before removing the legacy entry', async () => {
    const f = fixture(); f.plain.set(key, JSON.stringify('old'));
    expect(await f.store.getItem(key)).toBe('old');
    expect(f.plain.has(key)).toBe(false); expect(f.secure.size).toBe(1);
    expect(f.secret.get).toHaveBeenCalledTimes(2);
    expect(f.remove.mock.invocationCallOrder[0]).toBeGreaterThan(f.secret.set.mock.invocationCallOrder[0]);
  });
  it('never falls back to ordinary storage if SecureStore is unavailable', async () => {
    const f = fixture(); f.secret.available.mockResolvedValue(false);
    await expect(f.store.setItem(key, 'new')).rejects.toThrow('unavailable');
    expect(f.put).not.toHaveBeenCalled(); expect(f.plain.size).toBe(0);
  });
  it('keeps the legacy entry when the secure write cannot be verified', async () => {
    const f = fixture(); f.plain.set(key, JSON.stringify('old')); f.secret.get.mockResolvedValue(null);
    await expect(f.store.getItem(key)).rejects.toThrow('verified');
    expect(f.plain.has(key)).toBe(true); expect(f.remove).not.toHaveBeenCalled();
  });
  it('serializes a migration followed by new credentials', async () => {
    const f = fixture(); f.plain.set(key, JSON.stringify('old'));
    await Promise.all([f.store.getItem(key), f.store.setItem(key, 'new')]);
    expect(await f.store.getItem(key)).toBe('new');
    await f.store.removeItem(key); expect(f.secure.size).toBe(0); expect(f.plain.size).toBe(0);
  });
});
