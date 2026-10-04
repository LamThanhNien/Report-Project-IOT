import React from "react";
import { cn } from "../../lib/cn";
import { Card, CardBody } from "./Card";
import { SkeletonCard } from "./Skeleton";
import { ContentLoader } from "../ContentLoader";

export function TenantLoadingState({ label = "Dang tai...", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("min-h-[640px]", className)}>
      <span className="sr-only">{label}</span>
      <ContentLoader />
    </div>
  );
}

export function TenantToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("page-section", className)}>
      <CardBody className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        {children}
      </CardBody>
    </Card>
  );
}

export function TenantBanner({
  tone = "info",
  children,
  className,
}: {
  tone?: "success" | "error" | "warning" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    error: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
    warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  }[tone];

  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", toneClass, className)}>
      {children}
    </div>
  );
}

export function TenantPageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: cards }).map((_, index) => (
          <SkeletonCard key={index} lines={2} />
        ))}
      </div>
    </div>
  );
}

export function TenantField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label-xs mb-1">{label}</span>
      {children}
    </label>
  );
}
