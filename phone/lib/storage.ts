import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  VAULTS: 'noteriv:vaults',
  ACTIVE_VAULT: 'noteriv:activeVault',
  SETTINGS: 'noteriv:settings',
  SETUP_COMPLETE: 'noteriv:setupComplete',
  WORKSPACE: (vaultId: string) => `noteriv:workspace:${vaultId}`,
  GITHUB_TOKEN: (vaultId: string) => `noteriv:ghToken:${vaultId}`,
  GIT_TOKEN: (vaultId: string) => `noteriv:gitToken:${vaultId}`,
  GIT_CREDENTIALS: (vaultId: string) => `noteriv:gitCredentials:${vaultId}`,
};

// Port of covuaduongsinh's SecureStore migration, with no plaintext fallback.
const secure = (key: string) => /^noteriv:(ghToken|gitToken|gitCredentials):/.test(key);
const secureKey = (key: string) => Array.from(key).map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
async function ensureSecure(): Promise<void> {
  if (!await SecureStore.isAvailableAsync()) throw new Error('Secure credential storage is unavailable on this device');
}
export async function getItem<T>(key: string): Promise<T | null> {
  if (secure(key)) {
    await ensureSecure();
    let value = await SecureStore.getItemAsync(secureKey(key));
    if (value === null) {
      value = await AsyncStorage.getItem(key);
      if (value !== null) {
        await SecureStore.setItemAsync(secureKey(key), value);
        if (await SecureStore.getItemAsync(secureKey(key)) !== value) throw new Error('Credential migration could not be verified');
        await AsyncStorage.removeItem(key);
      }
    }
    return value === null ? null : JSON.parse(value) as T;
  }
  const value = await AsyncStorage.getItem(key);
  return value === null ? null : JSON.parse(value) as T;
}
export async function setItem<T>(key: string, value: T): Promise<void> {
  const serialized = JSON.stringify(value);
  if (secure(key)) {
    await ensureSecure();
    await SecureStore.setItemAsync(secureKey(key), serialized);
    if (await SecureStore.getItemAsync(secureKey(key)) !== serialized) throw new Error('Credential write could not be verified');
    await AsyncStorage.removeItem(key);
    return;
  }
  await AsyncStorage.setItem(key, serialized);
}
export async function removeItem(key: string): Promise<void> {
  if (secure(key)) { await ensureSecure(); await SecureStore.deleteItemAsync(secureKey(key)); }
  await AsyncStorage.removeItem(key);
}
export { KEYS };
