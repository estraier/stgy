"use client";

import { useEffect, useMemo, useState } from "react";
import { getSessionInfo } from "@/api/auth";
import { clearMetrics, getMetricsAggregation } from "@/api/root";
import type { SessionInfo } from "@/api/models";
import type { MetricsAggregation } from "@/api/root";

type TabKey = "summary" | "raw";
type SortKey = "name" | "calls" | "time" | "mean";
type SortDir = "asc" | "desc";

type NodeStatus =
  | { kind: "ok"; key: string; text: string }
  | { kind: "error"; key: string; message: string };

type NodeEndpointStats = {
  totalCount: number;
  totalSumSec: number;
  meanSec: number | null;
  statusCounts: Record<string, number>;
  bucketsCumulative: Record<string, number>;
};

type EndpointAgg = {
  endpointKey: string;
  method: string;
  path: string;

  totalCount: number;
  totalSumSec: number;
  meanSec: number | null;

  statusCounts: Record<string, number>;
  bucketsCumulative: Record<string, number>;
};

type BucketBar = {
  le: string;
  cumulative: number;
  delta: number;
};

function parsePromLine(
  line: string,
): { name: string; labels: Record<string, string>; value: number } | null {
  const s = line.trim();
  if (!s || s.startsWith("#")) return null;

  const firstSpace = s.indexOf(" ");
  if (firstSpace < 0) return null;

  const left = s.slice(0, firstSpace).trim();
  const right = s.slice(firstSpace + 1).trim();
  const value = Number(right);
  if (!Number.isFinite(value)) return null;

  const labels: Record<string, string> = {};
  const braceStart = left.indexOf("{");
  if (braceStart < 0) {
    return { name: left, labels, value };
  }
  const braceEnd = left.lastIndexOf("}");
  if (braceEnd < 0 || braceEnd < braceStart) return null;

  const name = left.slice(0, braceStart).trim();
  const body = left.slice(braceStart + 1, braceEnd);

  const parts = body.length === 0 ? [] : splitLabelPairs(body);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
      v = v.slice(1, -1);
    }
    v = v.replace(/\\(.)/g, "$1");
    if (k) labels[k] = v;
  }

  return { name, labels, value };
}

function splitLabelPairs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      cur += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      cur += ch;
      inStr = !inStr;
      continue;
    }
    if (ch === "," && !inStr) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

function compareNumber(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function leToSortable(le: string): number {
  if (le === "+Inf") return Number.POSITIVE_INFINITY;
  const n = Number(le);
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  return n;
}

function buildBucketBars(bucketsCumulative: Record<string, number>): BucketBar[] {
  const pairs = Object.entries(bucketsCumulative).map(([le, cumulative]) => ({
    le,
    leN: leToSortable(le),
    cumulative,
  }));
  pairs.sort((a, b) => compareNumber(a.leN, b.leN));

  const out: BucketBar[] = [];
  let prev = 0;
  for (const p of pairs) {
    const c = p.cumulative;
    const delta = c - prev;
    out.push({ le: p.le, cumulative: c, delta: delta >= 0 ? delta : 0 });
    prev = c;
  }
  return out;
}

function formatMs(sec: number | null): string {
  if (sec === null) return "-";
  const ms = sec * 1000;
  if (!Number.isFinite(ms)) return "-";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${ms.toFixed(0)}ms`;
  if (ms >= 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(2)}ms`;
}

function formatSec(sec: number): string {
  if (!Number.isFinite(sec)) return "-";
  if (sec >= 10) return `${sec.toFixed(2)}s`;
  if (sec >= 1) return `${sec.toFixed(3)}s`;
  return `${sec.toFixed(4)}s`;
}

function extractUpValue(text: string): number | null {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const parsed = parsePromLine(raw);
    if (!parsed) continue;
    if (parsed.name !== "up") continue;
    return parsed.value;
  }
  return null;
}

function summarizeNodeStatus(key: string, text: string): NodeStatus {
  const trimmed = text.trim();
  if (trimmed.startsWith("ERROR:")) {
    return { kind: "error", key, message: trimmed };
  }
  return { kind: "ok", key, text };
}

function parseNodeHttpHistogram(text: string): Record<string, NodeEndpointStats> {
  const perEndpoint: Record<string, NodeEndpointStats> = {};
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const parsed = parsePromLine(raw);
    if (!parsed) continue;

    const { name, labels, value } = parsed;
    if (
      name !== "http_request_duration_seconds_bucket" &&
      name !== "http_request_duration_seconds_sum" &&
      name !== "http_request_duration_seconds_count"
    ) {
      continue;
    }

    const method = labels.method;
    const path = labels.path;
    const statusCode = labels.status_code;

    if (!method || !path || !statusCode) continue;

    const endpointKey = `${method} ${path}`;
    const st = perEndpoint[endpointKey] || {
      totalCount: 0,
      totalSumSec: 0,
      meanSec: null,
      statusCounts: {},
      bucketsCumulative: {},
    };
    perEndpoint[endpointKey] = st;

    if (name === "http_request_duration_seconds_count") {
      st.totalCount += value;
      st.statusCounts[statusCode] = (st.statusCounts[statusCode] || 0) + value;
      continue;
    }

    if (name === "http_request_duration_seconds_sum") {
      st.totalSumSec += value;
      continue;
    }

    const le = labels.le;
    if (!le) continue;
    st.bucketsCumulative[le] = (st.bucketsCumulative[le] || 0) + value;
  }

  for (const k of Object.keys(perEndpoint)) {
    const st = perEndpoint[k];
    st.meanSec = st.totalCount > 0 ? st.totalSumSec / st.totalCount : null;
  }

  return perEndpoint;
}

function aggregateAcrossNodes(nodes: NodeStatus[]): {
  nodeOk: number;
  nodeErr: number;
  nodeUp: Record<string, number | null>;
  endpoints: EndpointAgg[];
} {
  let nodeOk = 0;
  let nodeErr = 0;
  const nodeUp: Record<string, number | null> = {};

  const agg: Record<string, EndpointAgg> = {};

  for (const ns of nodes) {
    if (ns.kind === "error") {
      nodeErr += 1;
      nodeUp[ns.key] = null;
      continue;
    }
    nodeOk += 1;

    const upVal = extractUpValue(ns.text);
    nodeUp[ns.key] = upVal;

    const perEndpoint = parseNodeHttpHistogram(ns.text);

    for (const [endpointKey, st] of Object.entries(perEndpoint)) {
      const method = endpointKey.split(" ")[0] || "";
      const path = endpointKey.slice(method.length + 1);

      const cur =
        agg[endpointKey] ||
        ({
          endpointKey,
          method,
          path,
          totalCount: 0,
          totalSumSec: 0,
          meanSec: null,
          statusCounts: {},
          bucketsCumulative: {},
        } satisfies EndpointAgg);

      agg[endpointKey] = cur;

      cur.totalCount += st.totalCount;
      cur.totalSumSec += st.totalSumSec;

      for (const [sc, c] of Object.entries(st.statusCounts)) {
        cur.statusCounts[sc] = (cur.statusCounts[sc] || 0) + c;
      }
      for (const [le, c] of Object.entries(st.bucketsCumulative)) {
        cur.bucketsCumulative[le] = (cur.bucketsCumulative[le] || 0) + c;
      }
    }
  }

  const endpoints: EndpointAgg[] = Object.values(agg).map((e) => ({
    ...e,
    meanSec: e.totalCount > 0 ? e.totalSumSec / e.totalCount : null,
  }));

  return { nodeOk, nodeErr, nodeUp, endpoints };
}

function defaultDirForSortKey(k: SortKey): SortDir {
  if (k === "name") return "asc";
  return "desc";
}

function histLabelForLe(le: string, prevFiniteLeSec: number | null): string {
  if (le === "+Inf") {
    if (prevFiniteLeSec === null) return "> -";
    return `> ${formatSec(prevFiniteLeSec)}`;
  }
  const n = Number(le);
  if (!Number.isFinite(n)) return `<= ${le}s`;
  return `<= ${formatMs(n)}`;
}

export default function PageBody() {
  const [tab, setTab] = useState<TabKey>("summary");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [metrics, setMetrics] = useState<MetricsAggregation | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          const agg = await getMetricsAggregation();
          if (canceled) return;
          setMetrics(agg);
        } catch (e) {
          if (canceled) return;
          setError(e ? String(e) : "Failed to load metrics.");
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
  }, []);

  const nodes = useMemo((): NodeStatus[] => {
    if (!metrics) return [];
    const xs = Object.entries(metrics).map(([k, v]) => summarizeNodeStatus(k, v));
    xs.sort((a, b) => a.key.localeCompare(b.key));
    return xs;
  }, [metrics]);

  const summary = useMemo(() => {
    return aggregateAcrossNodes(nodes);
  }, [nodes]);

  const sortedEndpoints = useMemo(() => {
    const xs = [...summary.endpoints];

    function cmp(a: EndpointAgg, b: EndpointAgg): number {
      if (sortKey === "name") return a.endpointKey.localeCompare(b.endpointKey);
      if (sortKey === "calls") return compareNumber(a.totalCount, b.totalCount);
      if (sortKey === "mean") {
        const am = a.meanSec === null ? Number.POSITIVE_INFINITY : a.meanSec;
        const bm = b.meanSec === null ? Number.POSITIVE_INFINITY : b.meanSec;
        return compareNumber(am, bm);
      }
      return compareNumber(a.totalSumSec, b.totalSumSec);
    }

    xs.sort((a, b) => {
      const r = cmp(a, b);
      return sortDir === "asc" ? r : -r;
    });

    return xs;
  }, [summary.endpoints, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(k);
    setSortDir(defaultDirForSortKey(k));
  }

  function sortMark(k: SortKey): string {
    if (sortKey !== k) return "";
    return sortDir === "asc" ? "▲" : "▼";
  }

  async function onClear() {
    if (clearing) return;
    const ok = window.confirm("Clear all metrics?");
    if (!ok) return;

    setError(null);
    setClearing(true);
    try {
      await clearMetrics();
      const agg = await getMetricsAggregation();
      setMetrics(agg);
    } catch (e) {
      setError(e ? String(e) : "Failed to clear metrics.");
    } finally {
      setClearing(false);
    }
  }

  const tabBtnBase = "px-3 py-1 rounded border text-sm select-none";
  const tabBtnOn = "bg-gray-900 text-white border-gray-900";
  const tabBtnOff = "bg-white text-gray-800 border-gray-300";

  const thBtnBase =
    "w-full text-left text-xs text-gray-700 select-none inline-flex items-center gap-1";
  const thBtnRight =
    "w-full text-right text-xs text-gray-700 select-none inline-flex items-center justify-end gap-1";

  return (
    <main className="max-w-3xl mx-auto mt-12 p-4 bg-white shadow border rounded">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Endpoints Dashboard</h1>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${tabBtnBase} ${tab === "summary" ? tabBtnOn : tabBtnOff}`}
            onClick={() => setTab("summary")}
            disabled={loading || clearing}
          >
            Summary
          </button>
          <button
            type="button"
            className={`${tabBtnBase} ${tab === "raw" ? tabBtnOn : tabBtnOff}`}
            onClick={() => setTab("raw")}
            disabled={loading || clearing}
          >
            Raw
          </button>
          <button
            type="button"
            className={`${tabBtnBase} bg-white text-red-700 border-red-300`}
            onClick={onClear}
            disabled={loading || clearing || !session || !session.userIsAdmin}
          >
            {clearing ? "Clearing..." : "Clear"}
          </button>
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

          {!error && !metrics && <div className="text-gray-700">No data.</div>}

          {!error && metrics && tab === "summary" && (
            <>
              {summary.nodeErr > 0 && (
                <div className="text-red-600 mb-4" role="alert">
                  Some nodes failed to respond: {summary.nodeErr}
                </div>
              )}

              <section className="border">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b bg-gray-50">
                  <div className="col-span-6">
                    <button type="button" className={thBtnBase} onClick={() => toggleSort("name")}>
                      <span>name</span>
                      <span className="font-mono">{sortMark("name")}</span>
                    </button>
                  </div>
                  <div className="col-span-2">
                    <button
                      type="button"
                      className={thBtnRight}
                      onClick={() => toggleSort("calls")}
                    >
                      <span>calls</span>
                      <span className="font-mono">{sortMark("calls")}</span>
                    </button>
                  </div>
                  <div className="col-span-2">
                    <button type="button" className={thBtnRight} onClick={() => toggleSort("time")}>
                      <span>total time</span>
                      <span className="font-mono">{sortMark("time")}</span>
                    </button>
                  </div>
                  <div className="col-span-2">
                    <button type="button" className={thBtnRight} onClick={() => toggleSort("mean")}>
                      <span>mean time</span>
                      <span className="font-mono">{sortMark("mean")}</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-col">
                  {sortedEndpoints.map((ep) => {
                    const statusPairs = Object.entries(ep.statusCounts).sort((a, b) => {
                      const r = compareNumber(b[1], a[1]);
                      return r !== 0 ? r : a[0].localeCompare(b[0]);
                    });

                    const bucketBars = buildBucketBars(ep.bucketsCumulative);
                    const maxDelta = bucketBars.reduce((m, b) => Math.max(m, b.delta), 0);

                    const finiteLes = bucketBars
                      .filter((b) => b.le !== "+Inf")
                      .map((b) => ({ le: b.le, leN: leToSortable(b.le) }))
                      .filter((x) => Number.isFinite(x.leN))
                      .sort((a, b) => compareNumber(a.leN, b.leN));

                    const prevFiniteForInf =
                      finiteLes.length > 0 ? finiteLes[finiteLes.length - 1].leN : null;

                    return (
                      <details key={ep.endpointKey} className="border-b last:border-b-0 group">
                        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer">
                          <div className="flex items-center px-3 py-2">
                            <span className="mr-2 text-xs font-mono text-gray-500 transition-transform group-open:rotate-90">
                              ▶
                            </span>
                            <div className="grid grid-cols-12 gap-2 flex-1 items-center text-sm">
                              <div className="col-span-6 font-mono break-all">{ep.endpointKey}</div>
                              <div className="col-span-2 text-right font-mono">
                                {Math.round(ep.totalCount)}
                              </div>
                              <div className="col-span-2 text-right font-mono">
                                {formatSec(ep.totalSumSec)}
                              </div>
                              <div className="col-span-2 text-right font-mono">
                                {formatMs(ep.meanSec)}
                              </div>
                            </div>
                          </div>
                        </summary>

                        <div className="px-3 pb-3 pt-1 text-sm">
                          <div className="mt-2">
                            <div className="flex flex-wrap gap-2">
                              {statusPairs.length === 0 ? (
                                <span className="text-gray-500">-</span>
                              ) : (
                                statusPairs.map(([sc, c]) => (
                                  <span
                                    key={sc}
                                    className="inline-flex items-center gap-1 border rounded px-2 py-0.5 text-xs"
                                  >
                                    <span className="font-mono">{sc}:</span>
                                    <span className="font-mono">{Math.round(c)}</span>
                                  </span>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="mt-4">
                            <div className="flex flex-col gap-1">
                              {bucketBars.length === 0 ? (
                                <div className="text-gray-500 text-xs">-</div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2">
                                    <div className="w-28 text-xs font-mono text-gray-500">bucket</div>
                                    <div className="flex-1" />
                                    <div className="w-44 text-right text-xs font-mono text-gray-500">
                                      <div className="grid grid-cols-2 gap-2 justify-items-end">
                                        <span>freq</span>
                                        <span>cum (%)</span>
                                      </div>
                                    </div>
                                  </div>
                                  {bucketBars.map((b) => {
                                    const w =
                                      maxDelta > 0 ? Math.round((b.delta / maxDelta) * 100) : 0;
                                    const label = histLabelForLe(b.le, prevFiniteForInf);
                                    const pct =
                                      ep.totalCount > 0 && Number.isFinite(ep.totalCount)
                                        ? (b.cumulative / ep.totalCount) * 100
                                        : Number.NaN;
                                    const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : "-";
                                    return (
                                      <div key={b.le} className="flex items-center gap-2">
                                        <div className="w-28 text-xs font-mono text-gray-700">
                                          {label}
                                        </div>
                                        <div className="flex-1 h-3 border rounded bg-white overflow-hidden">
                                          <div
                                            className="h-full bg-gray-800"
                                            style={{ width: `${w}%` }}
                                          />
                                        </div>
                                        <div className="w-44 text-right text-xs font-mono text-gray-700">
                                          <div className="grid grid-cols-2 gap-2 justify-items-end">
                                            <span>{Math.round(b.delta)}</span>
                                            <span>
                                              {Math.round(b.cumulative)} ({pctText})
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {!error && metrics && tab === "raw" && (
            <div className="flex flex-col gap-3">
              {nodes.map((n) => (
                <section key={n.key} className="border rounded p-3">
                  <div className="font-mono text-sm break-all mb-2">{n.key}</div>
                  {n.kind === "error" ? (
                    <div className="text-red-600 break-all">{n.message}</div>
                  ) : (
                    <pre className="p-3 bg-gray-50 border rounded overflow-auto text-xs leading-relaxed">
                      {n.text}
                    </pre>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
