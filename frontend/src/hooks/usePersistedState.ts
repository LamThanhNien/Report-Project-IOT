import { useState, useCallback } from "react";

function isStorageAvailable(type: "local" | "session"): boolean {
  try {
    if (typeof window === "undefined") return false;
    const storage = type === "local" ? window.localStorage : window.sessionStorage;
    const testKey = "__storage_test__";
    storage.setItem(testKey, testKey);
    storage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  storageType: "local" | "session"
): [T, (val: T | ((prev: T) => T)) => void] {
  const isAvailable = isStorageAvailable(storageType);

  const [state, setState] = useState<T>(() => {
    if (!isAvailable) {
      return defaultValue;
    }
    try {
      const storage = storageType === "local" ? window.localStorage : window.sessionStorage;
      const saved = storage.getItem(key);
      if (saved !== null) {
        return JSON.parse(saved) as T;
      }
    } catch (e) {
      return defaultValue;
    }
    return defaultValue;
  });

  const setPersistedState = useCallback(
    (val: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof val === "function" ? (val as (prev: T) => T)(prev) : val;
        if (isAvailable) {
          try {
            const storage = storageType === "local" ? window.localStorage : window.sessionStorage;
            storage.setItem(key, JSON.stringify(next));
          } catch (e) {
            // Silently fallback if item setting fails (e.g. quota exceeded)
          }
        }
        return next;
      });
    },
    [key, storageType, isAvailable]
  );

  return [state, setPersistedState];
}
