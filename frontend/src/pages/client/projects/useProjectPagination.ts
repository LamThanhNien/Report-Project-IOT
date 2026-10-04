import { useState, useMemo, useEffect } from "react";

export interface UsePaginationResult<T> {
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  pagedItems: T[];
  resetPage: () => void;
}

/**
 * usePagination — safe client-side pagination hook.
 *
 * Safety guarantees:
 * - Handles undefined / null input gracefully (treats as empty array).
 * - Auto-clamps page when totalPages decreases (e.g. after a filter narrows results).
 * - Empty state: returns [] + totalPages=1 + page=0 (PaginationBar hides when items=0).
 * - Single-page state: PaginationBar remains visible when items > 0, with Prev/Next disabled.
 *
 * @param items   The full filtered array to paginate (may be undefined/null).
 * @param pageSize Number of items per page (must be > 0).
 * @param resetDeps Changing any value in this tuple resets page to 0 automatically.
 */
export function usePagination<T>(
  items: T[] | undefined | null,
  pageSize: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resetDeps: readonly any[] = [],
): UsePaginationResult<T> {
  const safe = items ?? [];
  const [page, setPageRaw] = useState(0);

  // Reset page when deps change (search, filter, tab switch, etc.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPageRaw(0); }, resetDeps);

  const totalPages = Math.max(1, Math.ceil(safe.length / pageSize));

  // Clamp page if totalPages shrinks beneath current page
  useEffect(() => {
    if (page >= totalPages) {
      setPageRaw(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  const safePage = Math.max(0, Math.min(page, totalPages - 1));

  const pagedItems = useMemo(
    () => safe.slice(safePage * pageSize, (safePage + 1) * pageSize),
    // safe reference changes whenever items content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [safe, safePage, pageSize],
  );

  function setPage(p: number) {
    setPageRaw(Math.max(0, Math.min(p, totalPages - 1)));
  }

  function resetPage() {
    setPageRaw(0);
  }

  return { page: safePage, setPage, totalPages, pagedItems, resetPage };
}
