import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/cn";
import { SkeletonTable } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { PaginationBar } from "./PaginationBar";
import { usePagination } from "../../hooks/usePagination";
import { useTranslation } from "react-i18next";
import { ErrorState } from "./ErrorState";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  width?: string;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
}

interface Props<T> {
  data: T[] | undefined;
  columns: Column<T>[];
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialPageSize?: number;
  className?: string;
  toolbar?: React.ReactNode;
  skeletonRows?: number;
  /** Use the caller's server pagination controls. */
  hidePagination?: boolean;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

export function DataTable<T>({
  data,
  columns,
  loading,
  error,
  emptyTitle,
  emptyDescription,
  onRetry,
  rowKey,
  onRowClick,
  initialPageSize = 10,
  className,
  toolbar,
  skeletonRows = 6,
  hidePagination = false,
}: Props<T>) {
  const [sort, setSort] = useState<SortState>(null);
  const { t } = useTranslation("common");
  const [pageSize, setPageSize] = useState(initialPageSize);

  const sorted = useMemo(() => {
    if (!data) return [];
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;
    const getValue = col.sortValue ?? ((row: T) => col.render(row) as unknown as string);
    return [...data].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sort.dir === "asc" ? va - vb : vb - va;
      }
      const sa = String(va).toLowerCase();
      const sb = String(vb).toLowerCase();
      return sort.dir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [data, sort, columns]);

  const { page: currentPage, setPage, totalPages, pagedItems: pageData } = usePagination(sorted, pageSize);

  function toggleSort(key: string) {
    setPage(0);
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} className={className} />;
  }

  return (
    <div className={cn("card overflow-hidden flex flex-col", className)}>
      {toolbar && (
        <div className="px-5 py-3 border-b border-slate-200 dark:border-border-subtle flex items-center gap-2 flex-wrap">
          {toolbar}
        </div>
      )}
      <div className="overflow-auto flex-1">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-surface-elevated/70 text-slate-600 dark:text-text-muted text-xs uppercase tracking-wider border-b border-slate-100 dark:border-border-subtle">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  aria-sort={c.sortable ? sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none" : undefined}
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    "px-4 py-2.5 font-medium",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.align !== "right" && c.align !== "center" && "text-left",
                  )}
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-text-secondary"
                    >
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-50" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={columns.length}>
                  <SkeletonTable rows={skeletonRows} cols={columns.length} />
                </td>
              </tr>
            )}
            {!loading && pageData.length === 0 && (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyTitle ?? t("empty.no_data", "No data available")} description={emptyDescription} />
                </td>
              </tr>
            )}
            {!loading &&
              (hidePagination ? sorted : pageData).map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onRowClick(row); } } : undefined}
                  className={cn(
                    "border-b border-slate-100 dark:border-border-subtle",
                    onRowClick && "cursor-pointer hover:bg-slate-50 dark:hover:bg-surface-elevated/70",
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-4 py-2.5 text-slate-700 dark:text-text-secondary",
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        c.className,
                      )}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!hidePagination && !loading && sorted.length > 0 && <PaginationBar
        page={currentPage} totalPages={totalPages} totalItems={sorted.length} pageSize={pageSize}
        onPrev={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)}
        onPageSizeChange={size => { setPageSize(size); setPage(0); }}
        className="m-3 mt-3" />}

    </div>
  );
}
