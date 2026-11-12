export interface PlainStore {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}
export interface SecretStore {
  available: () => Promise<boolean>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}
const secretKey = (key: string) => /^noteriv:(ghToken|gitToken|gitCredentials):/.test(key);
// Collision-free conversion to the alphabet accepted by Android SecureStore.
const encoded = (key: string) => key.split('').map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
export function createStorage(plain: PlainStore, secure: SecretStore) {
  const queues = new Map<string, Promise<unknown>>();
  function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (queues.get(key) ?? Promise.resolve()).then(work);
    const tail = result.then(() => {}, () => {});
    queues.set(key, tail);
    void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return result;
  }
  async function available() {
    if (!await secure.available()) throw new Error('Secure credential storage is unavailable; credentials were not saved');
  }
  return {
    async getItem<T>(key: string): Promise<T | null> {
      if (!secretKey(key)) {
        try { const value = await plain.getItem(key); return value === null ? null : JSON.parse(value) as T; }
        catch { return null; }
      }
      return serialized(key, async () => {
        await available();
        let value = await secure.get(encoded(key));
        if (value === null) {
          value = await plain.getItem(key);
          if (value !== null) {
            // Parse before migration; corrupt entries never replace secure data.
            JSON.parse(value);
            await secure.set(encoded(key), value);
            if (await secure.get(encoded(key)) !== value) throw new Error('Credential migration could not be verified');
            await plain.removeItem(key);
          }
        }
        return value === null ? null : JSON.parse(value) as T;
      });
    },
    async setItem<T>(key: string, value: T): Promise<void> {
      const data = JSON.stringify(value);
      if (!secretKey(key)) { await plain.setItem(key, data); return; }
      return serialized(key, async () => {
        await available();
        await secure.set(encoded(key), data);
        if (await secure.get(encoded(key)) !== data) throw new Error('Credential write could not be verified');
        await plain.removeItem(key);
      });
    },
    async removeItem(key: string): Promise<void> {
      if (!secretKey(key)) { await plain.removeItem(key); return; }
      return serialized(key, async () => {
        await available();
        await secure.remove(encoded(key));
        await plain.removeItem(key);
      });
    },
  };
}
