"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSessionInfo } from "@/api/auth";
import { getPubConfig, getUser, listBlockees, listFollowees } from "@/api/users";
import { getPost, listPosts, listPostsLikedByUser } from "@/api/posts";
import { listImages } from "@/api/media";
import { listTracks } from "@/api/tracks";
import type {
  MediaObject,
  Post,
  PostDetail,
  PubConfig,
  TrackObject,
  User,
  UserDetail,
} from "@/api/models";
import {
  makeArticleHtmlFromMarkdown,
  makePubAttributesFromJsonSnippet,
  makeReplyDigestTextFromMarkdown,
} from "@/utils/article";
import { sliceByPseudoTokens } from "stgy-markdown";
import { convertHtmlMathInline } from "@/utils/mathjax-inline";
import {
  ZipStreamWriter,
  InMemoryZipWriter,
  type IZipWriter,
  type WritableFileStreamMinimal,
} from "@/utils/zip";
import { Config } from "@/config";
import { formatBytes } from "@/utils/format";
import {
  collectOwnedImageFilenames,
  collectUnexportedImageReferences,
  restoreImageFilename,
  rewriteOwnedImageObjectUrlsToRelative,
} from "@/utils/exportImages";
import {
  collectOwnedTrackKeys,
  collectUnexportedTrackReferences,
  makeTrackArchiveEntries,
  rewriteTrackObjectUrlsToRelative,
  type TrackArchiveEntry,
} from "@/utils/exportTracks";
import { buildHtmlStylesCss } from "./exportStyles";
import {
  EXPORTER_VERSION,
  EXPORT_MANIFEST_FILENAME,
  EXPORT_MANIFEST_FORMAT,
  EXPORT_MANIFEST_VERSION,
  makeManifestFileEntry,
  makePostSourceFingerprint,
  parseExportManifest,
  type ExportManifest,
  type ExportManifestFile,
  type ExportManifestPost,
  type ExportManifestTrack,
} from "@/utils/exportManifest";

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
const TRACKS_PAGE_SIZE = Config.TRACKS_PAGE_SIZE || 30;
const EXPORT_API_PAGE_SIZE = 100;

const TRACK_VIEWER_JS_URL = "/export-assets/track-viewer.js";
const TRACK_VIEWER_CSS_URL = "/export-assets/track-viewer.css";
const ARTICLE_CONTENT_CSS_URL = "/export-assets/article-content.css";

const TRACK_EXPORT_BOOTSTRAP_JS = `(() => {
  const message =
    "Track maps require an HTTP server. Open this archive through a local web server.";

  function showError(text) {
    document.querySelectorAll(".stgy-track-map").forEach((figure) => {
      const canvas = figure.querySelector(".stgy-track-canvas");
      if (!canvas) return;
      canvas.classList.add("stgy-track-export-error");
      canvas.textContent = text;
    });
  }

  function initialize() {
    if (!document.querySelector(".stgy-track-map")) return;
    if (window.location.protocol === "file:") {
      showError(message);
      return;
    }

    const Viewer = window.StgyTrackViewer;
    if (!Viewer || typeof Viewer.StgyTrackRenderer !== "function") {
      showError("Track renderer could not be loaded.");
      return;
    }

    try {
      new Viewer.StgyTrackRenderer().hydrate(document.body);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
`;

const EXPORT_README_TEXT = `STGY export archive

This directory contains your exported STGY data and browser-readable HTML pages.
Start with index.html to browse the profile and posts included in the current export.

The main contents are:

  profile.json and profile.html
    Your profile in machine-readable JSON and browser-readable HTML.

  posts/
    Each post in JSON and HTML formats.

  images/
    The original image data included in this export. Exported HTML refers to these local files.

  tracks/masters/
    The original FIT or TRJGZ track data included in this export.

  tracks/previews/
    Included TrackJSON preview data used to draw maps and graphs in the exported HTML.

  assets/ and style.css
    JavaScript and stylesheets used by the exported HTML.

  pub-config.json, relations.json, and avatar.webp
    Publication settings, social relations, and the avatar image.

  export-manifest.json
    Inventory and source fingerprints used for incremental exports.

The JSON files are suitable for processing or migration. The HTML files provide a convenient
way to read the exported contents as a static website. Keep the directory structure intact so
that images, tracks, scripts, and stylesheets continue to resolve correctly.

Incremental exports
-------------------

After extracting an export, keep export-manifest.json together with the exported directory.
On a later export, select that manifest as the previous export manifest. The new ZIP will contain
only changed/new post and resource files plus files that are regenerated every time. Its top-level
directory has the same stable name, so extracting it over the previous export updates the backup
by adding and overwriting files. Files deleted from STGY are not deleted from the local backup.

Map viewing
-----------

Pages without maps can usually be opened directly. Track maps cannot be loaded through file://
because browsers block JavaScript from fetching local files. To view maps, start an HTTP server
in this directory, for example:

  python3 -m http.server 8000

Then open http://localhost:8000/index.html in a browser. Track data is read from this archive,
but background map tiles are downloaded from their original providers, so an Internet connection
is still required.
`;

const POST_BASE_SLEEP_MS = 200;
const POST_BASE_SLEEP_MS_ADMIN = 40;
const IMAGE_BASE_SLEEP_MS = 500;
const IMAGE_BASE_SLEEP_MS_ADMIN = 100;
const PER_MB_SLEEP_MS = 100;
const PER_MB_SLEEP_MS_ADMIN = 20;
const ONE_MB = 1024 * 1024;

const TOO_OFTEN_WAIT_MS = 600_000;
const TOO_OFTEN_MAX_RETRY = 10;

type ReplyDigest = {
  id: string;
  ownedBy: string;
  createdAt: string;
  updatedAt: string | null;
  ownerNickname: string;
  locale: string | null;
  text: string;
};

type ExportPostDetail = Omit<PostDetail, "olderPostId" | "newerPostId"> & {
  replyDigests: ReplyDigest[];
};

function sleep(ms: number): Promise<void> {
  const n = Math.max(0, ms | 0);
  return new Promise((r) => setTimeout(r, n));
}

function sleepForTransferBytes(
  bytes: number,
  baseMs: number,
  perMbMs: number = PER_MB_SLEEP_MS,
): Promise<void> {
  const b = Math.max(0, bytes | 0);
  const mb = Math.ceil(b / ONE_MB);
  const ms = Math.max(0, baseMs | 0) + mb * Math.max(0, perMbMs | 0);
  return sleep(ms);
}

function isTooOftenError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("too often operations");
}

async function withTooOftenRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < TOO_OFTEN_MAX_RETRY; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      if (!isTooOftenError(e) || i === TOO_OFTEN_MAX_RETRY - 1) throw e;
      await sleep(TOO_OFTEN_WAIT_MS);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

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

function formatJapaneseTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}/${m}/${dd} ${hh}:${mi}:${ss}`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rewriteProfileIntroductionAndSnippet(
  profile: UserDetail,
  userId: string,
  trackEntries: TrackArchiveEntry[],
): UserDetail {
  const rewrittenIntro = rewriteTrackObjectUrlsToRelative(
    rewriteOwnedImageObjectUrlsToRelative(profile.introduction, userId, "./images"),
    trackEntries,
    "./tracks",
  );
  const rewrittenSnippet = rewriteTrackObjectUrlsToRelative(
    rewriteOwnedImageObjectUrlsToRelative(profile.snippet, userId, "./images"),
    trackEntries,
    "./tracks",
  );
  return { ...profile, introduction: rewrittenIntro, snippet: rewrittenSnippet };
}

function rewritePostContentAndSnippet<T extends Post | PostDetail>(
  post: T,
  userId: string,
  trackEntries: TrackArchiveEntry[],
): T {
  const next = { ...post };
  if ("content" in next && typeof next.content === "string") {
    next.content = rewriteTrackObjectUrlsToRelative(
      rewriteOwnedImageObjectUrlsToRelative(next.content, userId, "../images"),
      trackEntries,
      "../tracks",
    );
  }
  next.snippet = rewriteTrackObjectUrlsToRelative(
    rewriteOwnedImageObjectUrlsToRelative(next.snippet, userId, "../images"),
    trackEntries,
    "../tracks",
  );
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

async function fetchBytes(
  url: string,
  label: string,
  baseSleepMs: number = IMAGE_BASE_SLEEP_MS,
  perMbSleepMs: number = PER_MB_SLEEP_MS,
): Promise<Uint8Array> {
  const resp = await fetch(url, { method: "GET", credentials: "include" });
  if (!resp.ok) throw new Error(`Failed to download ${label}: ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  await sleepForTransferBytes(bytes.length, baseSleepMs, perMbSleepMs);
  return bytes;
}

function renderTrackAssetTags(baseDir: string): string {
  return `<link rel="stylesheet" href="${baseDir}/track-viewer.css" />
  <script defer src="${baseDir}/track-viewer.js"></script>
  <script defer src="${baseDir}/track-export.js"></script>`;
}

function renderProfileHtml(profile: UserDetail): string {
  const locale = String(profile.locale || "en");
  const nickname = profile.nickname || "User";
  const userId = profile.id;
  const bodyHtml = profile.introduction
    ? makeArticleHtmlFromMarkdown(profile.introduction, false, userId, false)
    : "";
  const isAdmin = profile.isAdmin;
  const blockStrangers = profile.blockStrangers;
  const countsRowHtml = `<h2 class="page-label">Counts</h2>
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
  ${renderTrackAssetTags("./assets")}
</head>
<body class="stgy-export stgy-export-profile">
  <main>
    <div class="card">
      ${headerHtml}

      <h2 class="page-label">Profile</h2>
      <div class="markdown-body user-introduction">
        ${bodyHtml}
      </div>

      ${countsRowHtml}

      <h2 class="page-label">Settings</h2>
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

function renderReplyDigests(post: ExportPostDetail): string {
  if (post.replyDigests.length === 0) return "";

  return `<div class="reply-digests">
    ${post.replyDigests
      .map(
        (reply) => `<div class="reply-digest">
          <div class="reply-digest-meta">
            <span class="reply-digest-owner">${escapeHtml(reply.ownerNickname)}</span>
            <time datetime="${escapeHtml(reply.createdAt)}">${escapeHtml(reply.createdAt)}</time>
          </div>
          <div class="reply-digest-text">${escapeHtml(reply.text)}</div>
        </div>`,
      )
      .join("")}
  </div>`;
}

function renderPostHtml(post: ExportPostDetail): string {
  const postId = post.id;
  const postDate = post.createdAt;
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
  ${renderTrackAssetTags("../assets")}
</head>
<body class="stgy-export stgy-export-post">
  <main>
    <div class="card">
      <div class="post-meta">
        <span class="post-attr">ID: ${escapeHtml(postId)}</span>
        <span class="post-attr">author: ${escapeHtml(ownerNickname)}</span>
        <span class="post-attr">date: ${escapeHtml(postDate)}</span>
      </div>
      ${tagHtml}
      <div class="markdown-body">
        ${bodyHtml}
      </div>

      <h2 class="page-label">Meta</h2>
      <table>
        <tr><th>Created at</th><td>${escapeHtml(post.createdAt)}</td></tr>
        ${post.updatedAt ? `<tr><th>Updated at</th><td>${escapeHtml(post.updatedAt)}</td></tr>` : ""}
        ${post.publishedAt ? `<tr><th>Published at</th><td>${escapeHtml(post.publishedAt)}</td></tr>` : ""}
        <tr><th>Likes</th><td>${post.countLikes}</td></tr>
        <tr><th>Replies</th><td>${post.countReplies}</td></tr>
        ${
          post.replyDigests.length > 0
            ? `<tr><td class="reply-digests-cell" colspan="2">${renderReplyDigests(post)}</td></tr>`
            : ""
        }
      </table>
    </div>
  </main>
</body>
</html>
`;
}

function renderIndexHtml(posts: Post[], profile: UserDetail): string {
  const nickname = profile.nickname || "User";
  const sortedPosts = [...posts].sort((a, b) => a.id.localeCompare(b.id));

  const listItems = sortedPosts
    .map((p) => {
      const ts = formatJapaneseTimestamp(p.createdAt);
      const attrs = makePubAttributesFromJsonSnippet(p.snippet);
      const titleHtml = attrs.title
        ? `<h2>${escapeHtml(sliceByPseudoTokens(attrs.title, 0, 50))}</h2>`
        : "";
      const authorHtml = attrs.metadata.author
        ? ` <span class="author">${escapeHtml(sliceByPseudoTokens(attrs.metadata.author, 0, 50))}</span>`
        : "";
      const bodyHtml = attrs.desc
        ? ` <span class="body">${escapeHtml(sliceByPseudoTokens(attrs.desc, 0, 100))}</span>`
        : "";
      return `<li class="posts">
        <a href="./posts/${escapeHtml(p.id)}.html">${escapeHtml(p.id)}.html</a>
        <span class="muted">(${escapeHtml(ts)})</span><br />
        <span class="snippet">${titleHtml}${authorHtml}${bodyHtml}</span>
      </li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(profile.locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Index - ${escapeHtml(nickname)}</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body class="stgy-export">
  <main>
    <div class="card">
      <h1>Data Index</h1>
      <ul class="list-meta">
        <li><a href="./profile.html">profile.html</a> <span class="muted">(${escapeHtml(profile.nickname)})</span></li>
      </ul>
      <hr />
      <ul class="list-posts">
        ${listItems}
      </ul>
    </div>
  </main>
</body>
</html>`;
}

async function fetchAllMyPosts(userId: string): Promise<Post[]> {
  const out: Post[] = [];
  let after: string | undefined;
  for (;;) {
    const res = await withTooOftenRetry(() =>
      listPosts({
        after,
        limit: EXPORT_API_PAGE_SIZE,
        order: "desc",
        ownedBy: userId,
        focusUserId: userId,
      }),
    );
    if (res.length === 0) break;
    out.push(...res.filter((p) => p.ownedBy === userId));
    after = res[res.length - 1].id;
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

async function fetchAllReplies(postId: string, focusUserId: string): Promise<Post[]> {
  const replies: Post[] = [];
  let after: string | undefined;
  for (;;) {
    const res = await withTooOftenRetry(() =>
      listPosts({
        after,
        limit: EXPORT_API_PAGE_SIZE,
        order: "asc",
        replyTo: postId,
        focusUserId,
      }),
    );
    if (res.length === 0) break;
    replies.push(...res.filter((reply) => reply.replyTo === postId));
    after = res[res.length - 1].id;
  }

  const seen = new Set<string>();
  return replies.filter((reply) => {
    if (seen.has(reply.id)) return false;
    seen.add(reply.id);
    return true;
  });
}

async function makeReplyDigests(
  replies: Post[],
  focusUserId: string,
  postBaseSleepMs: number,
): Promise<ReplyDigest[]> {
  const replyDigests: ReplyDigest[] = [];
  for (const reply of replies) {
    const detail = await withTooOftenRetry(() => getPost(reply.id, focusUserId));
    replyDigests.push({
      id: detail.id,
      ownedBy: detail.ownedBy,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      ownerNickname: detail.ownerNickname,
      locale: detail.locale,
      text: makeReplyDigestTextFromMarkdown(detail.content),
    });
    await sleep(postBaseSleepMs);
  }
  return replyDigests;
}

function withoutPostNavigation(detail: PostDetail, replyDigests: ReplyDigest[]): ExportPostDetail {
  const { olderPostId, newerPostId, ...post } = detail;
  void olderPostId;
  void newerPostId;
  return { ...post, replyDigests };
}

async function fetchAllMyImages(userId: string): Promise<MediaObject[]> {
  const out: MediaObject[] = [];
  let after: string | undefined;
  for (;;) {
    const data = await withTooOftenRetry(() =>
      listImages(userId, {
        after,
        limit: IMAGES_PAGE_SIZE,
      }),
    );
    if (data.length === 0) break;
    out.push(...data);
    after = data[data.length - 1].key;
  }
  const seen = new Set<string>();
  return out.filter((it) => {
    if (seen.has(it.key)) return false;
    seen.add(it.key);
    return true;
  });
}

async function fetchAllMyTracks(userId: string): Promise<TrackObject[]> {
  const out: TrackObject[] = [];
  let after: string | undefined;
  for (;;) {
    const data = await withTooOftenRetry(() =>
      listTracks(userId, {
        after,
        limit: TRACKS_PAGE_SIZE,
      }),
    );
    if (data.length === 0) break;
    out.push(...data);
    after = data[data.length - 1].key;
  }
  const seen = new Set<string>();
  return out.filter((track) => {
    if (seen.has(track.key)) return false;
    seen.add(track.key);
    return true;
  });
}

function isMasterKey(key: string, userId: string): boolean {
  return key.startsWith(`${userId}/masters/`) || key.startsWith(`${userId}/master/`);
}

function trackArchiveEntryFromManifest(entry: ExportManifestTrack): TrackArchiveEntry {
  return {
    track: {
      bucket: "",
      key: entry.key,
      size: entry.size,
      etag: entry.etag,
      lastModified: entry.lastModified,
      publicUrl: entry.publicUrl,
      previewKey: entry.previewKey,
      previewUrl: entry.previewUrl,
    },
    masterFilename: entry.masterPath.split("/").pop() || "",
    previewFilename: entry.previewPath.split("/").pop() || "",
  };
}

function imageFilenameFromKey(key: string, userId: string): string {
  const parts = key.split("/");
  if (parts[0] !== userId) throw new Error("Owner mismatch");
  const rev6 = parts[2];
  const name = parts[3];
  const m = /^([0-9a-f]{8})([0-9a-f]{8})\.([A-Za-z0-9]{1,5})$/i.exec(name);
  if (!m) throw new Error("Invalid image format");
  return restoreImageFilename(rev6, m[1], m[2], m[3]);
}

async function fetchAllUsersByPager(
  fetchPage: (after: string | undefined, limit: number) => Promise<User[]>,
): Promise<Array<{ id: string; nickname: string }>> {
  const out: Array<{ id: string; nickname: string }> = [];
  let after: string | undefined;
  for (;;) {
    const res = await withTooOftenRetry(() => fetchPage(after, EXPORT_API_PAGE_SIZE));
    if (res.length === 0) break;
    res.forEach((u) => u.id && u.nickname && out.push({ id: u.id, nickname: u.nickname }));
    after = res[res.length - 1].id;
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
  let after: string | undefined;
  for (;;) {
    const data = await withTooOftenRetry(() =>
      listPostsLikedByUser({
        userId,
        after,
        limit: EXPORT_API_PAGE_SIZE,
        order: "desc",
        focusUserId: userId,
        includeReplies: true,
      }),
    );
    if (data.length === 0) break;
    data.forEach((p) => {
      if (p.id && p.ownedBy && p.ownerNickname)
        out.push({ id: p.id, ownedBy: p.ownedBy, ownerNickname: p.ownerNickname });
    });
    after = data[data.length - 1].id;
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
  const [exportPhase, setExportPhase] = useState<
    "preparing" | "exporting" | "finalizing" | null
  >(null);
  const [exportProgress, setExportProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [exportErrors, setExportErrors] = useState<string[]>([]);
  const [showExportErrors, setShowExportErrors] = useState(false);
  const [done, setDone] = useState<{
    beforeBytes: number;
    afterBytes: number;
  } | null>(null);
  const [includeUnreferencedResources, setIncludeUnreferencedResources] = useState(false);
  const [incrementalExport, setIncrementalExport] = useState(false);
  const [previousManifestFile, setPreviousManifestFile] = useState<File | null>(null);

  useEffect(() => {
    let canceled = false;
    getSessionInfo()
      .then(async (session) => {
        if (canceled) return;
        setUserId(session.userId);
        try {
          const u = await withTooOftenRetry(() => getUser(session.userId, session.userId));
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

  const exportRootDir = `stgy-export-${userId ?? "unknown"}`;

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    if (loading || exporting || !userId || !profile) return;

    setError(null);
    setExportErrors([]);
    setShowExportErrors(false);
    setDone(null);

    try {
      const now = new Date();
      const exportFileName = `stgy-export-${userId}-${formatTimestampYYYYMMDDhhmmss(now)}.zip`;
      let previousManifest: ExportManifest | null = null;
      if (incrementalExport) {
        if (!previousManifestFile) {
          throw new Error("Select export-manifest.json for incremental export.");
        }
        previousManifest = parseExportManifest(
          await previousManifestFile.text(),
          userId,
          exportRootDir,
        );
      }

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
      setExportPhase("preparing");
      setExportProgress(null);

      const enc = new TextEncoder();
      const base = `${exportRootDir}/`;
      const postBaseSleepMs = profile.isAdmin ? POST_BASE_SLEEP_MS_ADMIN : POST_BASE_SLEEP_MS;
      const imageBaseSleepMs = profile.isAdmin
        ? IMAGE_BASE_SLEEP_MS_ADMIN
        : IMAGE_BASE_SLEEP_MS;
      const perMbSleepMs = profile.isAdmin ? PER_MB_SLEEP_MS_ADMIN : PER_MB_SLEEP_MS;
      let pubCfg: PubConfig | null = null;
      try {
        pubCfg = await withTooOftenRetry(() => getPubConfig(userId));
      } catch {}

      const avatarUrl = profile.avatar
        ? getPublicUrlFromStoragePath(profile.avatar, profile.updatedAt)
        : null;

      const [followees, blockees, likes] = await Promise.all([
        fetchAllUsersByPager((after, limit) =>
          withTooOftenRetry(() => listFollowees(userId, { after, limit, order: "asc" })),
        ),
        fetchAllUsersByPager((after, limit) =>
          withTooOftenRetry(() => listBlockees(userId, { after, limit, order: "asc" })),
        ),
        fetchAllLikedPosts(userId),
      ]);

      type PreparedPost = {
        post: Post;
        sourceFingerprint: string;
        detail: ExportPostDetail | null;
        imageFilenames: string[];
        trackKeys: string[];
        errors: string[];
      };

      const posts = await fetchAllMyPosts(userId);
      const preparedPosts: PreparedPost[] = [];
      for (const post of posts) {
        const replies = post.countReplies > 0 ? await fetchAllReplies(post.id, userId) : [];
        const sourceFingerprint = await makePostSourceFingerprint(post, replies);
        const previousPost = previousManifest?.posts[post.id];
        const jsonPath = `posts/${post.id}.json`;
        const htmlPath = `posts/${post.id}.html`;
        const canReuse =
          previousPost?.sourceFingerprint === sourceFingerprint &&
          previousManifest?.files[jsonPath] != null &&
          previousManifest.files[htmlPath] != null;

        if (canReuse && previousPost) {
          preparedPosts.push({
            post,
            sourceFingerprint,
            detail: null,
            imageFilenames: previousPost.imageFilenames,
            trackKeys: previousPost.trackKeys,
            errors: previousPost.errors,
          });
          continue;
        }

        const detail = await withTooOftenRetry(() => getPost(post.id, userId));
        await sleep(postBaseSleepMs);
        const replyDigests =
          replies.length > 0 ? await makeReplyDigests(replies, userId, postBaseSleepMs) : [];
        const exportDetail = withoutPostNavigation(detail, replyDigests);
        const referenceTexts = [exportDetail.content, exportDetail.snippet];
        preparedPosts.push({
          post,
          sourceFingerprint,
          detail: exportDetail,
          imageFilenames: Array.from(collectOwnedImageFilenames(referenceTexts, userId)).sort(),
          trackKeys: Array.from(collectOwnedTrackKeys(referenceTexts, userId)).sort(),
          errors: [],
        });
      }

      const tracks = await fetchAllMyTracks(userId);
      const currentTrackEntries = makeTrackArchiveEntries(tracks, userId);
      const knownTrackEntriesByKey = new Map<string, TrackArchiveEntry>();
      for (const entry of Object.values(previousManifest?.tracks ?? {})) {
        const archiveEntry = trackArchiveEntryFromManifest(entry);
        if (archiveEntry.masterFilename && archiveEntry.previewFilename) {
          knownTrackEntriesByKey.set(entry.key, archiveEntry);
        }
      }
      for (const entry of currentTrackEntries) knownTrackEntriesByKey.set(entry.track.key, entry);

      const profileReferenceTexts = [profile.introduction, profile.snippet];
      const referencedTrackKeys = collectOwnedTrackKeys(profileReferenceTexts, userId);
      for (const prepared of preparedPosts) {
        for (const key of prepared.trackKeys) referencedTrackKeys.add(key);
      }
      const currentTrackKeys = new Set(currentTrackEntries.map((entry) => entry.track.key));
      const trackEntries = Array.from(knownTrackEntriesByKey.values()).filter((entry) => {
        const referenced =
          referencedTrackKeys.has(entry.track.key) || referencedTrackKeys.has(entry.track.previewKey);
        return referenced || (includeUnreferencedResources && currentTrackKeys.has(entry.track.key));
      });

      const exportProfile = rewriteProfileIntroductionAndSnippet(profile, userId, trackEntries);

      const images = await fetchAllMyImages(userId);
      const allMastersByFilename = new Map<string, MediaObject>();
      images
        .filter((it) => isMasterKey(it.key, userId))
        .forEach((it) => {
          const filename = imageFilenameFromKey(it.key, userId);
          if (!allMastersByFilename.has(filename)) allMastersByFilename.set(filename, it);
        });

      const referencedImageFilenames = collectOwnedImageFilenames(profileReferenceTexts, userId);
      for (const prepared of preparedPosts) {
        for (const filename of prepared.imageFilenames) referencedImageFilenames.add(filename);
      }

      const masterByFilename = new Map<string, MediaObject>();
      for (const [filename, item] of allMastersByFilename) {
        if (!includeUnreferencedResources && !referencedImageFilenames.has(filename)) continue;
        masterByFilename.set(filename, item);
      }

      const availableImageFilenames = new Set<string>(masterByFilename.keys());
      for (const entry of Object.values(previousManifest?.images ?? {})) {
        if (previousManifest?.files[entry.path]) {
          const filename = entry.path.split("/").pop();
          if (filename) availableImageFilenames.add(filename);
        }
      }

      const profileSources = [
        { label: "Profile introduction", text: profile.introduction },
        { label: "Profile snippet", text: profile.snippet },
      ];
      const profileTrackErrors = collectUnexportedTrackReferences(
        profileSources,
        trackEntries,
        userId,
      ).map(({ reference, sources, reason }) => {
        const detail =
          reason === "owned-by-another-user"
            ? "the track belongs to another user"
            : "the track is not in your track storage or previous export";
        return `${sources.join(", ")}: Track was not exported because ${detail}: ${reference}`;
      });
      const profileImageErrors = collectUnexportedImageReferences(
        profileSources,
        availableImageFilenames,
        userId,
      ).map(({ reference, sources, reason }) => {
        const detail =
          reason === "owned-by-another-user"
            ? "the image belongs to another user"
            : "the image is not in your image storage or previous export";
        return `${sources.join(", ")}: Image was not exported because ${detail}: ${reference}`;
      });

      for (const prepared of preparedPosts) {
        if (!prepared.detail) continue;
        const sources = [
          { label: `Post ${prepared.post.id} content`, text: prepared.detail.content },
          { label: `Post ${prepared.post.id} snippet`, text: prepared.detail.snippet },
        ];
        const trackErrors = collectUnexportedTrackReferences(sources, trackEntries, userId).map(
          ({ reference, sources: labels, reason }) => {
            const detail =
              reason === "owned-by-another-user"
                ? "the track belongs to another user"
                : "the track is not in your track storage or previous export";
            return `${labels.join(", ")}: Track was not exported because ${detail}: ${reference}`;
          },
        );
        const imageErrors = collectUnexportedImageReferences(
          sources,
          availableImageFilenames,
          userId,
        ).map(({ reference, sources: labels, reason }) => {
          const detail =
            reason === "owned-by-another-user"
              ? "the image belongs to another user"
              : "the image is not in your image storage or previous export";
          return `${labels.join(", ")}: Image was not exported because ${detail}: ${reference}`;
        });
        prepared.errors = [...trackErrors, ...imageErrors];
      }

      setExportErrors([
        ...profileTrackErrors,
        ...profileImageErrors,
        ...preparedPosts.flatMap((prepared) => prepared.errors),
      ]);

      const nextFiles: Record<string, ExportManifestFile> = {
        ...(previousManifest?.files ?? {}),
      };
      const nextPosts: Record<string, ExportManifestPost> = {};
      const nextImages = { ...(previousManifest?.images ?? {}) };
      const nextTracks = { ...(previousManifest?.tracks ?? {}) };

      const dirtyPosts = preparedPosts.filter((prepared) => prepared.detail !== null);
      const newImages = Array.from(masterByFilename.entries()).filter(([filename, item]) => {
        if (!previousManifest) return true;
        const path = `images/${filename}`;
        return (
          previousManifest.images[item.key]?.path !== path || previousManifest.files[path] == null
        );
      });
      const currentTrackEntryByKey = new Map(
        currentTrackEntries.map((entry) => [entry.track.key, entry] as const),
      );
      const newTracks = trackEntries.filter((entry) => {
        const current = currentTrackEntryByKey.get(entry.track.key);
        if (!current) return false;
        const masterPath = `tracks/masters/${entry.masterFilename}`;
        const previewPath = `tracks/previews/${entry.previewFilename}`;
        if (!previousManifest) return true;
        const previous = previousManifest.tracks[entry.track.key];
        return (
          previous?.masterPath !== masterPath ||
          previous?.previewPath !== previewPath ||
          previousManifest.files[masterPath] == null ||
          previousManifest.files[previewPath] == null
        );
      });

      const totalFiles =
        10 +
        (pubCfg ? 1 : 0) +
        (avatarUrl ? 1 : 0) +
        dirtyPosts.length * 2 +
        newImages.length +
        newTracks.length * 2;
      let completedFiles = 0;
      let beforeBytes = 0;

      const addExportFile = async (
        relativePath: string,
        data: Uint8Array,
        recordInManifest = true,
      ) => {
        await zipWriter.addFile(`${base}${relativePath}`, data, now);
        if (recordInManifest) {
          nextFiles[relativePath] = await makeManifestFileEntry(data, now);
        }
        beforeBytes += data.byteLength;
        completedFiles += 1;
        setExportProgress({ completed: completedFiles, total: totalFiles });
      };

      setExportProgress({ completed: 0, total: totalFiles });
      setExportPhase("exporting");

      const articleContentCss = new TextDecoder().decode(
        await fetchBytes(ARTICLE_CONTENT_CSS_URL, "article stylesheet", 0, 0),
      );
      await addExportFile("style.css", enc.encode(buildHtmlStylesCss(articleContentCss)));
      await addExportFile(
        "assets/track-viewer.css",
        await fetchBytes(
          TRACK_VIEWER_CSS_URL,
          "track viewer stylesheet",
          imageBaseSleepMs,
          perMbSleepMs,
        ),
      );
      await addExportFile(
        "assets/track-viewer.js",
        await fetchBytes(
          TRACK_VIEWER_JS_URL,
          "track viewer script",
          imageBaseSleepMs,
          perMbSleepMs,
        ),
      );
      await addExportFile("assets/track-export.js", enc.encode(TRACK_EXPORT_BOOTSTRAP_JS));
      await addExportFile("README.txt", enc.encode(EXPORT_README_TEXT));
      await addExportFile("profile.json", enc.encode(JSON.stringify(exportProfile, null, 2)));
      await addExportFile("profile.html", enc.encode(renderProfileHtml(exportProfile)));

      if (pubCfg) {
        await addExportFile("pub-config.json", enc.encode(JSON.stringify(pubCfg, null, 2)));
      }

      if (avatarUrl) {
        await addExportFile(
          "avatar.webp",
          await fetchBytes(avatarUrl, "avatar", imageBaseSleepMs, perMbSleepMs),
        );
      }

      await addExportFile(
        "relations.json",
        enc.encode(JSON.stringify({ followees, blockees, likes }, null, 2)),
      );

      for (const prepared of preparedPosts) {
        nextPosts[prepared.post.id] = {
          sourceFingerprint: prepared.sourceFingerprint,
          imageFilenames: [...prepared.imageFilenames].sort(),
          trackKeys: [...prepared.trackKeys].sort(),
          errors: prepared.errors,
        };

        if (!prepared.detail) continue;
        const rewritten = rewritePostContentAndSnippet(prepared.detail, userId, trackEntries);
        const jsonBytes = enc.encode(JSON.stringify(rewritten, null, 2));
        await addExportFile(`posts/${prepared.post.id}.json`, jsonBytes);

        const htmlBytes = enc.encode(renderPostHtml(rewritten));
        await addExportFile(`posts/${prepared.post.id}.html`, htmlBytes);
        await sleepForTransferBytes(jsonBytes.length + htmlBytes.length, 0, perMbSleepMs);
      }

      await addExportFile("index.html", enc.encode(renderIndexHtml(posts, profile)));

      for (const [filename, item] of newImages) {
        const path = `images/${filename}`;
        await addExportFile(
          path,
          await fetchBytes(item.publicUrl, filename, imageBaseSleepMs, perMbSleepMs),
        );
        nextImages[item.key] = {
          key: item.key,
          path,
          size: item.size,
          etag: item.etag,
          lastModified: item.lastModified,
        };
      }
      for (const [filename, item] of masterByFilename) {
        const path = `images/${filename}`;
        if (nextImages[item.key] || !nextFiles[path]) continue;
        nextImages[item.key] = {
          key: item.key,
          path,
          size: item.size,
          etag: item.etag,
          lastModified: item.lastModified,
        };
      }

      for (const entry of newTracks) {
        const masterPath = `tracks/masters/${entry.masterFilename}`;
        const previewPath = `tracks/previews/${entry.previewFilename}`;
        await addExportFile(
          masterPath,
          await fetchBytes(
            entry.track.publicUrl,
            entry.masterFilename,
            imageBaseSleepMs,
            perMbSleepMs,
          ),
        );
        await addExportFile(
          previewPath,
          await fetchBytes(
            entry.track.previewUrl,
            entry.previewFilename,
            imageBaseSleepMs,
            perMbSleepMs,
          ),
        );
        nextTracks[entry.track.key] = {
          key: entry.track.key,
          masterPath,
          previewPath,
          previewKey: entry.track.previewKey,
          publicUrl: entry.track.publicUrl,
          previewUrl: entry.track.previewUrl,
          size: entry.track.size,
          etag: entry.track.etag,
          lastModified: entry.track.lastModified,
        };
      }
      for (const entry of trackEntries) {
        const masterPath = `tracks/masters/${entry.masterFilename}`;
        const previewPath = `tracks/previews/${entry.previewFilename}`;
        if (nextTracks[entry.track.key] || !nextFiles[masterPath] || !nextFiles[previewPath]) {
          continue;
        }
        nextTracks[entry.track.key] = {
          key: entry.track.key,
          masterPath,
          previewPath,
          previewKey: entry.track.previewKey,
          publicUrl: entry.track.publicUrl,
          previewUrl: entry.track.previewUrl,
          size: entry.track.size,
          etag: entry.track.etag,
          lastModified: entry.track.lastModified,
        };
      }

      const manifest: ExportManifest = {
        format: EXPORT_MANIFEST_FORMAT,
        version: EXPORT_MANIFEST_VERSION,
        exporterVersion: EXPORTER_VERSION,
        userId,
        rootDir: exportRootDir,
        exportedAt: now.toISOString(),
        files: nextFiles,
        posts: nextPosts,
        images: nextImages,
        tracks: nextTracks,
      };
      await addExportFile(
        EXPORT_MANIFEST_FILENAME,
        enc.encode(JSON.stringify(manifest, null, 2)),
        false,
      );

      setExportPhase("finalizing");
      await sleep(0);
      const afterBytes = await zipWriter.finalize();

      setDone({ beforeBytes, afterBytes });
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message || String(err));
    } finally {
      setExporting(false);
      setExportPhase(null);
      setExportProgress(null);
    }
  }

  const exportButtonLabel = !exporting
    ? incrementalExport && previousManifestFile
      ? "Export changes"
      : "Export all data"
    : exportPhase === "preparing"
      ? "Preparing…"
      : exportProgress
        ? `${exportPhase === "finalizing" ? "Finalizing" : "Exporting"}… ${exportProgress.completed} / ${exportProgress.total}`
        : "Exporting…";

  const exportErrorIndicator =
    exporting || done ? (
      exportErrors.length > 0 ? (
        <button
          type="button"
          className="text-sm text-red-700 underline underline-offset-2 cursor-pointer"
          onClick={() => setShowExportErrors(true)}
        >
          Errors: {exportErrors.length}
        </button>
      ) : (
        <span className="text-sm text-gray-500">Errors: 0</span>
      )
    ) : null;

  return (
    <main className="max-w-2xl mx-auto mt-12 p-4 bg-white shadow border rounded">
      <h1 className="text-2xl font-bold mb-6">Exporting data</h1>
      <form
        onSubmit={handleExport}
        className="flex flex-col gap-6"
        inert={showExportErrors ? true : undefined}
      >
        <section className="text-sm text-gray-700 leading-relaxed">
          <p>
            You can download your STGY data as a ZIP archive here. To make an incremental export,
            select the incremental export option and choose <code>export-manifest.json</code> from
            your previous extracted export. Changed and new files will be included in the new ZIP;
            files deleted from STGY are left untouched in the local backup. By default, images and
            tracks are included only when referenced by the exported profile or posts. Select the
            option beside the button to include resources that are not referenced. The archive
            includes the following files:
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
              <code className="font-bold">./avatar.webp</code> : Avatar image binary
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
              : Posted image binaries
            </li>
            <li>
              <code className="font-bold">
                ./tracks/masters/<var>&#123;objectId&#125;</var>.<var>&#123;fit|trjgz&#125;</var>
              </code>{" "}
              : Original track binaries
            </li>
            <li>
              <code className="font-bold">
                ./tracks/previews/<var>&#123;objectId&#125;</var>.trjgz
              </code>{" "}
              : TrackJSON previews used by exported HTML
            </li>
            <li>
              <code className="font-bold">./assets/track-viewer.*</code> : Map renderer assets
            </li>
            <li>
              <code className="font-bold">./relations.json</code> : Follow/block/like relations in
              JSON
            </li>
            <li>
              <code className="font-bold">./index.html</code> : Index for all HTML contents.
            </li>
            <li>
              <code className="font-bold">./style.css</code> : Stylesheet for exported HTML
            </li>
            <li>
              <code className="font-bold">./README.txt</code> : Archive overview and viewing
              instructions
            </li>
            <li>
              <code className="font-bold">./export-manifest.json</code> : File inventory and metadata
              for incremental exports
            </li>
          </ul>
          <p className="mt-3">
            The JSON and HTML versions of the profile/posts contain the same information. JSON is
            useful for migrating your data to other services, while HTML is convenient for using the
            exported data as a website or CMS content.
          </p>
          <p className="mt-3">
            Exported maps load their data from the archive. To view them, extract the ZIP and open
            it through a local HTTP server rather than directly through <code>file://</code>.
            Background map tiles still require an Internet connection.
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
          <div
            className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded -mt-2"
            role="status"
          >
            <div className="font-bold">Download finished</div>
            <div className="mt-1 text-sm">
              Included data size (before ZIP): {formatBytes(done.beforeBytes)}
            </div>
            <div className="text-sm">ZIP archive size (after ZIP): {formatBytes(done.afterBytes)}</div>
            <div className="mt-1">{exportErrorIndicator}</div>
          </div>
        )}
        {!done && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="submit"
                className="bg-blue-600 text-white px-8 py-2 rounded disabled:opacity-60"
                disabled={loading || exporting}
              >
                {exportButtonLabel}
              </button>
              {exportErrorIndicator}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={includeUnreferencedResources}
                  onChange={(event) => setIncludeUnreferencedResources(event.target.checked)}
                  disabled={loading || exporting}
                />
                <span>include unreferenced resources</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={incrementalExport}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setIncrementalExport(checked);
                    if (!checked) setPreviousManifestFile(null);
                  }}
                  disabled={loading || exporting}
                />
                <span>incremental export</span>
              </label>
            </div>
            {incrementalExport && (
              <div className="rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">
                <p>
                  Select <code>export-manifest.json</code> from the existing{" "}
                  <code>{exportRootDir}</code> directory to export only changes.
                </p>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => setPreviousManifestFile(event.target.files?.[0] ?? null)}
                  disabled={loading || exporting}
                  className="mt-2 block w-full text-sm text-gray-700 file:mr-3 file:cursor-pointer file:rounded file:border file:border-gray-400 file:bg-white file:px-3 file:py-1.5 file:font-medium file:text-gray-700 hover:file:bg-gray-100 disabled:opacity-60"
                />
              </div>
            )}
          </div>
        )}
      </form>
      {showExportErrors && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowExportErrors(false);
          }}
        >
          <section
            className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded bg-white p-5 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-errors-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") setShowExportErrors(false);
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <h2 id="export-errors-title" className="text-xl font-bold">
                Export errors ({exportErrors.length})
              </h2>
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-100"
                onClick={() => setShowExportErrors(false)}
                autoFocus
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-700">
              The export continued without these resources. Their original references remain in the
              exported profile or posts.
            </p>
            <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm">
              {exportErrors.map((message) => (
                <li key={message} className="break-words">
                  {message}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </main>
  );
}
