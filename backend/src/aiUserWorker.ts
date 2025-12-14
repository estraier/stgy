// このコメントは消さない。
// このコードの中では絶対にanyを使わない。
// AIはコード内にコメントを書かない。人間は書いても良い。
// AIがコードを書き換える際には、絶対にデグレさせてはいけない。既存の機能を許可なく削ることは許容できない。

import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { readPrompt } from "./utils/prompt";
import { AuthService } from "./services/auth";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import { countPseudoTokens, sliceByPseudoTokens } from "stgy-markdown";
import type { Pool } from "pg";
import type Redis from "ioredis";
import http from "http";
import https from "https";
import { URLSearchParams } from "url";
import type { AiUser, AiUserInterest, ChatRequest, ChatResponse } from "./models/aiUser";
import type { UserLite, UserDetail } from "./models/user";
import type { Post, PostDetail } from "./models/post";
import type { Notification } from "./models/notification";

const logger = createLogger({ file: "aiUserWorker" });

let pgPool: Pool | null = null;
let redis: Redis | null = null;
let authService: AuthService | null = null;

let shuttingDown = false;
const inflight = new Set<Promise<void>>();

type HttpResult = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type PostCandidate = {
  postId: string;
  weight: number;
};

type PeerImpressionPayloadJson = {
  impression: string;
  tags?: string[];
};

class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateForLog(value: unknown, max: number): string {
  const s = String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (countPseudoTokens(s) <= max) {
    return s;
  }
  if (s.length <= max) return s;
  return sliceByPseudoTokens(s, 0, max);
}

function truncateText(text: string, max: number): string {
  if (countPseudoTokens(text) <= max) {
    return text;
  }
  return sliceByPseudoTokens(text, 0, max) + "…";
}

function httpRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResult> {
  const method = options.method ?? "GET";
  const headers = options.headers ?? {};
  const body = options.body ?? "";
  const url = new URL(path, Config.BACKEND_API_BASE_URL);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          const bodyStr = Buffer.concat(chunks).toString("utf8");
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: bodyStr });
        });
      },
    );

    req.on("error", reject);
    if (body.length > 0) req.write(body);
    req.end();
  });
}

async function apiRequest(
  sessionCookie: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const method = options.method ?? "GET";
  let bodyStr = "";
  const headers: Record<string, string> = { Cookie: sessionCookie };
  if (options.body !== undefined) {
    bodyStr = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
  }
  const res = await httpRequest(path, { method, headers, body: bodyStr });
  if (res.statusCode === 401) {
    throw new UnauthorizedError(`401 from ${path}`);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(
      `request failed: ${res.statusCode} ${method} ${path} ${truncateForLog(res.body, 50)}`,
    );
  }
  return res;
}

function evaluateChatResponseAsJson<T = unknown>(raw: string): T {
  let s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) s = fenced[1].trim();
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const afterLast = s.slice(lastBrace + 1);
    if (/^\s*$/.test(afterLast)) {
      s = s.slice(firstBrace, lastBrace + 1);
    }
  }
  if (/,\s*[}\]]\s*$/.test(s)) {
    s = s.replace(/,\s*([}\]])\s*$/u, "$1");
  }
  return JSON.parse(s) as T;
}

function parseTagsField(raw: unknown, maxCount: number): string[] {
  if (!Array.isArray(raw)) return [];
  const tags: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim().slice(0, 20);
    if (!trimmed) continue;
    tags.push(trimmed);
    if (tags.length >= maxCount) break;
  }
  return tags;
}

function parsePeerImpressionPayload(payload: string): PeerImpressionPayloadJson | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed)) return null;
    const imp = parsed["impression"];
    if (typeof imp !== "string") return null;
    const tags = parseTagsField(parsed["tags"], 5);
    return { impression: imp, tags };
  } catch {
    return null;
  }
}

function buildProfileExcerpt(
  profile: UserDetail,
  interest: AiUserInterest | null,
): {
  userId: string;
  nickname: string;
  locale: string;
  introduction: string;
  aiPersonality: string;
  currentInterest: string;
  currentInterestTags: string[];
} {
  let currentInterest = "";
  const currentInterestTags: string[] = [];

  if (interest && typeof interest.payload === "string") {
    try {
      const obj = JSON.parse(interest.payload) as unknown;
      if (isRecord(obj) && typeof obj["interest"] === "string") {
        currentInterest = truncateText(obj["interest"], 200);
        const tags = parseTagsField(obj["tags"], 5);
        for (const t of tags) currentInterestTags.push(t);
      } else {
        currentInterest = truncateText(interest.payload, 200);
      }
    } catch {
      currentInterest = truncateText(interest.payload, 200);
    }
  }

  return {
    userId: profile.id,
    nickname: profile.nickname,
    locale: profile.locale,
    introduction: truncateText(profile.introduction, 200),
    aiPersonality: truncateText(profile.aiPersonality ?? "", 200),
    currentInterest,
    currentInterestTags,
  };
}

function parseChatResponse(body: string): ChatResponse {
  const parsed = JSON.parse(body) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`chat response is not an object: ${truncateForLog(body, 50)}`);
  }
  const msg = parsed["message"];
  if (!isRecord(msg)) {
    throw new Error(`chat response missing message object: ${truncateForLog(body, 50)}`);
  }
  const content = msg["content"];
  if (typeof content !== "string") {
    throw new Error(`chat response missing content string: ${truncateForLog(body, 50)}`);
  }
  return { message: { content } };
}

async function loginAsAdmin(): Promise<string> {
  if (!authService) throw new Error("authService is not initialized");
  const res = await authService.loginAsAdmin();
  const sessionCookie = `session_id=${res.sessionId}`;
  return sessionCookie;
}

async function switchToUser(adminSessionCookie: string, userId: string): Promise<string> {
  const res = await apiRequest(adminSessionCookie, "/auth/switch-user", {
    method: "POST",
    body: { id: userId },
  });
  const raw = res.headers["set-cookie"] as unknown;
  let cookie: string | null = null;
  if (Array.isArray(raw)) {
    for (const s of raw) {
      if (typeof s !== "string") continue;
      const m = s.match(/session_id=[^;]+/);
      if (m) {
        cookie = m[0];
        break;
      }
    }
  } else if (typeof raw === "string") {
    const m = raw.match(/session_id=[^;]+/);
    cookie = m ? m[0] : null;
  }
  if (!cookie) {
    throw new Error(`session_id cookie not found in switch-user response for userId=${userId}`);
  }
  return cookie;
}

async function fetchNextUsers(
  sessionCookie: string,
  offset: number,
  limit: number,
): Promise<AiUser[]> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  const res = await apiRequest(sessionCookie, `/ai-users?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const out: AiUser[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const id = item["id"];
    const nickname = item["nickname"];
    if (typeof id !== "string" || id.trim() === "") continue;
    if (typeof nickname !== "string") continue;
    out.push(item as AiUser);
  }
  return out;
}

async function fetchUserProfile(sessionCookie: string, userId: string): Promise<UserDetail> {
  const res = await apiRequest(sessionCookie, `/users/${encodeURIComponent(userId)}`, {
    method: "GET",
  });
  const parsed = JSON.parse(res.body) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`user profile api returned non-object: ${truncateForLog(res.body, 50)}`);
  }
  const id = parsed["id"];
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`user profile missing id: ${truncateForLog(res.body, 50)}`);
  }
  return parsed as UserDetail;
}

async function fetchPeerImpression(
  sessionCookie: string,
  aiUserId: string,
  peerId: string,
): Promise<string> {
  const path = `/ai-users/${encodeURIComponent(aiUserId)}/peer-impressions/${encodeURIComponent(
    peerId,
  )}`;
  const res = await httpRequest(path, { method: "GET", headers: { Cookie: sessionCookie } });
  if (res.statusCode === 401) throw new UnauthorizedError(`401 from ${path}`);
  if (res.statusCode === 404) return "";
  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error(
      `failed to fetch peer impression userId=${aiUserId} peerId=${peerId}: ${res.statusCode} ${truncateForLog(
        res.body,
        50,
      )}`,
    );
    return "";
  }
  const parsed = JSON.parse(res.body) as unknown;
  if (!isRecord(parsed)) return "";
  const payload = parsed["payload"];
  return typeof payload === "string" ? payload : "";
}

async function fetchPostSummary(sessionCookie: string, postId: string): Promise<string> {
  const path = `/ai-posts/${encodeURIComponent(postId)}`;
  const res = await httpRequest(path, { method: "GET", headers: { Cookie: sessionCookie } });
  if (res.statusCode === 401) throw new UnauthorizedError(`401 from ${path}`);
  if (res.statusCode === 404) return "";
  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error(
      `failed to fetch post summary postId=${postId}: ${res.statusCode} ${truncateForLog(res.body, 50)}`,
    );
    return "";
  }
  try {
    const parsed = JSON.parse(res.body) as unknown;
    if (!isRecord(parsed)) return "";
    const summary = parsed["summary"];
    return typeof summary === "string" ? summary : "";
  } catch (e) {
    logger.error(`failed to parse post summary postId=${postId}: ${e}`);
    return "";
  }
}

async function fetchFolloweePosts(sessionCookie: string, userId: string): Promise<Post[]> {
  const params = new URLSearchParams();
  params.set("userId", userId);
  params.set("offset", "0");
  params.set("limit", String(Config.AI_USER_FETCH_POST_LIMIT));
  params.set("includeSelf", "false");
  params.set("includeReplies", "true");
  params.set("focusUserId", userId);
  params.set("limitPerUser", "3");
  const res = await apiRequest(sessionCookie, `/posts/by-followees?${params.toString()}`, {
    method: "GET",
  });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as Post[];
}

async function fetchLatestPosts(sessionCookie: string, userId: string): Promise<Post[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(Config.AI_USER_FETCH_POST_LIMIT));
  params.set("order", "desc");
  params.set("focusUserId", userId);
  const res = await apiRequest(sessionCookie, `/posts?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as Post[];
}

async function fetchNotifications(sessionCookie: string): Promise<Notification[]> {
  const res = await httpRequest("/notifications/feed", {
    method: "GET",
    headers: { Cookie: sessionCookie },
  });

  if (res.statusCode === 401) {
    throw new UnauthorizedError("401 from /notifications/feed");
  }
  if (res.statusCode === 304) {
    return [];
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(
      `request failed: ${res.statusCode} GET /notifications/feed ${truncateForLog(res.body, 50)}`,
    );
  }
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as Notification[];
}

async function checkPostSummary(sessionCookie: string, postId: string): Promise<boolean> {
  const res = await httpRequest(`/ai-posts/${encodeURIComponent(postId)}`, {
    method: "HEAD",
    headers: { Cookie: sessionCookie },
  });

  if (res.statusCode === 401) {
    throw new UnauthorizedError(`401 from /ai-posts/${encodeURIComponent(postId)}`);
  }
  if (res.statusCode === 200) return true;
  if (res.statusCode === 404) return false;

  throw new Error(
    `request failed: ${res.statusCode} HEAD /ai-posts/${encodeURIComponent(postId)} ${truncateForLog(
      res.body,
      50,
    )}`,
  );
}

async function checkPostImpression(
  sessionCookie: string,
  aiUserId: string,
  postId: string,
): Promise<boolean> {
  const res = await httpRequest(
    `/ai-users/${encodeURIComponent(aiUserId)}/post-impressions/${encodeURIComponent(postId)}`,
    { method: "HEAD", headers: { Cookie: sessionCookie } },
  );
  if (res.statusCode === 401) {
    throw new UnauthorizedError(
      `401 from /ai-users/${encodeURIComponent(aiUserId)}/post-impressions/${encodeURIComponent(
        postId,
      )}`,
    );
  }
  if (res.statusCode === 200) return true;
  if (res.statusCode === 404) return false;
  throw new Error(
    `request failed: ${res.statusCode} HEAD /ai-users/${encodeURIComponent(
      aiUserId,
    )}/post-impressions/${encodeURIComponent(postId)} ${truncateForLog(res.body, 50)}`,
  );
}

async function fetchPostById(
  sessionCookie: string,
  postId: string,
  focusUserId: string,
): Promise<PostDetail> {
  const url = new URL(`/posts/${encodeURIComponent(postId)}`, Config.BACKEND_API_BASE_URL);
  url.searchParams.set("focusUserId", focusUserId);
  const path = url.pathname + url.search;
  const res = await apiRequest(sessionCookie, path, { method: "GET" });
  return JSON.parse(res.body) as PostDetail;
}

async function fetchOwnRecentPosts(sessionCookie: string, userId: string): Promise<PostDetail[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(Config.AI_USER_READ_POST_LIMIT));
  params.set("order", "desc");
  params.set("ownedBy", userId);
  params.set("focusUserId", userId);
  const res = await apiRequest(sessionCookie, `/posts?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const list = parsed as Post[];
  const ids = list.map((p) => p.id).slice(0, Config.AI_USER_READ_POST_LIMIT);

  const result: PostDetail[] = [];
  for (const id of ids) {
    try {
      const detail = await fetchPostById(sessionCookie, id, userId);
      result.push(detail);
    } catch (e) {
      logger.info(`Failed to fetch own post detail userId=${userId} postId=${id}: ${e}`);
    }
  }
  return result;
}

async function fetchFollowerRecentRandomPostIds(
  sessionCookie: string,
  userId: string,
): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(Config.AI_USER_FETCH_POST_LIMIT));
  params.set("order", "desc");
  const res = await apiRequest(
    sessionCookie,
    `/users/${encodeURIComponent(userId)}/followers?${params.toString()}`,
    { method: "GET" },
  );
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const followers = parsed as UserLite[];
  if (followers.length === 0) return [];

  const shuffledFollowerIds = followers
    .map((f) => ({ id: f.id, score: Math.random() }))
    .filter((x) => x.id.trim() !== "")
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((x) => x.id);

  const postIds: string[] = [];
  for (const followerId of shuffledFollowerIds) {
    try {
      const posts = await fetchOwnRecentPosts(sessionCookie, followerId);
      for (const post of posts.slice(0, 3)) {
        postIds.push(post.id);
      }
    } catch (e) {
      logger.info(
        `Failed to fetch recent posts followerId=${followerId} of userId=${userId}: ${e}`,
      );
    }
  }

  return postIds;
}

async function fetchPostsToRead(sessionCookie: string, userId: string): Promise<PostDetail[]> {
  const candidates: PostCandidate[] = [];

  const followeePosts = await fetchFolloweePosts(sessionCookie, userId);
  for (const post of followeePosts) {
    if (post.ownedBy === userId) continue;

    const hasSummary = await checkPostSummary(sessionCookie, post.id);
    if (!hasSummary) continue;

    const hasImpression = await checkPostImpression(sessionCookie, userId, post.id);
    if (!hasImpression) {
      candidates.push({ postId: post.id, weight: 1 });
    }
  }

  const latestPosts = await fetchLatestPosts(sessionCookie, userId);
  for (const post of latestPosts) {
    if (post.ownedBy === userId) continue;

    const hasSummary = await checkPostSummary(sessionCookie, post.id);
    if (!hasSummary) continue;

    const hasImpression = await checkPostImpression(sessionCookie, userId, post.id);
    if (!hasImpression) {
      candidates.push({ postId: post.id, weight: 1 });
    }
  }

  const notifications = await fetchNotifications(sessionCookie);
  for (const n of notifications) {
    if (n.slot.startsWith("reply:")) {
      for (const record of n.records) {
        if (!("postId" in record)) continue;
        if (typeof record.postId !== "string") continue;
        if (!("userId" in record)) continue;
        if (typeof record.userId !== "string") continue;
        if (record.userId === userId) continue;

        const hasSummary = await checkPostSummary(sessionCookie, record.postId);
        if (!hasSummary) continue;

        const hasImpression = await checkPostImpression(sessionCookie, userId, record.postId);
        if (!hasImpression) {
          candidates.push({ postId: record.postId, weight: 0.5 });
        }
      }
    }
    if (n.slot.startsWith("mention:")) {
      for (const record of n.records) {
        if (!("postId" in record)) continue;
        if (typeof record.postId !== "string") continue;
        if (!("userId" in record)) continue;
        if (typeof record.userId !== "string") continue;
        if (record.userId === userId) continue;

        const hasSummary = await checkPostSummary(sessionCookie, record.postId);
        if (!hasSummary) continue;

        const hasImpression = await checkPostImpression(sessionCookie, userId, record.postId);
        if (!hasImpression) {
          candidates.push({ postId: record.postId, weight: 0.3 });
        }
      }
    }
  }

  try {
    const followerPostIds = await fetchFollowerRecentRandomPostIds(sessionCookie, userId);
    for (const postId of followerPostIds) {
      const hasSummary = await checkPostSummary(sessionCookie, postId);
      if (!hasSummary) continue;

      const hasImpression = await checkPostImpression(sessionCookie, userId, postId);
      if (!hasImpression) {
        candidates.push({ postId, weight: 0.3 });
      }
    }
  } catch (e) {
    logger.error(`Error while fetching follower recent random post ids for userId=${userId}: ${e}`);
  }

  if (candidates.length === 0) {
    logger.info("No candidate posts to read");
    return [];
  }

  const weightByPost = new Map<string, number>();
  for (const { postId, weight } of candidates) {
    const prev = weightByPost.get(postId);
    if (prev === undefined || weight > prev) {
      weightByPost.set(postId, weight);
    }
  }

  const scoresByPost = new Map<string, number>();
  for (const [postId, weight] of weightByPost.entries()) {
    if (weight <= 0) continue;
    const score = Math.random() * weight;
    scoresByPost.set(postId, score);
  }

  const topPostIds = [...scoresByPost.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Config.AI_USER_READ_POST_LIMIT)
    .map(([postId]) => postId);

  logger.info(`Selected post IDs to read: ${topPostIds.join(",")}`);

  const result: PostDetail[] = [];
  for (const postId of topPostIds) {
    try {
      const post = await fetchPostById(sessionCookie, postId, userId);
      result.push(post);
    } catch (e) {
      logger.info(`Failed to fetch post detail for postId=${postId}: ${e}`);
    }
  }

  return result;
}

async function createPostImpression(
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
  post: PostDetail,
): Promise<void> {
  const baseLocale =
    (post.locale ?? "") || (post.ownerLocale ?? "") || (profile.locale ?? "") || "en";
  const locale = baseLocale.replace(/_/g, "-");

  const profileExcerpt = buildProfileExcerpt(profile, interest);
  const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");

  const rawPeerImpression = await fetchPeerImpression(userSessionCookie, profile.id, post.ownedBy);
  let peerImpressionText = rawPeerImpression;
  let peerTags: string[] = [];

  if (rawPeerImpression) {
    const parsedPeer = parsePeerImpressionPayload(rawPeerImpression);
    if (parsedPeer) {
      peerImpressionText = truncateText(parsedPeer.impression, Config.AI_USER_OUTPUT_TEXT_LIMIT);
      peerTags = parsedPeer.tags?.slice(0, 5) ?? [];
    } else {
      peerImpressionText = truncateText(rawPeerImpression, Config.AI_USER_OUTPUT_TEXT_LIMIT);
    }
  } else {
    peerImpressionText = "";
    peerTags = [];
  }

  const rawSummary = await fetchPostSummary(userSessionCookie, post.id);
  const summaryText = rawSummary ? truncateText(rawSummary, Config.AI_USER_POST_TEXT_LIMIT) : "";

  const postText = truncateText(post.content, Config.AI_USER_POST_TEXT_LIMIT);
  const postExcerpt = {
    author: post.ownerNickname,
    locale,
    createdAt: post.createdAt,
    content: postText,
    summary: summaryText,
    peerImpression: peerImpressionText,
    peerTags,
  };

  const postJson = JSON.stringify(postExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");

  let maxChars = Config.AI_USER_IMPRESSION_LENGTH;
  let tagChars = Config.AI_TAG_MAX_LENGTH;
  if (
    locale === "ja" ||
    locale.startsWith("ja-") ||
    locale === "zh" ||
    locale.startsWith("zh-") ||
    locale === "ko" ||
    locale.startsWith("ko-")
  ) {
    maxChars = Config.AI_USER_IMPRESSION_LENGTH_CJK;
    tagChars = Config.AI_TAG_MAX_LENGTH_CJK;
  }

  let localeText = locale;
  if (locale === "en" || locale.startsWith("en-")) localeText = `English (${locale})`;
  if (locale === "ja" || locale.startsWith("ja-")) localeText = `日本語（${locale}）`;

  const promptTpl =
    readPrompt("common-profile", locale, "en").trim() +
    "\n\n" +
    readPrompt("post-impression", locale, "en").trim() +
    "\n";
  const prompt = promptTpl
    .replaceAll("{{PROFILE_JSON}}", profileJson)
    .replaceAll("{{POST_JSON}}", postJson)
    .replaceAll("{{MAX_CHARS}}", String(maxChars))
    .replaceAll("{{TAG_CHARS}}", String(tagChars))
    .replaceAll("{{TAG_NUM}}", String(Config.AI_TAG_MAX_COUNT))
    .replaceAll("{{LOCALE}}", localeText);

  // for debug
  console.log(prompt);

  const chatReq: ChatRequest = {
    messages: [{ role: "user", content: prompt }],
  };

  const chatRes = await apiRequest(userSessionCookie, "/ai-users/chat", {
    method: "POST",
    body: chatReq,
  });

  const chat = parseChatResponse(chatRes.body);
  const content = chat.message.content;

  if (content.trim() === "") {
    throw new Error(`ai-users/chat returned empty content userId=${profile.id} postId=${post.id}`);
  }

  // for debug
  console.log(content);

  const parsed = evaluateChatResponseAsJson<unknown>(content);

  if (!isRecord(parsed)) {
    throw new Error(
      `AI output JSON is not an object userId=${profile.id} postId=${post.id} content=${truncateForLog(
        content,
        50,
      )}`,
    );
  }

  const impressionRaw = parsed["impression"];
  if (typeof impressionRaw !== "string") {
    throw new Error(
      `AI output JSON missing impression userId=${profile.id} postId=${post.id} content=${truncateForLog(
        content,
        50,
      )}`,
    );
  }

  const impression = truncateText(impressionRaw.trim(), Config.AI_USER_OUTPUT_TEXT_LIMIT);
  const tags = parseTagsField(parsed["tags"], Config.AI_TAG_MAX_COUNT);

  const payload = JSON.stringify({ impression, tags });

  await apiRequest(
    userSessionCookie,
    `/ai-users/${encodeURIComponent(profile.id)}/post-impressions`,
    {
      method: "POST",
      body: { postId: post.id, payload },
    },
  );

  logger.info(
    `Saved post impression userId=${profile.id} postId=${post.id} tags=${tags.join(",")}`,
  );
}

async function processUser(adminSessionCookie: string, user: AiUser): Promise<void> {
  logger.info(`Processing AI user: id=${user.id}, nickname=${user.nickname}`);
  const userSessionCookie = await switchToUser(adminSessionCookie, user.id);
  const profile = await fetchUserProfile(userSessionCookie, user.id);
  const interest: AiUserInterest | null = null;
  const posts = await fetchPostsToRead(userSessionCookie, user.id);
  logger.info(`postsToRead userId=${user.id} count=${posts.length}`);
  const peerIdSet = new Set<string>();
  const topPeerPosts = new Map<string, PostDetail>();
  for (const post of posts) {
    peerIdSet.add(post.ownedBy);
    if (topPeerPosts.size < 5 && !topPeerPosts.has(post.ownedBy)) {
      topPeerPosts.set(post.ownedBy, post);
    }
    try {
      await createPostImpression(userSessionCookie, profile, interest, post);
    } catch (e) {
      if (e instanceof UnauthorizedError) throw e;
      logger.error(`error creating post impression userId=${user.id} postId=${post.id}: ${e}`);
    }
  }

  const peerIds = Array.from(peerIdSet);
  logger.info(`Selected peer IDs to read: ${peerIds.join(",")}`);
  void topPeerPosts;
}

async function processLoop(): Promise<void> {
  while (!shuttingDown) {
    let adminSessionCookie: string;
    try {
      adminSessionCookie = await loginAsAdmin();
    } catch (e) {
      logger.error(`loginAsAdmin error: ${e}`);
      await sleep(Config.AI_USER_IDLE_SLEEP_MS);
      continue;
    }

    let needRelogin = false;
    let offset = 0;

    while (!shuttingDown) {
      let users: AiUser[] = [];
      try {
        users = await fetchNextUsers(adminSessionCookie, offset, Config.AI_USER_BATCH_SIZE);
      } catch (e) {
        if (e instanceof UnauthorizedError) {
          needRelogin = true;
          logger.warn("session expired while fetching users; relogin");
          break;
        }
        logger.error(`fetchNextUsers error: ${e}`);
        break;
      }

      if (users.length === 0) break;

      let index = 0;
      while (index < users.length && !shuttingDown) {
        if (inflight.size >= Config.AI_USER_CONCURRENCY) {
          await Promise.race(inflight);
          continue;
        }

        const user = users[index++];

        const p = (async () => {
          try {
            await processUser(adminSessionCookie, user);
          } catch (e) {
            if (e instanceof UnauthorizedError) {
              needRelogin = true;
              logger.warn(`401 while processing userId=${user.id}; will relogin`);
              return;
            }
            logger.error(`error processing userId=${user.id}: ${e}`);
          }
        })();

        inflight.add(p);
        p.finally(() => inflight.delete(p));
      }

      if (inflight.size > 0) await Promise.allSettled(Array.from(inflight));
      if (needRelogin) break;

      offset += users.length;
      if (users.length < Config.AI_USER_BATCH_SIZE) break;
    }

    if (inflight.size > 0) await Promise.allSettled(Array.from(inflight));
    await sleep(Config.AI_USER_IDLE_SLEEP_MS);

    logger.info("done");
    await sleep(60 * 1000);
  }
}

async function idleLoop(): Promise<void> {
  while (!shuttingDown) await sleep(Config.AI_USER_IDLE_SLEEP_MS);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (inflight.size > 0) await Promise.allSettled(Array.from(inflight));
    const tasks: Promise<unknown>[] = [];
    if (pgPool) tasks.push(pgPool.end());
    if (redis) tasks.push(redis.quit());
    if (tasks.length > 0) await Promise.allSettled(tasks);
  } finally {
    process.exit(0);
  }
}

async function main(): Promise<void> {
  logger.info(`STGY AI user worker started (concurrency=${Config.AI_USER_CONCURRENCY})`);
  pgPool = await connectPgWithRetry();
  redis = await connectRedisWithRetry();
  authService = new AuthService(pgPool, redis);

  const onSig = () => {
    shutdown().catch(() => process.exit(1));
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  if (Config.OPENAI_API_KEY) {
    await processLoop();
  } else {
    logger.info("OPENAI_API_KEY is not set so do nothing.");
    await idleLoop();
  }
}

main().catch((e) => {
  logger.error(`Fatal error: ${e}`);
  process.exit(1);
});
