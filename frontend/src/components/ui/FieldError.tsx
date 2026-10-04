import { cn } from "../../lib/cn";

interface FieldErrorProps {
  id: string;
  message?: string | null;
  announced?: boolean;
  className?: string;
}

export function FieldError({ id, message, announced = true, className }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p
      id={id}
      role={announced ? "alert" : undefined}
      className={cn("mt-1.5 text-xs text-rose-600 dark:text-rose-400", className)}
    >
      {message}
    </p>
  );
}
