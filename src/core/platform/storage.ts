import { Preferences } from '@capacitor/preferences';
import { MemoryStore, type KeyValueStore, type SecretStore } from '../store.ts';
import { RouterLink, isNative } from './routerlink.ts';

class PreferencesStore implements KeyValueStore {
  async get(key: string) {
    return (await Preferences.get({ key })).value;
  }
  async set(key: string, value: string) {
    await Preferences.set({ key, value });
  }
  async remove(key: string) {
    await Preferences.remove({ key });
  }
}

class KeystoreSecretStore implements SecretStore {
  readonly persistent = true;
  async get(key: string) {
    return (await RouterLink.secureGet({ key })).value ?? null;
  }
  async set(key: string, value: string) {
    await RouterLink.secureSet({ key, value });
  }
  async remove(key: string) {
    await RouterLink.secureRemove({ key });
  }
}

export function createStores(): { kv: KeyValueStore; secrets: SecretStore } {
  // Preferences uses SharedPreferences on Android and localStorage in the browser.
  // In the browser development build secrets live in memory only.
  return { kv: new PreferencesStore(), secrets: isNative() ? new KeystoreSecretStore() : new MemoryStore() };
}
