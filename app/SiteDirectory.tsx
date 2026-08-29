"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteCard, type SiteCardData } from "./SiteCard";
import { SearchIcon } from "./icons";

type TriBoolFilter = "all" | "true" | "false";
type Sort = "name-asc" | "name-desc" | "tasks-desc" | "breached-desc";

const PAGE_SIZE = 12;
const SKELETON_COUNT = 8;

function SiteCardSkeleton() {
  return (
    <div className="site-card-skeleton" aria-hidden="true">
      <div className="skeleton line-lg" />
      <div className="skeleton-row">
        <div className="skeleton chip" />
        <div className="skeleton chip" />
        <div className="skeleton chip" />
      </div>
    </div>
  );
}

export function SiteDirectory() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [redZone, setRedZone] = useState<TriBoolFilter>("all");
  const [f90, setF90] = useState<TriBoolFilter>("all");
  const [slackActive, setSlackActive] = useState<TriBoolFilter>("all");
  const [emailActive, setEmailActive] = useState<TriBoolFilter>("all");
  const [sort, setSort] = useState<Sort>("name-asc");

  const [items, setItems] = useState<SiteCardData[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ sort, limit: String(PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (redZone !== "all") params.set("redZone", redZone);
      if (f90 !== "all") params.set("f90", f90);
      if (slackActive !== "all") params.set("slackActive", slackActive);
      if (emailActive !== "all") params.set("emailActive", emailActive);
      if (cursor) params.set("cursor", cursor);
      return params.toString();
    },
    [debouncedSearch, redZone, f90, slackActive, emailActive, sort],
  );

  // Filters/search/sort changed — reset and load the first page.
  useEffect(() => {
    let cancelled = false;

    async function loadFirstPage() {
      setLoading(true);
      try {
        const res = await fetch(`/api/sites?${buildQuery()}`);
        const data: { items: SiteCardData[]; nextCursor: string | null; total: number } = await res.json();
        if (cancelled) return;
        setItems(data.items);
        setNextCursor(data.nextCursor);
        setTotal(data.total);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFirstPage();
    return () => {
      cancelled = true;
    };
  }, [buildQuery]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetch(`/api/sites?${buildQuery(nextCursor)}`)
      .then((res) => res.json())
      .then((data: { items: SiteCardData[]; nextCursor: string | null }) => {
        setItems((prev) => [...prev, ...data.items]);
        setNextCursor(data.nextCursor);
      })
      .finally(() => setLoadingMore(false));
  }, [buildQuery, nextCursor, loadingMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  function toggleTriBool(value: TriBoolFilter, setValue: (v: TriBoolFilter) => void) {
    setValue(value === "true" ? "all" : "true");
  }

  const hasActiveFilters =
    search !== "" || redZone !== "all" || f90 !== "all" || slackActive !== "all" || emailActive !== "all";

  function clearFilters() {
    setSearch("");
    setRedZone("all");
    setF90("all");
    setSlackActive("all");
    setEmailActive("all");
  }

  const skeletons = useMemo(() => Array.from({ length: SKELETON_COUNT }, (_, i) => i), []);

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search sites…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search sites"
          />
        </div>
        <div className="toolbar-filters">
          <button
            type="button"
            className={`filter-chip${redZone === "true" ? " active redzone" : ""}`}
            onClick={() => toggleTriBool(redZone, setRedZone)}
            aria-pressed={redZone === "true"}
          >
            Red Zone
          </button>
          <button
            type="button"
            className={`filter-chip${f90 === "true" ? " active f90" : ""}`}
            onClick={() => toggleTriBool(f90, setF90)}
            aria-pressed={f90 === "true"}
          >
            F90
          </button>
          <button
            type="button"
            className={`filter-chip${slackActive === "true" ? " active slack" : ""}`}
            onClick={() => toggleTriBool(slackActive, setSlackActive)}
            aria-pressed={slackActive === "true"}
          >
            Slack active
          </button>
          <button
            type="button"
            className={`filter-chip${emailActive === "true" ? " active email" : ""}`}
            onClick={() => toggleTriBool(emailActive, setEmailActive)}
            aria-pressed={emailActive === "true"}
          >
            Email active
          </button>
          {hasActiveFilters && (
            <button type="button" className="toolbar-clear" onClick={clearFilters}>
              Clear filters ×
            </button>
          )}
        </div>
        <div className="toolbar-sort">
          <label htmlFor="site-sort">Sort</label>
          <select id="site-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name-asc">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
            <option value="tasks-desc">Most active tasks</option>
            <option value="breached-desc">Most breached</option>
          </select>
        </div>
      </div>

      {total !== null && !loading && (
        <p className="result-count">
          {total} site{total === 1 ? "" : "s"}
        </p>
      )}

      {loading ? (
        <div className="site-grid">
          {skeletons.map((i) => (
            <SiteCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <span>
              No sites match<span className="accent-dot">.</span>
            </span>
            <span className="empty-sub">Try clearing a filter or search term.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="site-grid">
            {items.map((site) => (
              <SiteCard key={site.id} site={site} />
            ))}
          </div>
          <div ref={sentinelRef} className="scroll-sentinel" />
          {loadingMore && <div className="load-more-status">Loading more…</div>}
          {!nextCursor && items.length > 0 && (
            <div className="load-more-status">All {items.length} sites loaded</div>
          )}
        </>
      )}
    </div>
  );
}
