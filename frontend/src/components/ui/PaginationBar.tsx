import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

/**
 * PaginationBar — shared pagination control component.
 *
 * Always renders when totalItems > 0, even for single-page results.
 * Renders nothing only when totalItems <= 0 (empty collection).
 */
export function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPrev,
  onNext,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  className = "",
}: PaginationBarProps) {
  const { t } = useTranslation("common");

  // Hide only when collection has 0 items
  if (totalItems <= 0) return null;

  const effectiveTotalPages = Math.max(1, totalPages);
  const effectivePage = Math.max(0, Math.min(page, effectiveTotalPages - 1));
  const from = totalItems > 0 ? effectivePage * pageSize + 1 : 0;
  const to = Math.min((effectivePage + 1) * pageSize, totalItems);

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3.5 py-1.5 border border-slate-200/80 dark:border-border bg-slate-50/90 dark:bg-surface-elevated/90 rounded-md mt-auto shrink-0 gap-2.5 flex-wrap text-xs shadow-xs",
        className,
      )}
    >
      <span className="text-xs text-slate-500 dark:text-text-muted select-none">
        {t("pagination.showing_prefix", "Hiển thị")}{" "}
        <span className="font-medium text-slate-700 dark:text-text-primary">
          {from}–{to} / {totalItems}
        </span>
      </span>
      <div className="flex items-center gap-2.5">
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted">
            <span>{t("pagination.page_size", "Số dòng:")}</span>
            <select
              className="h-7 rounded border border-slate-200 dark:border-border bg-white dark:bg-surface-muted px-2 text-xs text-slate-700 dark:text-text-primary focus:border-slate-400 dark:focus:border-border focus:outline-none cursor-pointer shadow-xs transition-colors"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded border border-slate-200 dark:border-border bg-white dark:bg-surface-muted text-slate-600 dark:text-text-secondary hover:text-slate-900 hover:bg-slate-50 dark:hover:bg-surface-elevated dark:hover:text-text-primary hover:border-slate-300 dark:hover:border-border disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-surface-muted disabled:hover:text-slate-400 dark:disabled:hover:text-text-muted/60 disabled:hover:border-slate-200/60 dark:disabled:hover:border-border/60 disabled:cursor-not-allowed transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:focus-visible:ring-border"
            onClick={onPrev}
            disabled={effectivePage <= 0}
            aria-label={t("pagination.prev", "Trang trước")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs font-medium text-slate-700 dark:text-text-secondary px-1 min-w-[2.75rem] text-center select-none">
            {effectivePage + 1} / {effectiveTotalPages}
          </span>
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded border border-slate-200 dark:border-border bg-white dark:bg-surface-muted text-slate-600 dark:text-text-secondary hover:text-slate-900 hover:bg-slate-50 dark:hover:bg-surface-elevated dark:hover:text-text-primary hover:border-slate-300 dark:hover:border-border disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-surface-muted disabled:hover:text-slate-400 dark:disabled:hover:text-text-muted/60 disabled:hover:border-slate-200/60 dark:disabled:hover:border-border/60 disabled:cursor-not-allowed transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:focus-visible:ring-border"
            onClick={onNext}
            disabled={effectivePage >= effectiveTotalPages - 1}
            aria-label={t("pagination.next", "Trang sau")}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
