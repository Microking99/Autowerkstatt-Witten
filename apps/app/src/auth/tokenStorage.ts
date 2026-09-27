/**
 * Sitzungstoken nativ (iOS/Android): im geschützten Speicher des Geräts (Keychain /
 * Android Keystore) über expo-secure-store. Zusätzlich die zuletzt bekannten
 * Kontodaten (keine Geheimnisse), damit die App ohne Verbindung starten kann.
 * Browser: siehe tokenStorage.web.ts.
 */
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'werkstatt.sitzung';
const USER_KEY = 'werkstatt.konto';

export const tokenStorage = {
  async load(): Promise<{ token: string | null; userJson: string | null }> {
    try {
      const [token, userJson] = await Promise.all([SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(USER_KEY)]);
      return { token, userJson };
    } catch {
      return { token: null, userJson: null };
    }
  },
  async save(token: string, userJson: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    await SecureStore.setItemAsync(USER_KEY, userJson);
  },
  async saveUser(userJson: string): Promise<void> {
    await SecureStore.setItemAsync(USER_KEY, userJson);
  },
  async clear(): Promise<void> {
    await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(USER_KEY)]);
  },
};
