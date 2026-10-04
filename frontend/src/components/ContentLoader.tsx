/**
 * Lightweight inline skeleton loader for Suspense fallback inside layouts.
 * Keeps the sidebar/header visible — only the content area shows a pulse.
 */
export function ContentLoader() {
  return (
    <div className="min-h-[640px] animate-pulse space-y-6 py-1" aria-label="Đang tải nội dung">
      <div className="min-h-16 space-y-2">
        <div className="h-7 w-52 rounded bg-slate-200 dark:bg-surface-elevated" />
        <div className="h-4 w-full max-w-md rounded bg-slate-100 dark:bg-surface-elevated/60" />
      </div>

      <div className="grid min-h-28 grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 rounded-lg border border-slate-200 bg-slate-100 dark:border-border-subtle dark:bg-surface-elevated/40"
          />
        ))}
      </div>

      <div className="min-h-[360px] overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-border-subtle dark:bg-surface">
        <div className="h-12 border-b border-slate-200 bg-slate-100 dark:border-border-subtle dark:bg-surface-elevated/50" />
        <div className="space-y-3 p-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-10 rounded bg-slate-100 dark:bg-surface-elevated/30" />
          ))}
        </div>
      </div>
    </div>
  );
}
