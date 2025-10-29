"use client";

import { useEffect, useState } from "react";
import type { PubConfig } from "@/api/models";
import { getSessionInfo } from "@/api/auth";
import { getPubConfig, setPubConfig } from "@/api/users";
import { Config } from "@/config";

const emptyCfg: PubConfig = {
  siteName: "",
  author: "",
  introduction: "",
  designTheme: "",
  showServiceHeader: true,
  showSiteName: true,
  showPagenation: true,
  showSideProfile: true,
  showSideRecent: true,
};

export default function PageBody() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cfg, setCfg] = useState<PubConfig>(emptyCfg);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let canceled = false;
    getSessionInfo()
      .then(async (session) => {
        if (canceled) return;
        setUserId(session.userId);
        try {
          const current = await getPubConfig(session.userId);
          if (!canceled) setCfg({ ...emptyCfg, ...current });
        } catch {
          if (!canceled) setCfg(emptyCfg);
        } finally {
          if (!canceled) setLoading(false);
        }
      })
      .catch(() => {
        if (!canceled) {
          setUserId(null);
          setCfg(emptyCfg);
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

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

  const themeOptions =
    Array.isArray(Config.PUB_DESIGN_THEMES) && Config.PUB_DESIGN_THEMES.length > 0
      ? [...Config.PUB_DESIGN_THEMES]
      : ["default"];
  const themeHasMatch = cfg.designTheme.length > 0 && themeOptions.includes(cfg.designTheme);
  const themeSelectValue = themeHasMatch ? cfg.designTheme : themeOptions[0];

  return (
    <main className="max-w-lg mx-auto mt-12 p-4 bg-white shadow border rounded">
      <h1 className="text-2xl font-bold mb-6">Publication Settings</h1>

      <form onSubmit={handleSave} className="flex flex-col gap-6">
        <section>
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="block text-sm text-gray-700 mb-1">Site name</span>
              <input
                type="text"
                value={cfg.siteName}
                onChange={(e) => setField("siteName", e.target.value)}
                className="border px-2 py-1 rounded w-full"
                disabled={loading || saving}
              />
            </label>
            <label className="block">
              <span className="block text-sm text-gray-700 mb-1">Author</span>
              <input
                type="text"
                value={cfg.author}
                onChange={(e) => setField("author", e.target.value)}
                className="border px-2 py-1 rounded w-full"
                disabled={loading || saving}
              />
            </label>
            <label className="block">
              <span className="block text-sm text-gray-700 mb-1">Introduction</span>
              <textarea
                value={cfg.introduction}
                onChange={(e) => setField("introduction", e.target.value)}
                className="border px-2 py-1 rounded w-full min-h-[6rem]"
                disabled={loading || saving}
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
                disabled={loading || saving}
              >
                {themeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section>
          <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!cfg.showServiceHeader}
                onChange={(e) => setField("showServiceHeader", e.target.checked)}
                disabled={loading || saving}
              />
              <span>Show the service header</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!cfg.showSiteName}
                onChange={(e) => setField("showSiteName", e.target.checked)}
                disabled={loading || saving}
              />
              <span>Show the site name on top</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!cfg.showPagenation}
                onChange={(e) => setField("showPagenation", e.target.checked)}
                disabled={loading || saving}
              />
              <span>Show the post pagination</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!cfg.showSideProfile}
                onChange={(e) => setField("showSideProfile", e.target.checked)}
                disabled={loading || saving}
              />
              <span>Show the site profile in the sidebar</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!cfg.showSideRecent}
                onChange={(e) => setField("showSideRecent", e.target.checked)}
                disabled={loading || saving}
              />
              <span>Show recent posts in the sidebar</span>
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
            disabled={loading || saving}
          >
            Save
          </button>
        </div>
      </form>
    </main>
  );
}
