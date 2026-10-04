import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "aifom_admin_alerts_read";
const SYNC_EVENT = "aifom-admin-alerts-read";

function readStoredIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeStoredIds(ids: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new Event(SYNC_EVENT));
}

export function useAdminAlertReadState() {
  const [readIds, setReadIds] = useState<Set<string>>(() => readStoredIds());

  useEffect(() => {
    function syncReadIds(): void {
      setReadIds(readStoredIds());
    }

    window.addEventListener("storage", syncReadIds);
    window.addEventListener(SYNC_EVENT, syncReadIds);
    return () => {
      window.removeEventListener("storage", syncReadIds);
      window.removeEventListener(SYNC_EVENT, syncReadIds);
    };
  }, []);

  const markRead = useCallback((id: string): void => {
    const next = readStoredIds();
    if (next.has(id)) return;
    next.add(id);
    writeStoredIds(next);
  }, []);

  const isRead = useCallback((id: string): boolean => readIds.has(id), [readIds]);

  return { isRead, markRead };
}
