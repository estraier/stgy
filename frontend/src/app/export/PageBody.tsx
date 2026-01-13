"use client";

import { useEffect, useMemo, useState } from "react";
import { getSessionInfo } from "@/api/auth";
import { getUser } from "@/api/users";
import type { UserDetail } from "@/api/models";
import { makeArticleHtmlFromMarkdown } from "@/utils/article";
import { buildZipStore } from "@/utils/zip";
import { Config } from "@/config";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTimestampYYYYMMDDhhmmss(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteImageObjectUrlsToRelative(text: string, userId: string): string {
  const uid = escapeRegExp(userId);

  // Match only:
  // /images/{userId}/(masters|thumbs|master|thumb)/\d{6}/[0-9a-f]{16}\.[A-Za-z0-9]{1,5}
  // Optionally allow ?... or #... (we drop them by design for local filenames)
  const re = new RegExp(
    String.raw`\/images\/${uid}\/(?:masters|thumbs|master|thumb)\/(\d{6})\/([0-9a-f]{16})\.([A-Za-z0-9]{1,5})(?:[?#][^)\s"'<>]*)?`,
    "g",
  );

  return String(text || "").replace(re, (_m, rev6: string, hex16: string, ext: string) => {
    const filename = `${rev6}${hex16}.${ext}`;
    return `./images/${filename}`;
  });
}

function rewriteProfileIntroductionAndSnippet(profile: UserDetail, userId: string): UserDetail {
  const intro =
    typeof (profile as unknown as { introduction?: unknown }).introduction === "string"
      ? String((profile as unknown as { introduction: string }).introduction)
      : null;

  const snippet = typeof profile.snippet === "string" ? profile.snippet : "[]";

  const rewrittenIntro = intro !== null ? rewriteImageObjectUrlsToRelative(intro, userId) : null;
  const rewrittenSnippet = rewriteImageObjectUrlsToRelative(snippet, userId);

  const next: UserDetail = {
    ...profile,
    snippet: rewrittenSnippet,
  } as UserDetail;

  if (rewrittenIntro !== null) {
    (next as unknown as { introduction: string }).introduction = rewrittenIntro;
  }

  return next;
}

function getPublicUrlFromStoragePath(storagePath: string, version?: string | null): string | null {
  const p = String(storagePath || "").replace(/^\/+/, "");
  const i = p.indexOf("/");
  if (i <= 0) return null;

  const bucket = p.slice(0, i);
  const key = p.slice(i + 1).replace(/^\/+/, "");

  const base = String(Config.STORAGE_S3_PUBLIC_URL_PREFIX || "").replace("{bucket}", bucket);
  const prefix = base.replace(/\/+$/, "");
  const suffix =
    version && String(version).trim() !== "" ? `?v=${encodeURIComponent(String(version))}` : "";
  return `${prefix}/${key}${suffix}`;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error(`Failed to download avatar: ${resp.status} ${resp.statusText}`);
  }
  const ab = await resp.arrayBuffer();
  return new Uint8Array(ab);
}

function renderProfileHtml(profile: UserDetail): string {
  const locale = (profile.locale && String(profile.locale)) || "en";
  const nickname = profile.nickname ? String(profile.nickname) : "User";
  const userId = profile.id ? String(profile.id) : "";

  const hasIntro = typeof (profile as unknown as { introduction?: unknown }).introduction === "string";
  const introMd = hasIntro ? String((profile as unknown as { introduction: string }).introduction) : "";
  const bodyHtml = hasIntro ? makeArticleHtmlFromMarkdown(introMd, false, undefined, false) : "";
  const timezone = profile.timezone ? String(profile.timezone) : "";
  const isAdmin = typeof profile.isAdmin === "boolean" ? profile.isAdmin : false;
  const blockStrangers =
    typeof (profile as unknown as { blockStrangers?: boolean }).blockStrangers === "boolean"
      ? (profile as unknown as { blockStrangers: boolean }).blockStrangers
      : false;

  const createdAt =
    typeof (profile as unknown as { createdAt?: string }).createdAt === "string"
      ? (profile as unknown as { createdAt: string }).createdAt
      : "";
  const updatedAt =
    typeof (profile as unknown as { updatedAt?: string | null }).updatedAt === "string"
      ? (profile as unknown as { updatedAt: string }).updatedAt
      : "";

  const countFollowers =
    typeof (profile as unknown as { countFollowers?: unknown }).countFollowers === "number"
      ? (profile as unknown as { countFollowers: number }).countFollowers
      : null;

  const countFollowees =
    typeof (profile as unknown as { countFollowees?: unknown }).countFollowees === "number"
      ? (profile as unknown as { countFollowees: number }).countFollowees
      : null;

  const countPosts =
    typeof (profile as unknown as { countPosts?: unknown }).countPosts === "number"
      ? (profile as unknown as { countPosts: number }).countPosts
      : null;

  const hasCounts = countFollowers !== null || countFollowees !== null || countPosts !== null;
  const countsRowHtml = hasCounts
    ? `<h2>Counts</h2>
       <table>
         ${countFollowers !== null ? `<tr><th>Followers</th><td>${countFollowers}</td></tr>` : ""}
         ${countFollowees !== null ? `<tr><th>Followees</th><td>${countFollowees}</td></tr>` : ""}
         ${countPosts !== null ? `<tr><th>Posts</th><td>${countPosts}</td></tr>` : ""}
       </table>`
    : "";

  const hasAvatar = typeof profile.avatar === "string" && profile.avatar.trim() !== "";
  const avatarHtml = hasAvatar ? `<img src="avatar.webp" alt="Avatar" class="avatar" />` : "";
  const headerHtml = hasAvatar
    ? `<div class="row">
        ${avatarHtml}
        <div>
          <h1>${escapeHtml(nickname)}</h1>
          <p class="muted">User ID: <code>${escapeHtml(userId)}</code></p>
        </div>
      </div>`
    : `<div>
        <h1>${escapeHtml(nickname)}</h1>
        <p class="muted">User ID: <code>${escapeHtml(userId)}</code></p>
      </div>`;

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(nickname)} - STGY Profile</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; background: #fff; color: #111827; }
    main { max-width: 720px; margin: 48px auto; padding: 16px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 16px; margin: 20px 0 8px; color: #374151; }
    .muted { color: #6b7280; font-size: 14px; margin: 0 0 16px; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
    .row { display: flex; gap: 16px; align-items: center; }
    .avatar { width: 72px; height: 72px; border-radius: 9999px; object-fit: cover; border: 1px solid #e5e7eb; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 0; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    th { width: 180px; color: #6b7280; font-weight: 600; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.95em; }
    .markdown-body { line-height: 1.7; word-break: break-word; }
    .markdown-body p { margin: 0.6em 0; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin: 1.0em 0 0.4em; }
    .markdown-body pre { padding: 12px; background: #0b1020; color: #e5e7eb; border-radius: 10px; overflow: auto; }
    .markdown-body pre code { color: inherit; }
    .markdown-body code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 6px; }
    .markdown-body pre code { background: transparent; padding: 0; }
    .markdown-body blockquote { margin: 0.8em 0; padding-left: 12px; border-left: 3px solid #e5e7eb; color: #374151; }
    .markdown-body ul { margin: 0.6em 0; padding-left: 1.2em; }
    .markdown-body a { color: #2563eb; text-decoration: underline; }
    figure.image-block { margin: 0.8em 0; }
    figure.image-block img { max-width: 100%; height: auto; border-radius: 10px; border: 1px solid #e5e7eb; }
    figure.image-block figcaption { color: #6b7280; font-size: 0.9em; margin-top: 6px; }
    .image-grid { display: grid; gap: 8px; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      ${headerHtml}

      <h2>Profile</h2>
      <div class="markdown-body">
        ${bodyHtml}
      </div>

      ${countsRowHtml}

      <h2>Settings</h2>
      <table>
        <tr><th>Locale</th><td>${escapeHtml(locale)}</td></tr>
        <tr><th>Timezone</th><td>${escapeHtml(timezone)}</td></tr>
        <tr><th>Is admin</th><td>${isAdmin ? "true" : "false"}</td></tr>
        <tr><th>Block strangers</th><td>${blockStrangers ? "true" : "false"}</td></tr>
        ${createdAt ? `<tr><th>Created at</th><td>${escapeHtml(createdAt)}</td></tr>` : ""}
        ${updatedAt ? `<tr><th>Updated at</th><td>${escapeHtml(updatedAt)}</td></tr>` : ""}
      </table>
    </div>
  </main>
</body>
</html>
`;
}

export default function PageBody() {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    getSessionInfo()
      .then(async (session) => {
        if (canceled) return;
        setUserId(session.userId);
        try {
          const u = await getUser(session.userId, session.userId);
          if (!canceled) setProfile(u);
        } catch (e: unknown) {
          if (!canceled) setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (!canceled) setLoading(false);
        }
      })
      .catch(() => {
        if (!canceled) {
          setUserId(null);
          setProfile(null);
          setLoading(false);
          setError("User information could not be retrieved. Please re-login.");
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  const exportFileName = useMemo(() => {
    const uid = userId ?? "unknown";
    const ts = formatTimestampYYYYMMDDhhmmss(new Date());
    return `stgy-export-${uid}-${ts}.zip`;
  }, [userId]);

  const exportRootDir = useMemo(() => exportFileName.replace(/\.zip$/i, ""), [exportFileName]);

  async function handleExport(e: React.FormEvent) {
    e.preventDefault();
    if (loading || exporting) return;

    setError(null);
    setDone(false);

    if (!userId) {
      setError("User information could not be retrieved. Please re-login.");
      return;
    }
    if (!profile) {
      setError("Profile is not loaded yet.");
      return;
    }

    setExporting(true);
    try {
      const enc = new TextEncoder();
      const base = `${exportRootDir}/`;

      // Only rewrite introduction/snippet by regex (no object listing, no downloads)
      const exportProfile = rewriteProfileIntroductionAndSnippet(profile, userId);

      const profileJson = JSON.stringify(exportProfile, null, 2);
      const profileHtml = renderProfileHtml(exportProfile);

      const files: Array<{ name: string; data: Uint8Array }> = [
        { name: `${base}profile.json`, data: enc.encode(profileJson) },
        { name: `${base}profile.html`, data: enc.encode(profileHtml) },
      ];

      const hasAvatar = typeof profile.avatar === "string" && profile.avatar.trim() !== "";
      if (hasAvatar) {
        const version =
          typeof (profile as unknown as { updatedAt?: string | null }).updatedAt === "string"
            ? (profile as unknown as { updatedAt: string }).updatedAt
            : null;
        const url = getPublicUrlFromStoragePath(String(profile.avatar), version);
        if (!url) throw new Error("Avatar path is invalid.");
        const avatarBytes = await fetchBytes(url);
        files.push({ name: `${base}avatar.webp`, data: avatarBytes });
      }

      const zipBytes = buildZipStore(files, new Date());
      const blob = new Blob([zipBytes], { type: "application/zip" });
      downloadBlob(blob, exportFileName);

      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="max-w-lg mx-auto mt-12 p-4 bg-white shadow border rounded">
      <h1 className="text-2xl font-bold mb-6">Exporting all data</h1>

      <form onSubmit={handleExport} className="flex flex-col gap-6">
        <section className="text-sm text-gray-700 leading-relaxed">
          <p>
            You can download all of your STGY data in one ZIP archive here. Click the button at the
            bottom of this page to start downloading. The archive includes the following files:
          </p>

          <ul className="list-disc pl-6 mt-3 space-y-1 text-gray-700">
            <li>
              <code>./profile.json</code> : User profile in JSON
            </li>
            <li>
              <code>./profile.html</code> : User profile in HTML
            </li>
            <li>
              <code>./avatar.webp</code> : Avatar image (binary)
            </li>
            <li>
              <code>./posts/&lt;postId&gt;.json</code> : Post data in JSON
            </li>
            <li>
              <code>./posts/&lt;postId&gt;.html</code> : Post data in HTML
            </li>
            <li>
              <code>./images/&lt;objectId&gt;.&lt;jpg|png|webp|...&gt;</code> : Image binaries
            </li>
            <li>
              <code>./relations.json</code> : Follow/block/like relations in JSON
            </li>
          </ul>

          <p className="mt-3">
            The JSON and HTML versions of the profile/posts contain the same information. JSON is
            useful for migrating your data to other services, while HTML is convenient for using the
            exported data as a website or CMS content.
          </p>

          <p className="mt-3">
            Creating and downloading the archive may take a while. After you click the button, keep
            this browser window open until the download finishes.
          </p>
        </section>

        {error && (
          <div className="text-red-600 -mt-2" role="alert">
            {error}
          </div>
        )}
        {done && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded -mt-2">
            Download started
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="bg-blue-600 text-white px-8 py-2 rounded disabled:opacity-60"
            disabled={loading || exporting}
          >
            {exporting ? "Exporting…" : "Export all data"}
          </button>
        </div>
      </form>
    </main>
  );
}
