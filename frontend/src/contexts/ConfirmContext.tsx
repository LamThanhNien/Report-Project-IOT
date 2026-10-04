import { useSyncExternalStore } from "react";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { confirmations, type ConfirmationOptions } from "../lib/confirmations";

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const pending = useSyncExternalStore(
    confirmations.subscribe,
    confirmations.getSnapshot,
    confirmations.getSnapshot,
  );

  return (
    <>
      {children}
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.title ?? ""}
        description={pending?.description}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        destructive={pending?.destructive}
        confirmationText={pending?.confirmationText}
        confirmationLabel={pending?.confirmationLabel}
        onConfirm={() => confirmations.resolve(true)}
        onCancel={() => confirmations.resolve(false)}
      />
    </>
  );
}

export function useConfirm(): (options: ConfirmationOptions) => Promise<boolean> {
  return confirmations.request;
}
