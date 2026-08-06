"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PubConfig, PubViewStats } from "@/api/models";
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
};

const emptyStats: PubViewStats = { totalPv: 0, entries: [] };

export default function PageBody() {
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

  function toggleSort(nextKey: SortKey) {
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
    <main className="max-w-5xl mx-auto mt-12 p-4 bg-white shadow border rounded">
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
            <div className="text-sm text-gray-600">Total PV in the last 10 days</div>
            <div className="text-3xl font-bold tabular-nums">{stats.totalPv.toLocaleString()}</div>
          </div>

          <div className="overflow-x-auto border rounded">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 border-b">
                    <button type="button" className={sortButton} onClick={() => toggleSort("id")}>
                      <span>ID</span>
                      <span className="font-mono">{sortMark("id")}</span>
                    </button>
                  </th>
                  <th className="text-left px-3 py-2 border-b">
                    <button
                      type="button"
                      className={sortButton}
                      onClick={() => toggleSort("publishedAt")}
                    >
                      <span>Published at</span>
                      <span className="font-mono">{sortMark("publishedAt")}</span>
                    </button>
                  </th>
                  <th className="text-left px-3 py-2 border-b">Digest</th>
                  <th className="text-right px-3 py-2 border-b">
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
                {sortedEntries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-b-0 align-top">
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      <Link href={`/posts/${entry.id}`} className="hover:underline">
                        {entry.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/pub/${entry.id}`} className="hover:underline">
                        {formatDateTime(new Date(entry.publishedAt))}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-normal break-words">{entry.digest}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {entry.pv.toLocaleString()}
                    </td>
                  </tr>
                ))}
                {sortedEntries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                      No page views recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                <span>Recent posts in the sidebar (0 or less to hide)</span>
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
                <span>Popular entries in the sidebar (0 or less to hide)</span>
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
