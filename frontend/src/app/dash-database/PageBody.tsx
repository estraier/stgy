"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSessionInfo } from "@/api/auth";
import type { SessionInfo, QueryStats } from "@/api/models";
import {
  checkDbStatsEnabled,
  clearDbStats,
  disableDbStats,
  enableDbStats,
  listSlowQueries,
} from "@/api/dbStats";

type Order = "asc" | "desc";

const PAGE_SIZE = 100;

function formatTimeMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "-";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${ms.toFixed(0)}ms`;
  if (ms >= 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(2)}ms`;
}

function toIntSafe(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

export default function PageBody() {
  const [session, setSession] = useState<SessionInfo | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [order, setOrder] = useState<Order>("desc");

  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<QueryStats[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPrev = page > 0;
  const canNext = hasNext;

  const pageOffset = page * PAGE_SIZE;

  function normalizeEnabledHeader(v: boolean | null): string {
    if (v === null) return "-";
    return v ? "enabled" : "disabled";
  }

  const pageTitle = useMemo(() => {
    const p = page + 1;
    const o = pageOffset + 1;
    const end = pageOffset + rows.length;
    const range = rows.length > 0 ? `${o}-${end}` : "-";
    return `page ${p} (${range})`;
  }, [page, pageOffset, rows.length]);

  const fetchListPage = useCallback(async (p: number, o: Order) => {
    const xs = await listSlowQueries({
      offset: p * PAGE_SIZE,
      limit: PAGE_SIZE + 1,
      order: o,
    });
    const next = xs.length > PAGE_SIZE;
    setHasNext(next);
    setRows(next ? xs.slice(0, PAGE_SIZE) : xs);
  }, []);

  const refreshEnabledAndMaybeList = useCallback(
    async (p: number, o: Order) => {
      setError(null);

      const en = await checkDbStatsEnabled();
      setEnabled(en);

      if (!en) {
        setRows([]);
        setHasNext(false);
        setLoadingList(false);
        return;
      }

      setLoadingList(true);
      try {
        await fetchListPage(p, o);
      } finally {
        setLoadingList(false);
      }
    },
    [fetchListPage],
  );

  useEffect(() => {
    let canceled = false;

    getSessionInfo()
      .then(async (s) => {
        if (canceled) return;
        setSession(s);

        if (!s.userIsAdmin) {
          setLoading(false);
          return;
        }

        try {
          await refreshEnabledAndMaybeList(0, "desc");
          if (!canceled) {
            setOrder("desc");
            setPage(0);
          }
        } catch (e) {
          if (!canceled) setError(e ? String(e) : "Failed to load DB stats.");
        } finally {
          if (!canceled) setLoading(false);
        }
      })
      .catch(() => {
        if (!canceled) {
          setSession(null);
          setLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [refreshEnabledAndMaybeList]);

  async function onEnable() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await enableDbStats();
      setPage(0);
      await refreshEnabledAndMaybeList(0, order);
    } catch (e) {
      setError(e ? String(e) : "Failed to enable DB stats.");
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await disableDbStats();
      await refreshEnabledAndMaybeList(0, order);
      setPage(0);
    } catch (e) {
      setError(e ? String(e) : "Failed to disable DB stats.");
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    if (busy) return;
    const ok = window.confirm("Clear pg_stat_statements?");
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      await clearDbStats();
      setPage(0);
      await refreshEnabledAndMaybeList(0, order);
    } catch (e) {
      setError(e ? String(e) : "Failed to clear DB stats.");
    } finally {
      setBusy(false);
    }
  }

  async function onRefresh() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await refreshEnabledAndMaybeList(page, order);
    } catch (e) {
      setError(e ? String(e) : "Failed to refresh.");
    } finally {
      setBusy(false);
    }
  }

  async function goPrev() {
    if (!canPrev || busy) return;
    const next = page - 1;

    setPage(next);
    setError(null);
    setLoadingList(true);
    try {
      await fetchListPage(next, order);
    } catch (e) {
      setError(e ? String(e) : "Failed to load page.");
    } finally {
      setLoadingList(false);
    }
  }

  async function goNext() {
    if (!canNext || busy) return;
    const next = page + 1;

    setPage(next);
    setError(null);
    setLoadingList(true);
    try {
      await fetchListPage(next, order);
    } catch (e) {
      setError(e ? String(e) : "Failed to load page.");
    } finally {
      setLoadingList(false);
    }
  }

  async function toggleOrder() {
    if (busy) return;
    const next: Order = order === "desc" ? "asc" : "desc";

    setOrder(next);
    setPage(0);
    setError(null);
    setLoadingList(true);
    try {
      await fetchListPage(0, next);
    } catch (e) {
      setError(e ? String(e) : "Failed to load slow queries.");
    } finally {
      setLoadingList(false);
    }
  }

  const btnBase =
    "px-3 py-1 rounded border text-sm select-none whitespace-nowrap transition-colors cursor-pointer " +
    "disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 " +
    "disabled:hover:bg-gray-100";
  const btnPrimary = "bg-gray-900 text-white border-gray-900 hover:bg-gray-800";
  const btnNeutral = "bg-white text-gray-800 border-gray-300 hover:bg-gray-50";
  const btnDanger = "bg-white text-red-700 border-red-300 hover:bg-red-50";

  return (
    <main className="max-w-3xl mx-auto mt-12 p-4 bg-white shadow border rounded">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-2xl font-bold">Database Dashboard</h1>
          <div className="text-xs text-gray-600 font-mono">
            status: {normalizeEnabledHeader(enabled)} · {pageTitle} · order: {order}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${btnBase} ${btnNeutral}`}
            onClick={onRefresh}
            disabled={loading || busy || !session || !session.userIsAdmin}
            title="Refresh status and current page"
          >
            {busy ? "Working..." : "Refresh"}
          </button>

          {enabled ? (
            <>
              <button
                type="button"
                className={`${btnBase} ${btnDanger}`}
                onClick={onClear}
                disabled={loading || busy || !session || !session.userIsAdmin}
                title="Clear pg_stat_statements"
              >
                Clear
              </button>
              <button
                type="button"
                className={`${btnBase} ${btnNeutral}`}
                onClick={onDisable}
                disabled={loading || busy || !session || !session.userIsAdmin}
                title="Disable pg_stat_statements tracking"
              >
                Disable
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`${btnBase} ${btnPrimary}`}
              onClick={onEnable}
              disabled={loading || busy || !session || !session.userIsAdmin}
              title="Enable pg_stat_statements tracking"
            >
              Enable
            </button>
          )}
        </div>
      </div>

      {loading && <div>Loading...</div>}

      {!loading && !session && (
        <div className="text-gray-700">Please login as an administrator to view this page.</div>
      )}

      {!loading && session && !session.userIsAdmin && (
        <div className="text-gray-700">This page is for administrators only.</div>
      )}

      {!loading && session && session.userIsAdmin && (
        <>
          {error && (
            <div className="text-red-600 mb-4" role="alert">
              {error}
            </div>
          )}

          {enabled === false && !error && (
            <div className="text-gray-700">
              DB stats is disabled. Click <span className="font-mono">Enable</span> to start
              collecting query stats.
            </div>
          )}

          {enabled === true && (
            <>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-xl font-bold">Slow queries</h2>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`${btnBase} ${btnNeutral}`}
                    onClick={toggleOrder}
                    disabled={busy || loadingList}
                    title="Toggle sort order"
                  >
                    Order: {order}
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`${btnBase} ${btnNeutral}`}
                      onClick={goPrev}
                      disabled={busy || loadingList || !canPrev}
                      title="Previous page"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      className={`${btnBase} ${btnNeutral}`}
                      onClick={goNext}
                      disabled={busy || loadingList || !canNext}
                      title="Next page"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>

              <section className="border overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b bg-gray-50 min-w-0">
                  <div className="col-span-7 min-w-0">
                    <div className="w-full text-left text-xs text-gray-700 select-none inline-flex items-center gap-1 whitespace-nowrap">
                      <span>query</span>
                    </div>
                  </div>
                  <div className="col-span-1 min-w-0">
                    <div className="w-full text-right text-xs text-gray-700 select-none inline-flex items-center justify-end gap-1 whitespace-nowrap">
                      <span>calls</span>
                    </div>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <div className="w-full text-right text-xs text-gray-700 select-none inline-flex items-center justify-end gap-1 whitespace-nowrap">
                      <span>total</span>
                    </div>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <div className="w-full text-right text-xs text-gray-700 select-none inline-flex items-center justify-end gap-1 whitespace-nowrap">
                      <span>mean</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col min-w-0">
                  {loadingList && <div className="px-3 py-3 text-sm text-gray-600">Loading...</div>}

                  {!loadingList && rows.length === 0 && (
                    <div className="px-3 py-3 text-sm text-gray-600">No data.</div>
                  )}

                  {!loadingList &&
                    rows.map((r, idx) => {
                      const calls = toIntSafe(r.calls);
                      const totalMs = r.totalExecTime;
                      const meanMs = calls > 0 ? totalMs / calls : Number.NaN;

                      return (
                        <details
                          key={`${pageOffset}-${idx}`}
                          className="border-b last:border-b-0 group"
                        >
                          <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer">
                            <div className="flex items-center px-3 py-2 min-w-0">
                              <span className="mr-2 text-xs font-mono text-gray-500 transition-transform group-open:rotate-90 whitespace-nowrap">
                                ▶
                              </span>

                              <div className="grid grid-cols-12 gap-2 flex-1 items-center text-sm min-w-0">
                                <div className="col-span-7 font-mono min-w-0" title={r.query}>
                                  <span className="block truncate group-open:whitespace-normal group-open:break-words">
                                    {r.query}
                                  </span>
                                </div>
                                <div className="col-span-1 text-right font-mono whitespace-nowrap">
                                  {calls}
                                </div>
                                <div className="col-span-2 text-right font-mono whitespace-nowrap">
                                  {formatTimeMs(totalMs)}
                                </div>
                                <div className="col-span-2 text-right font-mono whitespace-nowrap">
                                  {Number.isFinite(meanMs) ? formatTimeMs(meanMs) : "-"}
                                </div>
                              </div>
                            </div>
                          </summary>

                          <div className="px-3 pb-3 pt-1 text-sm">
                            <pre className="p-3 bg-gray-50 border rounded overflow-auto text-xs leading-relaxed whitespace-pre-wrap break-words">
                              {r.query}
                            </pre>
                          </div>
                        </details>
                      );
                    })}
                </div>
              </section>

              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="text-xs text-gray-600 font-mono">
                  offset={pageOffset} limit={PAGE_SIZE}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`${btnBase} ${btnNeutral}`}
                    onClick={goPrev}
                    disabled={busy || loadingList || !canPrev}
                    title="Previous page"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className={`${btnBase} ${btnNeutral}`}
                    onClick={goNext}
                    disabled={busy || loadingList || !canNext}
                    title="Next page"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
