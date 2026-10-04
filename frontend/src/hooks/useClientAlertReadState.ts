import { useCallback, useEffect, useState } from "react";

const CLIENT_ALERT_READ_KEY = "aifom_client_alerts_read";
const CLIENT_ALERT_READ_EVENT = "aifom-client-alerts-read";

function readStoredIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(CLIENT_ALERT_READ_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeStoredIds(ids: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CLIENT_ALERT_READ_KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new Event(CLIENT_ALERT_READ_EVENT));
}

export function useClientAlertReadState() {
  const [readIds, setReadIds] = useState<Set<string>>(() => readStoredIds());

  useEffect(() => {
    function syncReadIds(): void {
      setReadIds(readStoredIds());
    }

    window.addEventListener("storage", syncReadIds);
    window.addEventListener(CLIENT_ALERT_READ_EVENT, syncReadIds);
    return () => {
      window.removeEventListener("storage", syncReadIds);
      window.removeEventListener(CLIENT_ALERT_READ_EVENT, syncReadIds);
    };
  }, []);

  const markRead = useCallback((id: string): void => {
    const next = readStoredIds();
    if (next.has(id)) return;
    next.add(id);
    writeStoredIds(next);
  }, []);

  const markUnread = useCallback((id: string): void => {
    const next = readStoredIds();
    if (!next.has(id)) return;
    next.delete(id);
    writeStoredIds(next);
  }, []);

  const toggleRead = useCallback((id: string): void => {
    const next = readStoredIds();
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    writeStoredIds(next);
  }, []);

  const markManyRead = useCallback((ids: string[]): void => {
    const next = readStoredIds();
    let changed = false;
    for (const id of ids) {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    }
    if (changed) writeStoredIds(next);
  }, []);

  const isRead = useCallback((id: string): boolean => readIds.has(id), [readIds]);

  return { readIds, isRead, markRead, markUnread, toggleRead, markManyRead };
}
