import type { ReactNode } from "react";

export type ConfirmationOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmationText?: string;
  confirmationLabel?: string;
};

type PendingConfirmation = ConfirmationOptions & {
  resolve: (accepted: boolean) => void;
};

const listeners = new Set<() => void>();
let pending: PendingConfirmation | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export const confirmations = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && pending) confirmations.resolve(false);
    };
  },
  getSnapshot() {
    return pending;
  },
  request(options: ConfirmationOptions): Promise<boolean> {
    // A missing confirmation surface must never approve an action implicitly.
    if (listeners.size === 0) return Promise.resolve(false);
    if (pending) pending.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending = { ...options, resolve };
      emit();
    });
  },
  resolve(accepted: boolean) {
    const current = pending;
    pending = null;
    current?.resolve(accepted);
    emit();
  },
};

export function requestConfirmation(options: ConfirmationOptions): Promise<boolean> {
  return confirmations.request(options);
}
