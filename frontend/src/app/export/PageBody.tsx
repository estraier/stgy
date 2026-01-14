"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getSessionInfo } from "@/api/auth";
import { getUser, listFollowees, listBlockees } from "@/api/users";
import { listPosts, listPostsLikedByUser, getPost } from "@/api/posts";
import { listImages } from "@/api/media";
import type { MediaObject, UserDetail, Post, PostDetail, User } from "@/api/models";
import { makeArticleHtmlFromMarkdown } from "@/utils/article";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";
import { buildZipStore } from "@/utils/zip";
import { Config } from "@/config";
import { HTML_STYLES_CSS } from "./exportStyles";

const IMAGES_PAGE_SIZE = Config.IMAGES_PAGE_SIZE || 30;

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

function rewriteImageObjectUrlsToRelative(text: string, userId: string, baseDir: string): string {
  const uid = escapeRegExp(userId);
  const re = new RegExp(
    String.raw`\/images\/${uid}\/(?:masters|thumbs|master|thumb)\/(\d{6})\/([0-9a-f]{16})\.([A-Za-z0-9]{1,5})(?:[?#][^)\s"'<>]*)?`,
    "g",
  );

  return String(text || "").replace(re, (_m, rev6: string, hex16: string, ext: string) => {
    const filename = `${rev6}${hex16}.${ext}`;
    return `${baseDir}/${filename}`;
  });
}

function rewriteProfileIntroductionAndSnippet(profile: UserDetail, userId: string): UserDetail {
  const intro =
    typeof (profile as unknown as { introduction?: unknown }).introduction === "string"
      ? String((profile as unknown as { introduction: string }).introduction)
      : null;

  const snippet = typeof profile.snippet === "string" ? profile.snippet : "[]";

  const rewrittenIntro = intro !== null ? rewriteImageObjectUrlsToRelative(intro, userId, "./images") : null;
  const rewrittenSnippet = rewriteImageObjectUrlsToRelative(snippet, userId, "./images");

  const next: UserDetail = {
    ...profile,
    snippet: rewrittenSnippet,
  } as UserDetail;

  if (rewrittenIntro !== null) {
    (next as unknown as { introduction: string }).introduction = rewrittenIntro;
  }

  return next;
}

function rewritePostContentAndSnippet<T extends Post | PostDetail>(post: T, userId: string): T {
  const next = { ...(post as unknown as Record<string, unknown>) } as Record<string, unknown>;

  if ("content" in next && typeof next.content === "string") {
    next.content = rewriteImageObjectUrlsToRelative(next.content, userId, "../images");
  }
  if (typeof next.snippet === "string") {
    next.snippet = rewriteImageObjectUrlsToRelative(next.snippet, userId, "../images");
  }
  return next as unknown as T;
}

function getPublicUrlFromStoragePath(storagePath: string, version?: string | null): string | null {
  const p = String(storagePath || "").replace(/^\/+/, "");
  const i = p.indexOf("/");
  if (i <= 0) return null;

  const bucket = p.slice(0, i);
  const key = p.slice(i + 1).replace(/^\/+/, "");

  const base = String(Config.STORAGE_S3_PUBLIC_URL_PREFIX || "").replace("{bucket}", bucket);
  const prefix = base.replace(/\/+$/, "");
  const suffix = version && String(version).trim() !== "" ? `?v=${encodeURIComponent(String(version))}` : "";
  return `${prefix}/${key}${suffix}`;
}

async function fetchBytes(url: string, label: string): Promise<Uint8Array> {
  const resp = await fetch(url, { method: "GET", credentials: "include" });
  if (!resp.ok) {
    throw new Error(`Failed to download ${label}: ${resp.status} ${resp.statusText}`);
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
  const bodyHtml = hasIntro ? makeArticleHtmlFromMarkdown(introMd, false, userId, false) : "";

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
  <link rel="stylesheet" href="./export.css" />
</head>
<body class="stgy-export stgy-export-profile">
  <main>
    <div class="card">
      ${headerHtml}

      <h2>Profile</h2>
      <div class="markdown-body user-introduction">
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

function renderPostHtml(post: Post | PostDetail): string {
  const postId = typeof post.id === "string" ? post.id : "";
  const postLang =
    (typeof (post as { locale?: unknown }).locale === "string" && (post as { locale: string }).locale) ||
    (typeof (post as { ownerLocale?: unknown }).ownerLocale === "string" &&
      (post as { ownerLocale: string }).ownerLocale) ||
    "en";

  const ownerNickname =
    (typeof (post as { ownerNickname?: unknown }).ownerNickname === "string" &&
      (post as { ownerNickname: string }).ownerNickname) ||
    "User";

  const createdAt = typeof post.createdAt === "string" ? post.createdAt : "";
  const updatedAt =
    typeof (post as { updatedAt?: unknown }).updatedAt === "string" ? (post as { updatedAt: string }).updatedAt : "";
  const publishedAt =
    typeof (post as { publishedAt?: unknown }).publishedAt === "string"
      ? (post as { publishedAt: string }).publishedAt
      : "";

  const tags =
    Array.isArray((post as { tags?: unknown }).tags) && (post as { tags: unknown[] }).tags.every((t) => typeof t === "string")
      ? (post as { tags: string[] }).tags
      : [];

  const hasContent = "content" in post && typeof (post as PostDetail).content === "string";
  const bodyHtml = convertHtmlMathInline(
    hasContent ? makeArticleHtmlFromMarkdown((post as PostDetail).content, false, postId, false) : "",
  );

  const tagHtml =
    tags.length > 0 ? `<div class="tags">${tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>` : "";

  const countLikesMaybe = (post as { countLikes?: unknown }).countLikes;
  const countLikes = typeof countLikesMaybe === "number" ? countLikesMaybe : null;

  const countRepliesMaybe = (post as { countReplies?: unknown }).countReplies;
  const countReplies = typeof countRepliesMaybe === "number" ? countRepliesMaybe : null;

  return `<!doctype html>
<html lang="${escapeHtml(postLang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Post ${escapeHtml(postId)} - STGY</title>
  <link rel="stylesheet" href="../export.css" />
</head>
<body class="stgy-export stgy-export-post">
  <main>
    <div class="card">
      <h1>${escapeHtml(ownerNickname)}</h1>
      <p class="muted">Post ID: <code>${escapeHtml(postId)}</code></p>

      ${tagHtml}

      <h2>Content</h2>
      <div class="markdown-body">
        ${bodyHtml}
      </div>

      <h2>Meta</h2>
      <table>
        ${createdAt ? `<tr><th>Created at</th><td>${escapeHtml(createdAt)}</td></tr>` : ""}
        ${updatedAt ? `<tr><th>Updated at</th><td>${escapeHtml(updatedAt)}</td></tr>` : ""}
        ${publishedAt ? `<tr><th>Published at</th><td>${escapeHtml(publishedAt)}</td></tr>` : ""}
        ${countLikes !== null ? `<tr><th>Likes</th><td>${countLikes}</td></tr>` : ""}
        ${countReplies !== null ? `<tr><th>Replies</th><td>${countReplies}</td></tr>` : ""}
      </table>
    </div>
  </main>
</body>
</html>
`;
}

async function fetchAllMyPosts(userId: string): Promise<Post[]> {
  const out: Post[] = [];
  const limit = 200;

  for (let offset = 0; offset < 200_000; offset += limit) {
    const input: Record<string, unknown> = {
      offset,
      limit,
      includingReplies: 1,
      order: "desc",
      ownedBy: userId,
    };

    const fn = listPosts as unknown as (input: Record<string, unknown>, focusUserId: string) => Promise<Post[]>;
    const res = await fn(input, userId);

    if (res.length === 0) break;

    for (const item of res) {
      if (item.ownedBy === userId) out.push(item);
    }

    if (res.length < limit) break;
  }

  const seen = new Set<string>();
  const dedup: Post[] = [];
  for (const p of out) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      dedup.push(p);
    }
  }
  return dedup;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;

  const workers = new Array(Math.max(1, concurrency)).fill(0).map(async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return out;
}

function isMasterKey(key: string, userId: string): boolean {
  return key.startsWith(`${userId}/masters/`) || key.startsWith(`${userId}/master/`);
}

function imageFilenameFromKey(key: string, userId: string): string {
  const parts = String(key || "").split("/");
  if (parts.length !== 4) throw new Error(`Invalid image key: ${key}`);
  if (parts[0] !== userId) throw new Error(`Invalid image key: ${key}`);
  if (parts[1] !== "masters" && parts[1] !== "master") throw new Error(`Invalid image key: ${key}`);
  const rev6 = parts[2];
  if (!/^\d{6}$/.test(rev6)) throw new Error(`Invalid image key: ${key}`);
  const name = parts[3];
  const m = /^([0-9a-f]{16})\.([A-Za-z0-9]{1,5})$/i.exec(name);
  if (!m) throw new Error(`Invalid image key: ${key}`);
  const hex16 = m[1].toLowerCase();
  const ext = m[2];
  return `${rev6}${hex16}.${ext}`;
}

async function fetchAllMyImages(userId: string): Promise<MediaObject[]> {
  const out: MediaObject[] = [];
  for (let page = 1; page < 100000; page++) {
    const offset = (page - 1) * IMAGES_PAGE_SIZE;
    const data = await listImages(userId, { offset, limit: IMAGES_PAGE_SIZE + 1 });
    const hasNext = data.length > IMAGES_PAGE_SIZE;
    out.push(...data.slice(0, IMAGES_PAGE_SIZE));
    if (!hasNext) break;
  }

  const seen = new Set<string>();
  const dedup: MediaObject[] = [];
  for (const it of out) {
    if (!seen.has(it.key)) {
      seen.add(it.key);
      dedup.push(it);
    }
  }
  return dedup;
}

type RelationsJson = {
  followees: Array<{ id: string; nickname: string }>;
  blockees: Array<{ id: string; nickname: string }>;
  likes: Array<{ id: string; ownedBy: string; ownerNickname: string }>;
};

async function fetchAllUsersByPager(
  fetchPage: (offset: number, limit: number) => Promise<User[]>,
): Promise<Array<{ id: string; nickname: string }>> {
  const limit = 200;
  const out: Array<{ id: string; nickname: string }> = [];

  for (let offset = 0; offset < 200_000; offset += limit) {
    const res = await fetchPage(offset, limit + 1);
    const hasNext = res.length > limit;
    for (const u of res.slice(0, limit)) {
      if (u && typeof u.id === "string" && typeof u.nickname === "string") {
        out.push({ id: u.id, nickname: u.nickname });
      }
    }
    if (!hasNext) break;
  }

  const seen = new Set<string>();
  const dedup: Array<{ id: string; nickname: string }> = [];
  for (const u of out) {
    if (!seen.has(u.id)) {
      seen.add(u.id);
      dedup.push(u);
    }
  }
  return dedup;
}

async function fetchAllLikedPosts(userId: string): Promise<Array<{ id: string; ownedBy: string; ownerNickname: string }>> {
  const limit = 200;
  const out: Array<{ id: string; ownedBy: string; ownerNickname: string }> = [];

  for (let offset = 0; offset < 200_000; offset += limit) {
    const data = await listPostsLikedByUser({
      userId,
      offset,
      limit: limit + 1,
      order: "desc",
      focusUserId: userId,
      includeReplies: true,
    });

    const hasNext = data.length > limit;
    for (const p of data.slice(0, limit)) {
      const id = typeof p.id === "string" ? p.id : null;
      const ownedBy = typeof p.ownedBy === "string" ? p.ownedBy : null;
      const ownerNickname =
        typeof (p as { ownerNickname?: unknown }).ownerNickname === "string" ? (p as { ownerNickname: string }).ownerNickname : null;

      if (id && ownedBy && ownerNickname) {
        out.push({ id, ownedBy, ownerNickname });
      }
    }
    if (!hasNext) break;
  }

  const seen = new Set<string>();
  const dedup: Array<{ id: string; ownedBy: string; ownerNickname: string }> = [];
  for (const it of out) {
    if (!seen.has(it.id)) {
      seen.add(it.id);
      dedup.push(it);
    }
  }
  return dedup;
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

  async function handleExport(e: FormEvent) {
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

      const exportProfile = rewriteProfileIntroductionAndSnippet(profile, userId);
      const profileJson = JSON.stringify(exportProfile, null, 2);
      const profileHtml = renderProfileHtml(exportProfile);

      const files: Array<{ name: string; data: Uint8Array }> = [
        { name: `${base}export.css`, data: enc.encode(HTML_STYLES_CSS) },
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
        const avatarBytes = await fetchBytes(url, "avatar");
        files.push({ name: `${base}avatar.webp`, data: avatarBytes });
      }

      const [followees, blockees, likes] = await Promise.all([
        fetchAllUsersByPager((offset, limit) => listFollowees(userId, { offset, limit, order: "asc" })),
        fetchAllUsersByPager((offset, limit) => listBlockees(userId, { offset, limit, order: "asc" })),
        fetchAllLikedPosts(userId),
      ]);

      const relations: RelationsJson = { followees, blockees, likes };
      files.push({ name: `${base}relations.json`, data: enc.encode(JSON.stringify(relations, null, 2)) });

      const posts = await fetchAllMyPosts(userId);

      const postFiles = await mapWithConcurrency(posts, 4, async (p) => {
        const fn = getPost as unknown as (postId: string, focusUserId: string) => Promise<PostDetail>;
        const detail = await fn(p.id, userId);
        const src = (detail ?? p) as Post | PostDetail;
        const rewritten = rewritePostContentAndSnippet(src, userId);
        const postJson = JSON.stringify(rewritten, null, 2);
        const postHtml = renderPostHtml(rewritten);

        return [
          { name: `${base}posts/${p.id}.json`, data: enc.encode(postJson) },
          { name: `${base}posts/${p.id}.html`, data: enc.encode(postHtml) },
        ] as const;
      });

      for (const pair of postFiles) {
        files.push(pair[0], pair[1]);
      }

      const images = await fetchAllMyImages(userId);
      const masters = images.filter((it) => isMasterKey(it.key, userId));

      const masterByFilename = new Map<string, MediaObject>();
      for (const it of masters) {
        const filename = imageFilenameFromKey(it.key, userId);
        if (!masterByFilename.has(filename)) masterByFilename.set(filename, it);
      }

      const imageFiles = await mapWithConcurrency(Array.from(masterByFilename.entries()), 6, async ([filename, it]) => {
        const bytes = await fetchBytes(it.publicUrl, `image ${filename}`);
        return { name: `${base}images/${filename}`, data: bytes };
      });

      for (const f of imageFiles) files.push(f);

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
            You can download all of your STGY data in one ZIP archive here. Click the button at the bottom of this page
            to start downloading. The archive includes the following files:
          </p>

          <ul className="list-disc pl-6 mt-3 space-y-1 text-gray-700">
            <li>
              <code>./export.css</code> : Stylesheet for exported HTML
            </li>
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
              <code>./images/&lt;objectId&gt;.&lt;jpg|png|webp|...&gt;</code> : Image binaries (master only)
            </li>
            <li>
              <code>./relations.json</code> : Follow/block/like relations in JSON
            </li>
          </ul>

          <p className="mt-3">
            The JSON and HTML versions of the profile/posts contain the same information. JSON is useful for migrating
            your data to other services, while HTML is convenient for using the exported data as a website or CMS
            content.
          </p>

          <p className="mt-3">
            Creating and downloading the archive may take a while. After you click the button, keep this browser window
            open until the download finishes.
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
