"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PubConfig, PubViewDailyStatEntry, PubViewStats } from "@/api/models";
import { getSessionInfo } from "@/api/auth";
import { getPubConfig, getPubStats, setPubConfig } from "@/api/users";
import { Config } from "@/config";
import { formatDateTime } from "@/utils/format";

type Tab = "stats" | "settings";
type SortKey = "id" | "publishedAt" | "pv";
type SortDirection = "asc" | "desc";

const emptyCfg: PubConfig = {
  siteName: "",
  subtitle: "",
  author: "",
  introduction: "",
  designTheme: "",
  showServiceHeader: true,
  showSiteName: true,
  showPagenation: true,
  showSideProfile: true,
  showSideRecent: 5,
  showSidePopular: 5,
  extensions: {},
};

const emptyStats: PubViewStats = { retentionDays: 0, totalPv: 0, dailyPv: [], entries: [] };
const STATS_PAGE_SIZE = 50;
const SHARE_BUTTON_OPTIONS = [
  { id: "x", label: "X" },
  { id: "facebook", label: "Facebook" },
  { id: "hatena", label: "Hatena" },
] as const;
const SHARE_BUTTON_IDS = new Set<string>(SHARE_BUTTON_OPTIONS.map((option) => option.id));

function formatChartDate(date: string): string {
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function DailyPvChart({
  data,
  ariaLabel,
}: {
  data: PubViewDailyStatEntry[];
  ariaLabel?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) return null;

  const width = 680;
  const height = 190;
  const left = 54;
  const right = 12;
  const top = 26;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxPv = Math.max(1, ...data.map((entry) => entry.pv));
  const x = (index: number) =>
    left + (data.length <= 1 ? plotWidth / 2 : (index * plotWidth) / (data.length - 1));
  const y = (pv: number) => top + plotHeight - (pv / maxPv) * plotHeight;
  const points = data.map((entry, index) => `${x(index)},${y(entry.pv)}`).join(" ");
  const labelStep = Math.max(1, Math.ceil(data.length / 8));
  const labelIndexes = data
    .map((_, index) => index)
    .filter(
      (index) =>
        index === 0 || index === data.length - 1 || index % labelStep === 0,
    );

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((event.clientX - rect.left) / rect.width) * width;
    if (data.length <= 1) {
      setHoveredIndex(0);
      return;
    }
    const ratio = Math.max(0, Math.min(1, (svgX - left) / plotWidth));
    setHoveredIndex(Math.round(ratio * (data.length - 1)));
  }

  const hoveredEntry = hoveredIndex === null ? null : data[hoveredIndex];

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full h-auto"
        role="img"
        aria-label={ariaLabel ?? `Daily page views for the last ${data.length} days`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredIndex(null)}
      >
        {[0, 0.5, 1].map((ratio) => {
          const yy = top + plotHeight * ratio;
          const value = Math.round(maxPv * (1 - ratio));
          return (
            <g key={ratio}>
              <line
                x1={left}
                x2={width - right}
                y1={yy}
                y2={yy}
                stroke="currentColor"
                className="text-gray-200"
                strokeWidth="1"
              />
              <text
                x={left - 8}
                y={yy + 4}
                textAnchor="end"
                className="fill-gray-500 text-[11px]"
              >
                {value.toLocaleString()}
              </text>
            </g>
          );
        })}
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          className="text-gray-800"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {data.map((entry, index) => (
          <circle
            key={entry.date}
            cx={x(index)}
            cy={y(entry.pv)}
            r={hoveredIndex === index ? 4 : 2.5}
            fill="currentColor"
            className="text-gray-800"
          >
            <title>{`${entry.date}: ${entry.pv.toLocaleString()} PV`}</title>
          </circle>
        ))}
        {hoveredEntry && hoveredIndex !== null && (
          <text
            x={x(hoveredIndex)}
            y={y(hoveredEntry.pv) - 9}
            textAnchor="middle"
            className="fill-gray-900 text-[12px] font-medium tabular-nums"
            stroke="white"
            strokeWidth="3"
            paintOrder="stroke"
          >
            {hoveredEntry.pv.toLocaleString()}
          </text>
        )}
        {labelIndexes.map((index) => (
          <text
            key={data[index].date}
            x={x(index)}
            y={height - 8}
            textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
            className="fill-gray-500 text-[11px]"
          >
            {formatChartDate(data[index].date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ChartToggleIcon({ expanded }: { expanded: boolean }) {
  if (expanded) {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path
          d="M5 12.5 10 7.5l5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
      <path
        d="M3.5 15.5V4.5M3.5 15.5h13M6 12l3-3 2.5 2 4-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PageBody() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedPage = useMemo(() => {
    const value = Number(searchParams.get("page"));
    return Number.isInteger(value) && value > 0 ? value : 1;
  }, [searchParams]);

  const [tab, setTab] = useState<Tab>("stats");
  const [userId, setUserId] = useState<string | null>(null);
  const [cfg, setCfg] = useState<PubConfig>(emptyCfg);
  const [stats, setStats] = useState<PubViewStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("pv");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let canceled = false;
    getSessionInfo()
      .then(async (session) => {
        if (canceled) return;
        setUserId(session.userId);
        const [configResult, statsResult] = await Promise.allSettled([
          getPubConfig(session.userId),
          getPubStats(session.userId),
        ]);
        if (canceled) return;
        if (configResult.status === "fulfilled") {
          setCfg({ ...emptyCfg, ...configResult.value });
        } else {
          setCfg(emptyCfg);
        }
        if (statsResult.status === "fulfilled") {
          setStats(statsResult.value);
        } else {
          setStats(emptyStats);
          setStatsError(String(statsResult.reason || "Failed to load stats."));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!canceled) {
          setUserId(null);
          setCfg(emptyCfg);
          setStats(emptyStats);
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  const sortedEntries = useMemo(() => {
    const entries = [...stats.entries];
    entries.sort((a, b) => {
      let result = 0;
      if (sortKey === "id") {
        result = a.id.localeCompare(b.id);
      } else if (sortKey === "publishedAt") {
        result = Date.parse(a.publishedAt) - Date.parse(b.publishedAt);
      } else {
        result = a.pv - b.pv;
      }
      if (result === 0) result = a.id.localeCompare(b.id);
      return sortDirection === "asc" ? result : -result;
    });
    return entries;
  }, [sortDirection, sortKey, stats.entries]);

  const totalPages = Math.ceil(sortedEntries.length / STATS_PAGE_SIZE);
  const currentPage = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;
  const pageEntries = useMemo(() => {
    const start = (currentPage - 1) * STATS_PAGE_SIZE;
    return sortedEntries.slice(start, start + STATS_PAGE_SIZE);
  }, [currentPage, sortedEntries]);

  const replacePage = useCallback(
    (page: number) => {
      const next = new URLSearchParams(searchParams);
      if (page <= 1) next.delete("page");
      else next.set("page", String(page));
      router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (!loading && tab === "stats" && requestedPage !== currentPage) {
      replacePage(currentPage);
    }
  }, [currentPage, loading, replacePage, requestedPage, tab]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!userId) {
      setError("User information could not be retrieved. Please re-login.");
      return;
    }
    setSaving(true);
    try {
      const next = await setPubConfig(userId, cfg);
      setCfg({ ...emptyCfg, ...next });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e ? String(e) : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof PubConfig>(key: K, value: PubConfig[K]) {
    setCfg((prev) => ({ ...prev, [key]: value }));
  }

  function setShareButton(id: string, enabled: boolean) {
    setCfg((prev) => {
      const current = Array.isArray(prev.extensions.shareButtons)
        ? prev.extensions.shareButtons
        : [];
      const selected = new Set(current);
      if (enabled) selected.add(id);
      else selected.delete(id);

      const shareButtons = [
        ...SHARE_BUTTON_OPTIONS.filter((option) => selected.has(option.id)).map(
          (option) => option.id,
        ),
        ...current.filter((value) => !SHARE_BUTTON_IDS.has(value) && selected.has(value)),
      ];
      const extensions = { ...prev.extensions };
      if (shareButtons.length > 0) extensions.shareButtons = shareButtons;
      else delete extensions.shareButtons;
      return { ...prev, extensions };
    });
  }

  function setGoogleAnalyticsMeasurementId(measurementId: string) {
    setCfg((prev) => {
      const extensions = { ...prev.extensions };
      const analytics = { ...(prev.extensions.analytics ?? {}) };
      if (measurementId.length > 0) {
        analytics.googleAnalytics = {
          ...(analytics.googleAnalytics ?? {}),
          measurementId,
        };
      } else {
        delete analytics.googleAnalytics;
      }
      if (Object.keys(analytics).length > 0) extensions.analytics = analytics;
      else delete extensions.analytics;
      return { ...prev, extensions };
    });
  }

  function toggleSort(nextKey: SortKey) {
    replacePage(1);
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("desc");
  }

  function sortMark(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? "▲" : "▼";
  }

  function toggleEntryChart(id: string) {
    setExpandedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const themeOptions =
    Array.isArray(Config.PUB_DESIGN_THEMES) && Config.PUB_DESIGN_THEMES.length > 0
      ? [...Config.PUB_DESIGN_THEMES]
      : ["default"];
  const themeHasMatch = cfg.designTheme.length > 0 && themeOptions.includes(cfg.designTheme);
  const themeSelectValue = themeHasMatch ? cfg.designTheme : themeOptions[0];

  const tabButtonBase = "px-4 py-1 rounded border text-sm";
  const tabButtonOn = "bg-gray-900 text-white border-gray-900";
  const tabButtonOff = "bg-white text-gray-700 border-gray-300";
  const sortButton = "inline-flex items-center gap-1 font-medium whitespace-nowrap";

  return (
    <main className="max-w-3xl mx-auto mt-12 p-4 bg-white shadow border rounded">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Publications</h1>
        <div className="flex items-center gap-2" role="tablist" aria-label="Publication pages">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stats"}
            className={`${tabButtonBase} ${tab === "stats" ? tabButtonOn : tabButtonOff}`}
            onClick={() => setTab("stats")}
          >
            Stats
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            className={`${tabButtonBase} ${tab === "settings" ? tabButtonOn : tabButtonOff}`}
            onClick={() => setTab("settings")}
          >
            Settings
          </button>
        </div>
      </div>

      {loading && <div>Loading...</div>}

      {!loading && !userId && <div>Please login to view this page.</div>}

      {!loading && userId && tab === "stats" && (
        <section role="tabpanel">
          {statsError && (
            <div className="text-red-600 mb-4" role="alert">
              {statsError}
            </div>
          )}
          <div className="mb-5">
            <div className="text-sm text-gray-600">
              {stats.retentionDays > 0
                ? `Total PV in the last ${stats.retentionDays} days`
                : "Total PV"}
            </div>
            <div className="text-3xl font-bold tabular-nums ml-2">
              {stats.totalPv.toLocaleString()}
            </div>
            <DailyPvChart data={stats.dailyPv} />
          </div>

          <div className="overflow-hidden border rounded">
            <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-[28%] text-left px-2 sm:px-3 py-2 border-b">
                    <div className="flex flex-wrap items-center gap-x-1">
                      <button
                        type="button"
                        className={sortButton}
                        onClick={() => toggleSort("id")}
                      >
                        <span>ID</span>
                        <span className="font-mono">{sortMark("id")}</span>
                      </button>
                      <span aria-hidden="true">/</span>
                      <button
                        type="button"
                        className={sortButton}
                        onClick={() => toggleSort("publishedAt")}
                      >
                        <span>Date</span>
                        <span className="font-mono">{sortMark("publishedAt")}</span>
                      </button>
                    </div>
                  </th>
                  <th className="w-[62%] text-left px-2 sm:px-3 py-2 border-b">Content</th>
                  <th className="w-[10%] text-right px-2 sm:px-3 py-2 border-b">
                    <button
                      type="button"
                      className={`${sortButton} justify-end w-full`}
                      onClick={() => toggleSort("pv")}
                    >
                      <span>PV</span>
                      <span className="font-mono">{sortMark("pv")}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageEntries.map((entry) => {
                  const expanded = expandedEntryIds.has(entry.id);
                  const chartData = expanded
                    ? stats.dailyPv.map((day, index) => ({
                        date: day.date,
                        pv: entry.dailyPv[index] ?? 0,
                      }))
                    : [];
                  return (
                    <Fragment key={entry.id}>
                      <tr className="border-b align-top">
                        <td className="relative px-2 sm:px-3 py-2 pb-8">
                          <div className="font-mono break-all">
                            <Link href={`/posts/${entry.id}`} className="hover:underline">
                              {entry.id}
                            </Link>
                          </div>
                          <div className="mt-1 text-gray-600 break-words">
                            <Link href={`/pub/${entry.id}`} className="hover:underline">
                              {formatDateTime(new Date(entry.publishedAt))}
                            </Link>
                          </div>
                          <button
                            type="button"
                            className="absolute left-2 sm:left-3 bottom-2 inline-flex items-center justify-center text-gray-500 hover:text-gray-900"
                            aria-expanded={expanded}
                            aria-label={expanded ? "Hide page view graph" : "Show page view graph"}
                            title={expanded ? "Hide graph" : "Show graph"}
                            onClick={() => toggleEntryChart(entry.id)}
                          >
                            <ChartToggleIcon expanded={expanded} />
                          </button>
                        </td>
                        <td className="px-2 sm:px-3 py-2 whitespace-normal break-words">
                          {entry.digest}
                        </td>
                        <td className="px-2 sm:px-3 py-2 text-right tabular-nums break-words">
                          {entry.pv.toLocaleString()}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b">
                          <td colSpan={3} className="px-2 sm:px-3 py-2 bg-gray-50">
                            <DailyPvChart
                              data={chartData}
                              ariaLabel={`Daily page views for post ${entry.id} over the last ${stats.retentionDays} days`}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {sortedEntries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-gray-500">
                      No page views recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {sortedEntries.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-sm">
              <div className="text-gray-600">
                {sortedEntries.length} {sortedEntries.length === 1 ? "entry" : "entries"}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  className="px-3 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => replacePage(currentPage - 1)}
                >
                  Prev
                </button>
                <span className="whitespace-nowrap">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => replacePage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {!loading && userId && tab === "settings" && (
        <form onSubmit={handleSave} className="flex flex-col gap-6" role="tabpanel">
          <section>
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="block text-sm text-gray-700 mb-1">Site name</span>
                <input
                  type="text"
                  value={cfg.siteName}
                  onChange={(e) => setField("siteName", e.target.value)}
                  className="border px-2 py-1 rounded w-full"
                  disabled={saving}
                />
              </label>
              <label className="block">
                <span className="block text-sm text-gray-700 mb-1">Subtitle</span>
                <input
                  type="text"
                  value={cfg.subtitle}
                  onChange={(e) => setField("subtitle", e.target.value)}
                  className="border px-2 py-1 rounded w-full"
                  disabled={saving}
                />
              </label>
              <label className="block">
                <span className="block text-sm text-gray-700 mb-1">Author</span>
                <input
                  type="text"
                  value={cfg.author}
                  onChange={(e) => setField("author", e.target.value)}
                  className="border px-2 py-1 rounded w-full"
                  disabled={saving}
                />
              </label>
              <label className="block">
                <span className="block text-sm text-gray-700 mb-1">Introduction</span>
                <textarea
                  value={cfg.introduction}
                  onChange={(e) => setField("introduction", e.target.value)}
                  className="border px-2 py-1 rounded w-full min-h-[8rem]"
                  disabled={saving}
                />
              </label>
              <label className="block">
                <span className="block text-sm text-gray-700 mb-1">Design theme</span>
                <select
                  value={themeSelectValue}
                  onChange={(e) =>
                    setField("designTheme", e.target.value === "default" ? "" : e.target.value)
                  }
                  className="border px-2 py-1 rounded w-full"
                  disabled={saving}
                >
                  {themeOptions.map((theme) => (
                    <option key={theme} value={theme}>
                      {theme}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section>
            <div className="flex flex-col gap-3">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!cfg.showServiceHeader}
                  onChange={(e) => setField("showServiceHeader", e.target.checked)}
                  disabled={saving}
                />
                <span>Show the service header</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!cfg.showSiteName}
                  onChange={(e) => setField("showSiteName", e.target.checked)}
                  disabled={saving}
                />
                <span>Show the site name on top</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!cfg.showPagenation}
                  onChange={(e) => setField("showPagenation", e.target.checked)}
                  disabled={saving}
                />
                <span>Show the post pagination</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!cfg.showSideProfile}
                  onChange={(e) => setField("showSideProfile", e.target.checked)}
                  disabled={saving}
                />
                <span>Show the site profile in the sidebar</span>
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step={1}
                  value={cfg.showSideRecent}
                  onChange={(e) => setField("showSideRecent", Number(e.target.value))}
                  className="border px-2 py-1 rounded w-24"
                  disabled={saving}
                />
                <span>
                  Recent posts in the sidebar (maximum {Config.PUB_SIDE_POSTS_MAX}; 0 or less
                  to hide)
                </span>
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step={1}
                  value={cfg.showSidePopular}
                  onChange={(e) => setField("showSidePopular", Number(e.target.value))}
                  className="border px-2 py-1 rounded w-24"
                  disabled={saving}
                />
                <span>
                  Popular entries in the sidebar (maximum {Config.PUB_SIDE_POSTS_MAX}; 0 or
                  less to hide)
                </span>
              </label>
            </div>
          </section>

          <section className="border-t pt-5">
            <h2 className="text-lg font-semibold mb-3">Extensions</h2>
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-sm text-gray-700 mb-2">Share buttons</div>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {SHARE_BUTTON_OPTIONS.map((option) => (
                    <label key={option.id} className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(cfg.extensions.shareButtons ?? []).includes(option.id)}
                        onChange={(e) => setShareButton(option.id, e.target.checked)}
                        disabled={saving}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="block text-sm text-gray-700 mb-1">
                  Google Analytics Measurement ID
                </span>
                <input
                  type="text"
                  value={cfg.extensions.analytics?.googleAnalytics?.measurementId ?? ""}
                  onChange={(e) => setGoogleAnalyticsMeasurementId(e.target.value)}
                  maxLength={128}
                  placeholder="G-XXXXXXXXXX"
                  className="border px-2 py-1 rounded w-full"
                  disabled={saving}
                />
              </label>
            </div>
          </section>

          {error && (
            <div className="text-red-600 -mt-2" role="alert">
              {error}
            </div>
          )}
          {saved && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded -mt-2">
              Saved
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="bg-blue-600 text-white px-8 py-1 rounded disabled:opacity-60"
              disabled={saving}
            >
              Save
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
