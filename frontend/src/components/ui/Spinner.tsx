import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-slate-400", className)} />;
}

export function FullSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-text-muted">
      <Spinner className="h-6 w-6" />
      {label && <div className="mt-3 text-xs">{label}</div>}
    </div>
  );
}
