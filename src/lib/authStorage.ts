/**
 * Auth session storage for React Native.
 *
 * Supabase sessions are JWTs — they must not sit in plain AsyncStorage.
 * We persist them in the device Keychain / Keystore via expo-secure-store
 * and keep an AsyncStorage mirror only as a migration + overflow fallback
 * (SecureStore values can be rejected when they exceed platform limits).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const NAMESPACE = 'abtik.auth.';
/** expo-secure-store rejects values larger than this on some platforms. */
const MAX_SECURE_VALUE_BYTES = 2000;

const secureKey = (key: string): string => `${NAMESPACE}${key}`;

/** Shape required by `createClient({ auth: { storage } })`. */
export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const secure = await SecureStore.getItemAsync(secureKey(key));
      if (secure !== null) return secure;
    } catch (err) {
      console.warn('[ABTIK] SecureStore read failed', err);
    }
    // Migration path for sessions written before SecureStore was wired up.
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (value.length <= MAX_SECURE_VALUE_BYTES) {
      try {
        await SecureStore.setItemAsync(secureKey(key), value);
        // Drop any plaintext legacy copy once the secure write succeeded.
        await AsyncStorage.removeItem(key).catch(() => undefined);
        return;
      } catch (err) {
        console.warn('[ABTIK] SecureStore write failed — falling back', err);
      }
    }
    await AsyncStorage.setItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(secureKey(key)).catch(() => undefined),
      AsyncStorage.removeItem(key).catch(() => undefined),
    ]);
  },
};
