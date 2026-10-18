import type { SecureStorage } from "../identity";

/** An in-memory expo-secure-store (tests only). */
export function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: SecureStorage = {
    getItemAsync: async (key) => items.get(key) ?? null,
    setItemAsync: async (key, value) => {
      items.set(key, value);
    },
    deleteItemAsync: async (key) => {
      items.delete(key);
    },
  };
  return { storage, items };
}
