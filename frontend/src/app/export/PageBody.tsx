"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getSessionInfo } from "@/api/auth";
import { getPubConfig, getUser, listBlockees, listFollowees } from "@/api/users";
import { getPost, listPosts, listPostsLikedByUser } from "@/api/posts";
import { listImages } from "@/api/media";
import type { MediaObject, Post, PostDetail, PubConfig, User, UserDetail } from "@/api/models";
import { makeArticleHtmlFromMarkdown } from "@/utils/article";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";
import {
  ZipStreamWriter,
  InMemoryZipWriter,
  type IZipWriter,
  type WritableFileStreamMinimal,
} from "@/utils/zip";
import { Config } from "@/config";
import { HTML_STYLES_CSS } from "./exportStyles";

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}

interface FileSystemFileHandle {
  createWritable(): Promise<WritableFileStreamMinimal>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

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

function restoreFilename(rev6: string, time8: string, hash8: string, ext: string): string {
  const r1 = 999999 - parseInt(rev6, 10);
  const r2 = 0xffffffff - parseInt(time8, 16);
  return `${String(r1).padStart(6, "0")}${r2.toString(16).padStart(8, "0")}${hash8}.${ext}`;
}

function rewriteImageObjectUrlsToRelative(text: string, userId: string, baseDir: string): string {
  const uid = escapeRegExp(userId);
  const re = new RegExp(
    String.raw`\/images\/${uid}\/(?:masters|thumbs|master|thumb)\/(\d{6})\/([0-9a-f]{8})([0-9a-f]{8})\.([A-Za-z0-9]{1,5})(?:[?#][^)\s"'<>]*)?`,
    "g",
  );
  return String(text || "").replace(re, (_m, rev6: string, t8: string, h8: string, ext: string) => {
    return `${baseDir}/${restoreFilename(rev6, t8, h8, ext)}`;
  });
}

function rewriteProfileIntroductionAndSnippet(profile: UserDetail, userId: string): UserDetail {
  const rewrittenIntro = rewriteImageObjectUrlsToRelative(profile.introduction, userId, "./images");
  const rewrittenSnippet = rewriteImageObjectUrlsToRelative(profile.snippet, userId, "./images");
  return { ...profile, introduction: rewrittenIntro, snippet: rewrittenSnippet };
}

function rewritePostContentAndSnippet<T extends Post | PostDetail>(post: T, userId: string): T {
  const next = { ...post };
  if ("content" in next && typeof next.content === "string") {
    next.content = rewriteImageObjectUrlsToRelative(next.content, userId, "../images");
  }
  next.snippet = rewriteImageObjectUrlsToRelative(next.snippet, userId, "../images");
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

async function fetchBytes(url: string, label: string): Promise<Uint8Array> {
  const resp = await fetch(url, { method: "GET", credentials: "include" });
  if (!resp.ok) throw new Error(`Failed to download ${label}: ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

function renderProfileHtml(profile: UserDetail): string {
  const locale = profile.locale;
  const nickname = profile.nickname || "User";
  const userId = profile.id;
  const bodyHtml = profile.introduction
    ? makeArticleHtmlFromMarkdown(profile.introduction, false, userId, false)
    : "";
  const isAdmin = profile.isAdmin;
  const blockStrangers = profile.blockStrangers;
  const countsRowHtml = `<h2>Counts</h2>
       <table>
         <tr><th>Followers</th><td>${profile.countFollowers}</td></tr>
         <tr><th>Followees</th><td>${profile.countFollowees}</td></tr>
         <tr><th>Posts</th><td>${profile.countPosts}</td></tr>
       </table>`;
  const avatarHtml = profile.avatar ? `<img src="avatar.webp" alt="Avatar" class="avatar" />` : "";
  const headerHtml = profile.avatar
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
  <link rel="stylesheet" href="./style.css" />
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
        <tr><th>Timezone</th><td>${escapeHtml(profile.timezone)}</td></tr>
        <tr><th>Is admin</th><td>${isAdmin}</td></tr>
        <tr><th>Block strangers</th><td>${blockStrangers}</td></tr>
        <tr><th>Created at</th><td>${escapeHtml(profile.createdAt)}</td></tr>
        ${profile.updatedAt ? `<tr><th>Updated at</th><td>${escapeHtml(profile.updatedAt)}</td></tr>` : ""}
      </table>
    </div>
  </main>
</body>
</html>
`;
}

function renderPostHtml(post: Post | PostDetail): string {
  const postId = post.id;
  const postLang = post.ownerLocale || post.locale || "en";
  const ownerNickname = post.ownerNickname;
  const bodyHtml = convertHtmlMathInline(
    "content" in post ? makeArticleHtmlFromMarkdown(post.content, false, postId, false) : "",
  );
  const tagHtml =
    post.tags.length > 0
      ? `<div class="tags">${post.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>`
      : "";
  return `<!doctype html>
<html lang="${escapeHtml(postLang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Post ${escapeHtml(postId)} - STGY</title>
  <link rel="stylesheet" href="../style.css" />
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
        <tr><th>Created at</th><td>${escapeHtml(post.createdAt)}</td></tr>
        ${post.updatedAt ? `<tr><th>Updated at</th><td>${escapeHtml(post.updatedAt)}</td></tr>` : ""}
        ${post.publishedAt ? `<tr><th>Published at</th><td>${escapeHtml(post.publishedAt)}</td></tr>` : ""}
        <tr><th>Likes</th><td>${post.countLikes}</td></tr>
        <tr><th>Replies</th><td>${post.countReplies}</td></tr>
      </table>
    </div>
  </main>
</body>
</html>
`;
}

async function fetchAllMyPosts(userId: string): Promise<Post[]> {
  const out: Post[] = [];
  for (let offset = 0; offset < 200_000; offset += 200) {
    const res = await listPosts({
      offset,
      limit: 200,
      order: "desc",
      ownedBy: userId,
      focusUserId: userId,
    });
    if (res.length === 0) break;
    out.push(...res.filter((p) => p.ownedBy === userId));
    if (res.length < 200) break;
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

async function fetchAllMyImages(userId: string): Promise<MediaObject[]> {
  const out: MediaObject[] = [];
  for (let page = 1; page < 100000; page++) {
    const data = await listImages(userId, {
      offset: (page - 1) * IMAGES_PAGE_SIZE,
      limit: IMAGES_PAGE_SIZE + 1,
    });
    out.push(...data.slice(0, IMAGES_PAGE_SIZE));
    if (data.length <= IMAGES_PAGE_SIZE) break;
  }
  const seen = new Set<string>();
  return out.filter((it) => {
    if (seen.has(it.key)) return false;
    seen.add(it.key);
    return true;
  });
}

function isMasterKey(key: string, userId: string): boolean {
  return key.startsWith(`${userId}/masters/`) || key.startsWith(`${userId}/master/`);
}

function imageFilenameFromKey(key: string, userId: string): string {
  const parts = key.split("/");
  if (parts[0] !== userId) throw new Error("Owner mismatch");
  const rev6 = parts[2];
  const name = parts[3];
  const m = /^([0-9a-f]{8})([0-9a-f]{8})\.([A-Za-z0-9]{1,5})$/i.exec(name);
  if (!m) throw new Error("Invalid image format");
  return restoreFilename(rev6, m[1], m[2], m[3]);
}

async function fetchAllUsersByPager(
  fetchPage: (o: number, l: number) => Promise<User[]>,
): Promise<Array<{ id: string; nickname: string }>> {
  const out: Array<{ id: string; nickname: string }> = [];
  for (let offset = 0; offset < 200_000; offset += 200) {
    const res = await fetchPage(offset, 201);
    res
      .slice(0, 200)
      .forEach((u) => u.id && u.nickname && out.push({ id: u.id, nickname: u.nickname }));
    if (res.length <= 200) break;
  }
  const seen = new Set<string>();
  return out.filter((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

async function fetchAllLikedPosts(
  userId: string,
): Promise<Array<{ id: string; ownedBy: string; ownerNickname: string }>> {
  const out: Array<{ id: string; ownedBy: string; ownerNickname: string }> = [];
  for (let offset = 0; offset < 200_000; offset += 200) {
    const data = await listPostsLikedByUser({
      userId,
      offset,
      limit: 201,
      order: "desc",
      focusUserId: userId,
      includeReplies: true,
    });
    data.slice(0, 200).forEach((p) => {
      if (p.id && p.ownedBy && p.ownerNickname)
        out.push({ id: p.id, ownedBy: p.ownedBy, ownerNickname: p.ownerNickname });
    });
    if (data.length <= 200) break;
  }
  const seen = new Set<string>();
  return out.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
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
          setLoading(false);
          setError("Please re-login.");
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  const exportFileName = useMemo(() => {
    const ts = formatTimestampYYYYMMDDhhmmss(new Date());
    return `stgy-export-${userId ?? "unknown"}-${ts}.zip`;
  }, [userId]);

  const exportRootDir = useMemo(() => exportFileName.replace(/\.zip$/i, ""), [exportFileName]);

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    if (loading || exporting || !userId || !profile) return;
    setError(null);
    setDone(false);
    try {
      let zipWriter: IZipWriter;
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: exportFileName,
          types: [{ description: "ZIP Archive", accept: { "application/zip": [".zip"] } }],
        });
        zipWriter = new ZipStreamWriter(await handle.createWritable());
      } else {
        zipWriter = new InMemoryZipWriter(exportFileName);
      }
      setExporting(true);
      const enc = new TextEncoder();
      const now = new Date();
      const base = `${exportRootDir}/`;

      const exportProfile = rewriteProfileIntroductionAndSnippet(profile, userId);
      await zipWriter.addFile(`${base}style.css`, enc.encode(HTML_STYLES_CSS), now);
      await zipWriter.addFile(
        `${base}profile.json`,
        enc.encode(JSON.stringify(exportProfile, null, 2)),
        now,
      );
      await zipWriter.addFile(
        `${base}profile.html`,
        enc.encode(renderProfileHtml(exportProfile)),
        now,
      );

      try {
        const pubCfg: PubConfig | null = await getPubConfig(userId);
        if (pubCfg)
          await zipWriter.addFile(
            `${base}pub-config.json`,
            enc.encode(JSON.stringify(pubCfg, null, 2)),
            now,
          );
      } catch {}

      if (profile.avatar) {
        const url = getPublicUrlFromStoragePath(profile.avatar, profile.updatedAt);
        if (url)
          await zipWriter.addFile(`${base}avatar.webp`, await fetchBytes(url, "avatar"), now);
      }

      const [followees, blockees, likes] = await Promise.all([
        fetchAllUsersByPager((o, l) =>
          listFollowees(userId, { offset: o, limit: l, order: "asc" }),
        ),
        fetchAllUsersByPager((o, l) => listBlockees(userId, { offset: o, limit: l, order: "asc" })),
        fetchAllLikedPosts(userId),
      ]);
      await zipWriter.addFile(
        `${base}relations.json`,
        enc.encode(JSON.stringify({ followees, blockees, likes }, null, 2)),
        now,
      );

      const posts = await fetchAllMyPosts(userId);
      for (const p of posts) {
        const detail = await getPost(p.id, userId);
        const rewritten = rewritePostContentAndSnippet(detail ?? p, userId);
        await zipWriter.addFile(
          `${base}posts/${p.id}.json`,
          enc.encode(JSON.stringify(rewritten, null, 2)),
          now,
        );
        await zipWriter.addFile(
          `${base}posts/${p.id}.html`,
          enc.encode(renderPostHtml(rewritten)),
          now,
        );
      }

      const images = await fetchAllMyImages(userId);
      const masterByFilename = new Map<string, MediaObject>();
      images
        .filter((it) => isMasterKey(it.key, userId))
        .forEach((it) => {
          const fname = imageFilenameFromKey(it.key, userId);
          if (!masterByFilename.has(fname)) masterByFilename.set(fname, it);
        });
      for (const [filename, it] of masterByFilename.entries()) {
        await zipWriter.addFile(
          `${base}images/${filename}`,
          await fetchBytes(it.publicUrl, filename),
          now,
        );
      }

      await zipWriter.finalize();
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message || String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto mt-12 p-4 bg-white shadow border rounded">
      <h1 className="text-2xl font-bold mb-6">Exporting all data</h1>
      <form onSubmit={handleExport} className="flex flex-col gap-6">
        <section className="text-sm text-gray-700 leading-relaxed">
          <p>
            You can download all of your STGY data in one ZIP archive here. Click the button at the
            bottom of this page to start downloading. The archive includes the following files:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1 text-sm text-gray-700">
            <li>
              <code className="font-bold">./profile.json</code> : User profile in JSON
            </li>
            <li>
              <code className="font-bold">./profile.html</code> : User profile in HTML
            </li>
            <li>
              <code className="font-bold">./pub-config.json</code> : Publication configuration in
              JSON
            </li>
            <li>
              <code className="font-bold">./avatar.webp</code> : Avatar image (binary)
            </li>
            <li>
              <code className="font-bold">
                ./posts/<var>&#123;postId&#125;</var>.json
              </code>{" "}
              : Post data in JSON
            </li>
            <li>
              <code className="font-bold">
                ./posts/<var>&#123;postId&#125;</var>.html
              </code>{" "}
              : Post data in HTML
            </li>
            <li>
              <code className="font-bold">
                ./images/<var>&#123;objectId&#125;</var>.<var>&#123;ext&#125;</var>
              </code>{" "}
              : Image binaries
            </li>
            <li>
              <code className="font-bold">./relations.json</code> : Follow/block/like relations in
              JSON
            </li>
            <li>
              <code className="font-bold">./style.css</code> : Stylesheet for exported HTML
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
