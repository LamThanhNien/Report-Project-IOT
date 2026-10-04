import type { ToastTone } from "../components/ui/Toast";

export interface NotificationOptions {
  duration?: number;
  dedupeKey?: string;
}

export type MutationNotificationPolicy = "global" | "local" | "silent";

export interface MutationNotificationMeta {
  notification?: MutationNotificationPolicy;
  successMessage?: string;
}

export interface NotificationItem {
  id: string;
  tone: ToastTone;
  message?: string;
  error?: unknown;
  duration: number;
  dedupeKey?: string;
}

export interface NotificationApi {
  show(input: unknown, tone?: ToastTone, options?: NotificationOptions): string;
  success(message: string, options?: NotificationOptions): string;
  error(error: unknown, options?: NotificationOptions): string;
  warning(message: string, options?: NotificationOptions): string;
  info(message: string, options?: NotificationOptions): string;
  dismiss(id: string): void;
  clear(): void;
}

const MAX_VISIBLE_NOTIFICATIONS = 4;
const DEFAULT_DURATION = 4_000;
const listeners = new Set<() => void>();
let sequence = 0;
let snapshot: NotificationItem[] = [];

function nextId(): string {
  sequence += 1;
  return `notification-${Date.now()}-${sequence}`;
}

function inputFields(input: unknown): Pick<NotificationItem, "message" | "error"> {
  if (typeof input === "string") return { message: input };
  return { error: input };
}

function errorFingerprint(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; status?: unknown; kind?: unknown; message?: unknown };
  const values = [candidate.code, candidate.status, candidate.kind, candidate.message]
    .filter((value) => value !== undefined && value !== null)
    .map(String);
  return values.length > 0 ? values.join(":") : undefined;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export const notificationApi: NotificationApi = {
  show(input, tone = "info", options = {}) {
    const fields = inputFields(input);
    const dedupeKey = options.dedupeKey
      ?? (fields.message ? `${tone}:${fields.message}` : `${tone}:${errorFingerprint(fields.error) ?? "unknown"}`);
    const duplicate = snapshot.find((item) => item.dedupeKey === dedupeKey);
    if (duplicate) return duplicate.id;

    const item: NotificationItem = {
      id: nextId(),
      tone,
      ...fields,
      duration: options.duration ?? DEFAULT_DURATION,
      dedupeKey,
    };
    snapshot = [...snapshot, item].slice(-MAX_VISIBLE_NOTIFICATIONS);
    emit();
    return item.id;
  },

  success(message, options) {
    return notificationApi.show(message, "success", options);
  },

  error(error, options) {
    return notificationApi.show(error, "error", options);
  },

  warning(message, options) {
    return notificationApi.show(message, "warning", options);
  },

  info(message, options) {
    return notificationApi.show(message, "info", options);
  },

  dismiss(id) {
    const next = snapshot.filter((item) => item.id !== id);
    if (next.length === snapshot.length) return;
    snapshot = next;
    emit();
  },

  clear() {
    if (snapshot.length === 0) return;
    snapshot = [];
    emit();
  },
};

export const notifications = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): NotificationItem[] {
    return snapshot;
  },
};
