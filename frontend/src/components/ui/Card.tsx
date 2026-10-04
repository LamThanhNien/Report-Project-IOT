import React from "react";
import { cn } from "../../lib/cn";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return <div ref={ref} className={cn("card", className)} {...props} />;
  },
);
Card.displayName = "Card";

export function CardHeader({ className, compact, ...props }: React.HTMLAttributes<HTMLDivElement> & { compact?: boolean }) {
  return (
    <div
      className={cn(
        "border-b border-slate-200 bg-slate-50/70 transition-colors dark:border-border-subtle dark:bg-surface-elevated/40",
        compact ? "px-4 py-3" : "px-5 py-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-slate-800 dark:text-text-primary", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
