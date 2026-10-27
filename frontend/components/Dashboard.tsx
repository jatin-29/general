"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getOpenings, setApplied, type Opening, type OpeningList } from "@/lib/api";
import Filters, { type FilterState } from "./Filters";
import OpeningCard from "./OpeningCard";
import { useToast } from "./Toast";

const LIMIT = 20;
const REFRESH_MS = 60_000;

function SkeletonCard() {
  return <div className="card h-[88px] animate-pulse bg-slate-100 dark:bg-slate-900" />;
}

export default function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();

  // URL is the source of truth for filters.
  const filters: FilterState = {
    source: params.get("source") ?? "",
    type: params.get("type") ?? "",
    location: params.get("location") ?? "",
    search: params.get("search") ?? "",
    hideApplied: params.get("hide_applied") === "1",
    showExpired: params.get("expired") === "1",
  };
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  // Text inputs keep local state so typing stays responsive; URL updates are debounced.
  const [search, setSearch] = useState(filters.search);
  const [location, setLocation] = useState(filters.location);
  useEffect(() => setSearch(filters.search), [filters.search]);
  useEffect(() => setLocation(filters.location), [filters.location]);

  const updateUrl = useCallback(
    (patch: Partial<FilterState>, resetPage = true) => {
      const next = { ...filters, ...patch };
      const q = new URLSearchParams();
      if (next.source) q.set("source", next.source);
      if (next.type) q.set("type", next.type);
      if (next.location) q.set("location", next.location);
      if (next.search) q.set("search", next.search);
      if (next.hideApplied) q.set("hide_applied", "1");
      if (next.showExpired) q.set("expired", "1");
      const pg = resetPage ? 1 : page;
      if (pg > 1) q.set("page", String(pg));
      router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, pathname, router],
  );

  useEffect(() => {
    if (search === filters.search && location === filters.location) return;
    const t = setTimeout(() => updateUrl({ search, location }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, location]);

  const [data, setData] = useState<OpeningList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const lastErrorToast = useRef(0);

  const key = params.toString();
  const load = useCallback(
    async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const res = await getOpenings({
          source: filters.source,
          type: filters.type,
          location: filters.location,
          search: filters.search,
          active_only: !filters.showExpired,
          hide_applied: filters.hideApplied || undefined,
          page,
          limit: LIMIT,
        });
        setData(res);
        setError(null);
        setUpdatedAt(new Date());
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load openings";
        setError(msg);
        if (Date.now() - lastErrorToast.current > 30_000) {
          lastErrorToast.current = Date.now();
          toast(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function toggleApplied(o: Opening) {
    const patch = (applied: boolean) =>
      setData((d) => d && { ...d, items: d.items.map((x) => (x.id === o.id ? { ...x, applied } : x)) });
    patch(!o.applied); // optimistic
    try {
      await setApplied(o.id, !o.applied);
    } catch (e) {
      patch(o.applied);
      toast(e instanceof Error ? e.message : "Could not update");
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  const goPage = (p: number) => {
    const q = new URLSearchParams(params.toString());
    if (p > 1) q.set("page", String(p));
    else q.delete("page");
    router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: true });
  };

  return (
    <div className="space-y-4">
      <Filters
        value={{ ...filters, search, location }}
        onChange={(patch) => {
          if ("search" in patch) setSearch(patch.search!);
          else if ("location" in patch) setLocation(patch.location!);
          else updateUrl(patch);
        }}
        onReset={() => router.replace(pathname)}
      />

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{data ? `${data.total} opening${data.total === 1 ? "" : "s"}` : " "}</span>
        <span>{updatedAt ? `Last updated ${updatedAt.toLocaleTimeString()} · refreshes every 60s` : ""}</span>
      </div>

      {error && !data ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button className="btn-ghost" onClick={() => load(true)}>
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <SkeletonCard key={i} />)}</div>
      ) : data && data.items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-medium">No openings found</p>
          <p className="mt-1 text-sm text-slate-500">Try clearing filters, add sources, or upload a WhatsApp export.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data?.items.map((o) => <OpeningCard key={o.id} opening={o} onToggleApplied={toggleApplied} />)}
        </div>
      )}

      {data && totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3 pt-2 text-sm" aria-label="Pagination">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => goPage(page - 1)}>
            ← Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button className="btn-ghost" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>
            Next →
          </button>
        </nav>
      )}
    </div>
  );
}
