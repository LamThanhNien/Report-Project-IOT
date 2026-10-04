import React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";

interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
  hideTitle?: boolean;
}

export function PageHeader({ title, subtitle, description, crumbs, actions, className, hideTitle }: Props) {
  const subtitleContent = subtitle ?? description;
  const shouldHideTitle = hideTitle ?? false;

  return (
    <div className={cn("shrink-0", className)}>
      <div className={cn("flex items-start gap-4 flex-wrap", shouldHideTitle ? "justify-end" : "justify-between")}>
        {!shouldHideTitle && (
          <div>
            {crumbs && crumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted">
                {crumbs.map((crumb, index) => (
                  <React.Fragment key={`${crumb.label}-${index}`}>
                    {index > 0 && <span aria-hidden="true">/</span>}
                    {crumb.to ? (
                      <Link to={crumb.to} className="hover:text-primary hover:underline">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            )}
            <h1 className="text-xl font-semibold text-slate-900 dark:text-text-primary tracking-tight">
              {title}
            </h1>
            {subtitleContent && (
              <div className="text-sm text-slate-500 dark:text-text-muted mt-1">{subtitleContent}</div>
            )}
          </div>
        )}
        {actions && (
          <div className="flex items-center gap-2 flex-wrap">{actions}</div>
        )}
      </div>
    </div>
  );
}
