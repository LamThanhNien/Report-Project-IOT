import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, LayoutGrid, List, Search, X } from "lucide-react";
import { cn } from "../../../lib/cn";

export type ProjectFilter = "all" | "active" | "draft" | "recent";
export type ProjectSortOption = "updated" | "name" | "devices";
export type ViewMode = "grid" | "list";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  filter: ProjectFilter;
  onFilterChange: (filter: ProjectFilter) => void;
  sortBy?: ProjectSortOption;
  onSortChange?: (sort: ProjectSortOption) => void;
  totalCount?: number;
  filteredCount?: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function ProjectSearchAndFilters({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  sortBy = "updated",
  onSortChange,
  totalCount,
  filteredCount,
  viewMode,
  onViewModeChange,
}: Props) {
  const { t } = useTranslation(["projects", "common"]);

  const filters: { key: ProjectFilter; label: string }[] = useMemo(() => [
    { key: "all", label: t("common:actions.all", "Tất cả") },
    { key: "active", label: t("projects:status.active", "Đang hoạt động") },
    { key: "draft", label: t("projects:status.draft", "Chưa có thiết bị") },
    { key: "recent", label: t("projects:filter.recent", "Cập nhật gần đây") },
  ], [t]);

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between border-b border-slate-200/80 dark:border-border-subtle pb-4 pt-1">
      {/* Search Input + Result Counter */}
      <div className="flex flex-1 items-center gap-2.5 w-full xl:max-w-md">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-text-muted" />
          <input
            aria-label={t("projects:search", "Tìm kiếm dự án")}
            className="input pl-9 pr-8 text-xs sm:text-sm h-9 bg-white border-slate-200 hover:border-slate-300 dark:bg-surface dark:border-border-subtle dark:hover:border-slate-700 transition-colors rounded-lg shadow-xs"
            placeholder={t("projects:search_placeholder", "Tìm kiếm dự án theo tên hoặc mô tả...")}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              onClick={() => onSearchChange("")}
              aria-label={t("common:actions.clear_search", "Xóa tìm kiếm")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {totalCount !== undefined && filteredCount !== undefined && (
          <span className="hidden xl:inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-surface-elevated dark:text-text-muted whitespace-nowrap">
            {filteredCount === totalCount
              ? `${totalCount} ${t("projects:projects_count", "dự án")}`
              : `${filteredCount}/${totalCount} ${t("projects:projects_count", "dự án")}`}
          </span>
        )}
      </div>

      {/* Filter chips + Sort select + View toggle */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Filter chips */}
        <div className="scrollbar-hide flex items-center gap-1.5 overflow-x-auto py-0.5">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={cn(
                "chip px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all duration-150 cursor-pointer border",
                filter === f.key
                  ? "bg-primary text-primary-foreground border-primary shadow-xs font-semibold"
                  : "bg-surface text-text-secondary border-border-subtle hover:border-border hover:bg-surface-elevated dark:text-text-muted dark:hover:text-text-primary",
              )}
              aria-pressed={filter === f.key}
              onClick={() => onFilterChange(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort selector */}
        {onSortChange && (
          <div className="relative inline-flex items-center">
            <ArrowUpDown className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400 dark:text-text-muted" />
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as ProjectSortOption)}
              className="h-9 rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-xs font-medium text-slate-700 hover:border-slate-300 dark:border-border-subtle dark:bg-surface dark:text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer transition-colors shadow-xs"
              aria-label={t("common:actions.sort", "Sắp xếp")}
            >
              <option value="updated">{t("projects:filter.recent", "Cập nhật gần đây")}</option>
              <option value="name">{t("projects:sort_name", "Tên A-Z")}</option>
              <option value="devices">{t("projects:sort_devices", "Nhiều thiết bị nhất")}</option>
            </select>
          </div>
        )}

        {/* View mode toggle */}
        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 dark:border-border-subtle p-0.5 bg-slate-100 dark:bg-surface-elevated">
          <button
            type="button"
            aria-label={t("projects:grid_view", "Dạng lưới")}
            aria-pressed={viewMode === "grid"}
            onClick={() => onViewModeChange("grid")}
            className={cn(
              "flex h-8 w-8 items-center justify-center transition-all duration-200 rounded-md",
              viewMode === "grid"
                ? "bg-white text-slate-900 shadow-xs dark:bg-surface dark:text-text-primary font-semibold"
                : "text-slate-500 hover:text-slate-900 dark:text-text-muted dark:hover:text-text-primary",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("projects:list_view", "Dạng danh sách")}
            aria-pressed={viewMode === "list"}
            onClick={() => onViewModeChange("list")}
            className={cn(
              "flex h-8 w-8 items-center justify-center transition-all duration-200 rounded-md",
              viewMode === "list"
                ? "bg-white text-slate-900 shadow-xs dark:bg-surface dark:text-text-primary font-semibold"
                : "text-slate-500 hover:text-slate-900 dark:text-text-muted dark:hover:text-text-primary",
            )}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}


