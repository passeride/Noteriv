import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createStorage } from '../../packages/git-client/secure-storage';

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

// Follows covuaduongsinh's secure migration approach, without plaintext fallback.
const storage = createStorage(AsyncStorage, {
  available: SecureStore.isAvailableAsync,
  get: SecureStore.getItemAsync,
  set: SecureStore.setItemAsync,
  remove: SecureStore.deleteItemAsync,
});
export const getItem = storage.getItem;
export const setItem = storage.setItem;
export const removeItem = storage.removeItem;
export { KEYS };
