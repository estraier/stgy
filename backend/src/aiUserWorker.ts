// このコメントは消さない。
// このコードの中では絶対にanyを使わない。
// AIはコード内にコメントを書かない。人間は書いても良い。
// AIがコードを書き換える際には、絶対にデグレさせてはいけない。既存の機能を許可なく削ることは許容できない。

import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { readPrompt } from "./utils/prompt";
import { AuthService } from "./services/auth";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import { decodeFeatures, cosineSimilarity } from "./utils/vectorSpace";
import { countPseudoTokens, sliceByPseudoTokens } from "stgy-markdown";
import type { Pool } from "pg";
import type Redis from "ioredis";
import http from "http";
import https from "https";
import { URLSearchParams } from "url";
import type {
  AiUser,
  AiUserInterest,
  AiPeerImpression,
  AiPostImpression,
  ChatRequest,
  ChatResponse,
  GenerateFeaturesRequest,
} from "./models/aiUser";
import type { AiPostSummary, AiPostSummaryPacket } from "./models/aiPost";
import type { UserLite, UserDetail } from "./models/user";
import type { Post, PostDetail } from "./models/post";
import type { Notification, NotificationPostRecord } from "./models/notification";

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

type PostToRead = {
  post: PostDetail;
  similarity: number;
};

type PeerImpressionPayload = {
  impression: string;
  tags: string[];
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

function parseDateMs(s: string): number | null {
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function isNewerThanDays(datetime: string, days: number): boolean {
  if (!datetime || days <= 0) return false;
  const ms = parseDateMs(datetime);
  if (ms === null) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return ms > cutoff;
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

function base64ToInt8(v: string): Int8Array {
  const buf = Buffer.from(v, "base64");
  return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function parsePeerImpressionPayload(payload: string): PeerImpressionPayload | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed)) return null;
    const imp = parsed["impression"];
    if (typeof imp !== "string") return null;
    const tags = parseTagsField(parsed["tags"], Config.AI_TAG_MAX_COUNT);
    return { impression: imp, tags };
  } catch {
    return null;
  }
}

async function generateFeatures(
  sessionCookie: string,
  req: GenerateFeaturesRequest,
): Promise<string> {
  const res = await apiRequest(sessionCookie, "/ai-users/features", {
    method: "POST",
    body: { model: req.model, input: req.input },
  });

  const parsed = JSON.parse(res.body) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`features api returned non-object payload: ${truncateForLog(res.body, 50)}`);
  }
  const featuresRaw = parsed["features"];
  if (typeof featuresRaw !== "string" || featuresRaw.trim() === "") {
    throw new Error(`features api returned invalid features: ${truncateForLog(res.body, 50)}`);
  }
  const features = featuresRaw.trim();
  const buf = Buffer.from(features, "base64");
  if (buf.byteLength <= 0) {
    throw new Error(`features api returned empty features: ${truncateForLog(res.body, 50)}`);
  }
  return features;
}

function buildProfileExcerpt(
  profile: UserDetail,
  interest: AiUserInterest | null,
): {
  userId: string;
  locale: string;
  nickname: string;
  introduction: string;
  aiPersonality: string;
  currentInterest: string;
  currentInterestTags: string[];
} {
  const currentInterest = interest
    ? truncateText(interest.interest, Config.AI_USER_INTRO_TEXT_LIMIT)
    : "";
  const currentInterestTags = interest
    ? parseTagsField(interest.tags, Config.AI_TAG_MAX_COUNT)
    : [];
  return {
    userId: profile.id,
    locale: profile.locale,
    nickname: profile.nickname,
    introduction: truncateText(profile.introduction, Config.AI_USER_INTRO_TEXT_LIMIT),
    aiPersonality: truncateText(profile.aiPersonality ?? "", Config.AI_USER_INTRO_TEXT_LIMIT),
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
  const raw = res.headers["set-cookie"] as
    | http.IncomingHttpHeaders["set-cookie"]
    | string
    | undefined;
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

async function fetchUserInterest(
  sessionCookie: string,
  userId: string,
): Promise<AiUserInterest | null> {
  const path = `/ai-users/${encodeURIComponent(userId)}/interests`;
  const res = await httpRequest(path, { method: "GET", headers: { Cookie: sessionCookie } });
  if (res.statusCode === 401) throw new UnauthorizedError(`401 from ${path}`);
  if (res.statusCode === 404) return null;
  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error(
      `failed to fetch user interest userId=${userId}: ${res.statusCode} ${truncateForLog(
        res.body,
        50,
      )}`,
    );
    return null;
  }
  try {
    const parsed = JSON.parse(res.body) as unknown;
    if (!isRecord(parsed)) return null;
    const uidRaw = parsed["userId"];
    const updatedAtRaw = parsed["updatedAt"];
    const interestRaw = parsed["interest"];
    const featuresRaw = parsed["features"];
    const tagsRaw = parsed["tags"];
    const uid = typeof uidRaw === "string" && uidRaw.trim() !== "" ? uidRaw : userId;
    const updatedAt = typeof updatedAtRaw === "string" ? updatedAtRaw : "";
    if (typeof interestRaw !== "string") return null;
    if (typeof featuresRaw !== "string" || featuresRaw.trim() === "") return null;
    let features: Int8Array;
    try {
      features = base64ToInt8(featuresRaw);
    } catch (e) {
      logger.error(`failed to decode user interest features userId=${userId}: ${e}`);
      return null;
    }
    const tags = parseTagsField(tagsRaw, Config.AI_TAG_MAX_COUNT);
    return { userId: uid, updatedAt, interest: interestRaw, features, tags };
  } catch (e) {
    logger.error(`failed to parse user interest userId=${userId}: ${e}`);
    return null;
  }
}

async function fetchPeerImpression(
  sessionCookie: string,
  aiUserId: string,
  peerId: string,
): Promise<AiPeerImpression | null> {
  const path = `/ai-users/${encodeURIComponent(aiUserId)}/peer-impressions/${encodeURIComponent(
    peerId,
  )}`;
  const res = await httpRequest(path, { method: "GET", headers: { Cookie: sessionCookie } });
  if (res.statusCode === 401) throw new UnauthorizedError(`401 from ${path}`);
  if (res.statusCode === 404) return null;
  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error(
      `failed to fetch peer impression userId=${aiUserId} peerId=${peerId}: ${res.statusCode} ${truncateForLog(
        res.body,
        50,
      )}`,
    );
    return null;
  }
  const parsed = JSON.parse(res.body) as unknown;
  if (!isRecord(parsed)) return null;
  const uid = parsed["userId"];
  const pid = parsed["peerId"];
  const updatedAt = parsed["updatedAt"];
  const payload = parsed["payload"];
  if (typeof uid !== "string" || uid.trim() === "") return null;
  if (typeof pid !== "string" || pid.trim() === "") return null;
  if (typeof updatedAt !== "string") return null;
  if (typeof payload !== "string") return null;
  return { userId: uid, peerId: pid, updatedAt, payload };
}

async function fetchOwnPeerImpressions(
  sessionCookie: string,
  userId: string,
  limit: number,
): Promise<AiPeerImpression[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(limit));
  params.set("order", "desc");
  const path = `/ai-users/${encodeURIComponent(userId)}/peer-impressions?${params.toString()}`;
  const res = await httpRequest(path, { method: "GET", headers: { Cookie: sessionCookie } });
  if (res.statusCode === 401) throw new UnauthorizedError(`401 from ${path}`);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error(
      `failed to fetch own peer impressions userId=${userId}: ${res.statusCode} ${truncateForLog(
        res.body,
        50,
      )}`,
    );
    return [];
  }
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const out: AiPeerImpression[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const uid = item["userId"];
    const peerId = item["peerId"];
    const updatedAt = item["updatedAt"];
    const payload = item["payload"];
    if (typeof uid !== "string" || uid.trim() === "") continue;
    if (typeof peerId !== "string" || peerId.trim() === "") continue;
    if (typeof updatedAt !== "string") continue;
    if (typeof payload !== "string") continue;
    out.push({ userId: uid, peerId, updatedAt, payload });
    if (out.length >= 3) break;
  }
  return out;
}

async function fetchOwnPostImpressions(
  sessionCookie: string,
  userId: string,
  limit: number,
): Promise<AiPostImpression[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(limit));
  params.set("order", "desc");
  const path = `/ai-users/${encodeURIComponent(userId)}/post-impressions?${params.toString()}`;
  const res = await httpRequest(path, { method: "GET", headers: { Cookie: sessionCookie } });
  if (res.statusCode === 401) throw new UnauthorizedError(`401 from ${path}`);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error(
      `failed to fetch own post impressions userId=${userId}: ${res.statusCode} ${truncateForLog(
        res.body,
        50,
      )}`,
    );
    return [];
  }
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const out: AiPostImpression[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const uid = item["userId"];
    const peerId = item["peerId"];
    const postId = item["postId"];
    const updatedAt = item["updatedAt"];
    const payload = item["payload"];
    if (typeof uid !== "string" || uid.trim() === "") continue;
    if (typeof peerId !== "string" || peerId.trim() === "") continue;
    if (typeof postId !== "string" || postId.trim() === "") continue;
    if (typeof updatedAt !== "string") continue;
    if (typeof payload !== "string") continue;
    out.push({ userId: uid, peerId, postId, updatedAt, payload });
    if (out.length >= 3) break;
  }
  return out;
}

async function fetchPostSummary(sessionCookie: string, postId: string): Promise<AiPostSummary> {
  const path = `/ai-posts/${encodeURIComponent(postId)}`;
  const res = await httpRequest(path, { method: "GET", headers: { Cookie: sessionCookie } });
  if (res.statusCode === 401) throw new UnauthorizedError(`401 from ${path}`);
  if (res.statusCode === 404)
    return { postId, updatedAt: "", summary: null, features: null, tags: [] };
  if (res.statusCode < 200 || res.statusCode >= 300) {
    logger.error(
      `failed to fetch post summary postId=${postId}: ${res.statusCode} ${truncateForLog(res.body, 50)}`,
    );
    return { postId, updatedAt: "", summary: null, features: null, tags: [] };
  }
  try {
    const parsed = JSON.parse(res.body) as unknown;
    if (!isRecord(parsed))
      return { postId, updatedAt: "", summary: null, features: null, tags: [] };
    const pkt = parsed as AiPostSummaryPacket;
    const pid = typeof pkt.postId === "string" && pkt.postId.trim() !== "" ? pkt.postId : postId;
    const updatedAt = typeof pkt.updatedAt === "string" ? pkt.updatedAt : "";
    const summary = typeof pkt.summary === "string" || pkt.summary === null ? pkt.summary : null;
    let features: Int8Array | null = null;
    if (typeof pkt.features === "string" && pkt.features.trim() !== "") {
      try {
        features = base64ToInt8(pkt.features);
      } catch (e) {
        logger.error(`failed to decode post summary features postId=${postId}: ${e}`);
        features = null;
      }
    }
    const tags = Array.isArray(pkt.tags)
      ? pkt.tags.filter((t): t is string => typeof t === "string")
      : [];
    return { postId: pid, updatedAt, summary, features, tags };
  } catch (e) {
    logger.error(`failed to parse post summary postId=${postId}: ${e}`);
    return { postId, updatedAt: "", summary: null, features: null, tags: [] };
  }
}

async function fetchFolloweePosts(sessionCookie: string, userId: string): Promise<Post[]> {
  const params = new URLSearchParams();
  params.set("userId", userId);
  params.set("offset", "0");
  params.set("limit", String(Config.AI_USER_FETCH_POST_LIMIT));
  params.set("includeSelf", "false");
  params.set("includeReplies", "true");
  params.set("limitPerUser", "3");
  const res = await apiRequest(sessionCookie, `/posts/by-followees?${params.toString()}`, {
    method: "GET",
  });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as Post[];
}

async function fetchLatestPosts(sessionCookie: string): Promise<Post[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(Config.AI_USER_FETCH_POST_LIMIT));
  params.set("order", "desc");
  const res = await apiRequest(sessionCookie, `/posts?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as Post[];
}

async function fetchPeerLatestPosts(sessionCookie: string, peerId: string): Promise<PostDetail[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(Math.min(5, Config.AI_USER_READ_PEER_POST_LIMIT)));
  params.set("order", "desc");
  params.set("ownedBy", peerId);
  const res = await apiRequest(sessionCookie, `/posts?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const list = parsed as Post[];
  const ids = list
    .map((p) => p.id)
    .filter((id): id is string => typeof id === "string" && id.trim() !== "")
    .slice(0, Math.min(5, Config.AI_USER_READ_POST_LIMIT));
  const result: PostDetail[] = [];
  for (const id of ids) {
    try {
      const detail = await fetchPostById(sessionCookie, id);
      result.push(detail);
    } catch (e) {
      logger.info(`Failed to fetch peer latest post detail peerId=${peerId} postId=${id}: ${e}`);
    }
  }
  return result;
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

async function fetchPostById(sessionCookie: string, postId: string): Promise<PostDetail> {
  const url = new URL(`/posts/${encodeURIComponent(postId)}`, Config.BACKEND_API_BASE_URL);
  const path = url.pathname + url.search;
  const res = await apiRequest(sessionCookie, path, { method: "GET" });
  return JSON.parse(res.body) as PostDetail;
}

async function fetchOwnRecentPosts(
  sessionCookie: string,
  userId: string,
  limit: number,
): Promise<PostDetail[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(limit));
  params.set("order", "desc");
  params.set("ownedBy", userId);
  const res = await apiRequest(sessionCookie, `/posts?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const list = parsed as Post[];
  const ids = list.map((p) => p.id).slice(0, Config.AI_USER_READ_POST_LIMIT);
  const result: PostDetail[] = [];
  for (const id of ids) {
    try {
      const detail = await fetchPostById(sessionCookie, id);
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
      const posts = await fetchOwnRecentPosts(
        sessionCookie,
        followerId,
        Config.AI_USER_READ_POST_LIMIT,
      );
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

function computeLocaleWeight(userLocale: string, postLocale: string): number {
  const langOf = (s: string): string => {
    const t = s.trim().replaceAll("_", "-").toLowerCase();
    if (!t) return "";
    const i = t.indexOf("-");
    return (i === -1 ? t : t.slice(0, i)).trim();
  };
  const userLang = langOf(userLocale);
  const postLang = langOf(postLocale);
  if (userLang !== "" && userLang === postLang) return 1;
  if (postLang === "en") return 0.5;
  return 0.3;
}

async function fetchPostsToRead(
  sessionCookie: string,
  userId: string,
  userNickname: string,
  userLocale: string,
  interest: AiUserInterest | null,
): Promise<PostToRead[]> {
  const candidates: PostCandidate[] = [];
  const followeePosts = await fetchFolloweePosts(sessionCookie, userId);
  for (const post of followeePosts) {
    if (post.ownedBy === userId) continue;
    let biasWeight = 1.0;
    // should use userId.
    if (post.replyToOwnerNickname && post.replyToOwnerNickname !== userNickname) {
      biasWeight *= 0.5;
    }
    const locale = post.locale || post.ownerLocale;
    const localeWeight = computeLocaleWeight(userLocale, locale);
    candidates.push({ postId: post.id, weight: 1 * biasWeight * localeWeight });
  }
  const latestPosts = await fetchLatestPosts(sessionCookie);
  for (const post of latestPosts) {
    if (post.ownedBy === userId) continue;
    let biasWeight = 1.0;
    if (post.replyToOwnerNickname && post.replyToOwnerNickname !== userNickname) {
      biasWeight *= 0.5;
    }
    const locale = post.locale || post.ownerLocale;
    const localeWeight = computeLocaleWeight(userLocale, locale);
    candidates.push({ postId: post.id, weight: 0.5 * biasWeight * localeWeight });
  }
  const notifications = await fetchNotifications(sessionCookie);
  for (const n of notifications) {
    if (n.slot.startsWith("reply:")) {
      for (const record of n.records) {
        if (!("postId" in record)) continue;
        const r = record as NotificationPostRecord;
        if (typeof r.postId !== "string") continue;
        if (typeof r.userId !== "string") continue;
        if (r.userId === userId) continue;
        candidates.push({ postId: r.postId, weight: 0.8 });
      }
    }
    if (n.slot.startsWith("mention:")) {
      for (const record of n.records) {
        if (!("postId" in record)) continue;
        const r = record as NotificationPostRecord;
        if (typeof r.postId !== "string") continue;
        if (typeof r.userId !== "string") continue;
        if (r.userId === userId) continue;
        candidates.push({ postId: r.postId, weight: 0.6 });
      }
    }
  }
  try {
    const followerPostIds = await fetchFollowerRecentRandomPostIds(sessionCookie, userId);
    for (const postId of followerPostIds) {
      candidates.push({ postId, weight: 0.5 });
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
    scoresByPost.set(postId, Math.random() * weight);
  }
  const rankedByScore = [...scoresByPost.entries()].sort((a, b) => b[1] - a[1]);
  const candPostIds: string[] = [];
  for (const [postId] of rankedByScore) {
    const hasImpression = await checkPostImpression(sessionCookie, userId, postId);
    if (hasImpression) continue;
    candPostIds.push(postId);
    if (candPostIds.length >= Config.AI_USER_COMPARE_POST_LIMIT) break;
  }
  if (candPostIds.length === 0) {
    logger.info("No candidate posts to read (after impression filtering)");
    return [];
  }
  let topPostIds: string[] = [];
  const similarityByPostId = new Map<string, number>();
  if (interest) {
    const coreFeatures = decodeFeatures(interest.features);
    const boostedScoresByPost = new Map<string, number>();
    for (const postId of candPostIds) {
      const baseScore = scoresByPost.get(postId) ?? 0;
      if (baseScore <= 0) continue;
      const postSummary = await fetchPostSummary(sessionCookie, postId);
      if (!postSummary.features) continue;
      const features = decodeFeatures(postSummary.features);
      const sim = cosineSimilarity(coreFeatures, features);
      if (!Number.isFinite(sim)) continue;
      similarityByPostId.set(postId, sim);
      boostedScoresByPost.set(postId, baseScore * (sim + 1));
    }
    topPostIds = [...boostedScoresByPost.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([postId]) => postId);
  } else {
    for (const postId of candPostIds) {
      const hasSummary = await checkPostSummary(sessionCookie, postId);
      if (!hasSummary) continue;
      similarityByPostId.set(postId, 0);
      topPostIds.push(postId);
    }
  }
  const result: PostToRead[] = [];
  const pickedCountByOwner = new Map<string, number>();
  for (const postId of topPostIds) {
    if (result.length >= Config.AI_USER_READ_POST_LIMIT) break;
    try {
      const post = await fetchPostById(sessionCookie, postId);
      const pickedCount = pickedCountByOwner.get(post.ownedBy) ?? 0;
      if (pickedCount >= 2) continue;
      pickedCountByOwner.set(post.ownedBy, pickedCount + 1);
      const similarity = similarityByPostId.get(postId) ?? 0;
      result.push({ post, similarity });
    } catch (e) {
      logger.info(`Failed to fetch post detail for postId=${postId}: ${e}`);
    }
  }
  return result;
}

async function addLikeToPost(
  userSessionCookie: string,
  profile: UserDetail,
  post: PostDetail,
): Promise<void> {
  if (!post.allowLikes) return;
  const path = `/posts/${encodeURIComponent(post.id)}/like`;
  const res = await httpRequest(path, { method: "POST", headers: { Cookie: userSessionCookie } });
  if (res.statusCode >= 200 && res.statusCode < 300) {
    logger.info(`Liked post userId=${profile.id} postId=${post.id}`);
  } else {
    logger.error(`Failed to like post userId=${profile.id} postId=${post.id}: ${res.statusCode}`);
  }
}

async function replyToPost(
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
  post: PostDetail,
): Promise<void> {
  console.log("REPLY", post);
}

async function createPostImpression(
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
  post: PostDetail,
): Promise<void> {
  const locale = (post.locale || post.ownerLocale || profile.locale).replaceAll(/_/g, "-");
  const profileExcerpt = buildProfileExcerpt(profile, interest);
  const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
  const peerImp = await fetchPeerImpression(userSessionCookie, profile.id, post.ownedBy);
  const rawPeerImpression = peerImp ? peerImp.payload : "";
  let peerImpressionText: string = "";
  let peerTags: string[] = [];
  if (rawPeerImpression) {
    const parsedPeer = parsePeerImpressionPayload(rawPeerImpression);
    if (parsedPeer) {
      peerImpressionText = truncateText(parsedPeer.impression, Config.AI_USER_OUTPUT_TEXT_LIMIT);
      peerTags = parsedPeer.tags?.slice(0, 5) ?? [];
    }
  }
  const postSummary = await fetchPostSummary(userSessionCookie, post.id);
  const rawSummary = postSummary.summary ?? "";
  const summaryText = rawSummary ? truncateText(rawSummary, Config.AI_USER_POST_TEXT_LIMIT) : "";
  const postText = truncateText(post.content, Config.AI_USER_POST_TEXT_LIMIT);
  const postExcerpt = {
    locale,
    author: post.ownerNickname,
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
    maxChars = Math.ceil(maxChars * 0.5);
    tagChars = Math.ceil(tagChars * 0.5);
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

async function createPeerImpression(
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
  peer: UserDetail,
): Promise<void> {
  const locale = peer.locale.replaceAll(/_/g, "-");
  const existing = await fetchPeerImpression(userSessionCookie, profile.id, peer.id);
  if (
    existing &&
    isNewerThanDays(existing.updatedAt, Config.AI_USER_SKIP_PEER_IMPRESSION_UPDATE_DAYS)
  ) {
    logger.info(
      `Skip peer impression update userId=${profile.id} peerId=${peer.id} updatedAt=${existing.updatedAt}`,
    );
    return;
  }
  const profileExcerpt = buildProfileExcerpt(profile, interest);
  const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
  const rawPeerImpression = existing ? existing.payload : "";
  let lastImpressionText: string = "";
  if (rawPeerImpression) {
    const parsedPeer = parsePeerImpressionPayload(rawPeerImpression);
    if (parsedPeer) {
      lastImpressionText = truncateText(parsedPeer.impression, Config.AI_USER_OUTPUT_TEXT_LIMIT);
    }
  }
  const introText = truncateText(peer.introduction, Config.AI_USER_INTRO_TEXT_LIMIT);
  const peerPosts = await fetchPeerLatestPosts(userSessionCookie, peer.id);
  const posts: { locale: string; summary: string; impression: string; tags: string[] }[] = [];
  for (const p of peerPosts) {
    const postLocale = p.locale || peer.locale;
    const postSummary = await fetchPostSummary(userSessionCookie, p.id);
    const rawSummary = postSummary.summary ?? "";
    const summaryText = rawSummary ? truncateText(rawSummary, Config.AI_USER_POST_TEXT_LIMIT) : "";
    let postImpressionText: string = "";
    let postTags: string[] = [];
    const path = `/ai-users/${encodeURIComponent(profile.id)}/post-impressions/${encodeURIComponent(
      p.id,
    )}`;
    try {
      const res = await httpRequest(path, {
        method: "GET",
        headers: { Cookie: userSessionCookie },
      });
      if (res.statusCode === 401) throw new UnauthorizedError(`401 from ${path}`);
      if (res.statusCode === 404) {
        postImpressionText = "";
        postTags = [];
      } else if (res.statusCode < 200 || res.statusCode >= 300) {
        logger.error(
          `failed to fetch post impression userId=${profile.id} peerId=${peer.id} postId=${p.id}: ${res.statusCode} ${truncateForLog(
            res.body,
            50,
          )}`,
        );
      } else {
        const parsed = JSON.parse(res.body) as unknown;
        if (isRecord(parsed)) {
          const payload = parsed["payload"];
          if (typeof payload === "string" && payload.trim() !== "") {
            const parsedPayload = parsePeerImpressionPayload(payload);
            if (parsedPayload) {
              postImpressionText = truncateText(
                parsedPayload.impression,
                Config.AI_USER_OUTPUT_TEXT_LIMIT,
              );
              postTags = parsedPayload.tags?.slice(0, Config.AI_TAG_MAX_COUNT) ?? [];
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof UnauthorizedError) throw e;
      logger.info(
        `Failed to fetch post impression userId=${profile.id} peerId=${peer.id} postId=${p.id}: ${e}`,
      );
    }
    posts.push({
      locale: postLocale,
      summary: summaryText,
      impression: postImpressionText,
      tags: postTags,
    });
  }
  const peerExcerpt = {
    userId: peer.id,
    locale: peer.locale,
    nickname: peer.nickname,
    introduction: introText,
    lastImpression: lastImpressionText,
    posts,
  };
  const peerJson = JSON.stringify(peerExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
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
    maxChars = Math.ceil(maxChars * 0.5);
    tagChars = Math.ceil(tagChars * 0.5);
  }
  let localeText = locale;
  if (locale === "en" || locale.startsWith("en-")) localeText = `English (${locale})`;
  if (locale === "ja" || locale.startsWith("ja-")) localeText = `日本語（${locale}）`;
  const commonTpl = readPrompt("common-profile", locale, "en").trim();
  const peerTpl = readPrompt("peer-impression", locale, "en").trim() + "\n";
  let prompt =
    commonTpl.replaceAll("{{PROFILE_JSON}}", profileJson) +
    "\n\n" +
    peerTpl.replaceAll("{{PROFILE_JSON}}", peerJson);
  prompt = prompt
    .replaceAll("{{MAX_CHARS}}", String(maxChars))
    .replaceAll("{{TAG_CHARS}}", String(tagChars))
    .replaceAll("{{TAG_NUM}}", String(Config.AI_TAG_MAX_COUNT))
    .replaceAll("{{LOCALE}}", localeText);
  console.log(prompt);
  const chatReq: ChatRequest = { messages: [{ role: "user", content: prompt }] };
  const chatRes = await apiRequest(userSessionCookie, "/ai-users/chat", {
    method: "POST",
    body: chatReq,
  });
  const chat = parseChatResponse(chatRes.body);
  const content = chat.message.content;
  if (content.trim() === "") {
    throw new Error(`ai-users/chat returned empty content userId=${profile.id} peerId=${peer.id}`);
  }
  console.log(content);
  const parsed = evaluateChatResponseAsJson<unknown>(content);
  if (!isRecord(parsed)) {
    throw new Error(
      `AI output JSON is not an object userId=${profile.id} peerId=${peer.id} content=${truncateForLog(
        content,
        50,
      )}`,
    );
  }
  const impressionRaw = parsed["impression"];
  if (typeof impressionRaw !== "string") {
    throw new Error(
      `AI output JSON missing impression userId=${profile.id} peerId=${peer.id} content=${truncateForLog(
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
    `/ai-users/${encodeURIComponent(profile.id)}/peer-impressions`,
    {
      method: "POST",
      body: { peerId: peer.id, payload },
    },
  );
  logger.info(
    `Saved peer impression userId=${profile.id} peerId=${peer.id} tags=${tags.join(",")}`,
  );
}

async function createInterest(
  adminSessionCookie: string,
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
): Promise<void> {
  if (interest && isNewerThanDays(interest.updatedAt, Config.AI_USER_SKIP_INTEREST_UPDATE_DAYS)) {
    logger.info(`Skip interest update userId=${profile.id} updatedAt=${interest.updatedAt}`);
    return;
  }
  const locale = profile.locale.replaceAll(/_/g, "-");
  const profileExcerpt = buildProfileExcerpt(profile, interest);
  const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
  const peerImps = await fetchOwnPeerImpressions(
    userSessionCookie,
    profile.id,
    Config.AI_USER_READ_INTEREST_LIMIT,
  );
  const users: {
    userId: string;
    locale: string;
    nickname: string;
    introduction: string;
    impression: string;
    tags: string[];
  }[] = [];
  for (const imp of peerImps) {
    try {
      const peer = await fetchUserProfile(userSessionCookie, imp.peerId);
      const introText = truncateText(peer.introduction, Config.AI_USER_IMPRESSION_PEER_TEXT_LIMIT);
      let impressionText = "";
      let tags: string[] = [];
      const parsed = parsePeerImpressionPayload(imp.payload);
      if (parsed) {
        impressionText = truncateText(parsed.impression, Config.AI_USER_OUTPUT_TEXT_LIMIT);
        tags = parsed.tags?.slice(0, Config.AI_TAG_MAX_COUNT) ?? [];
      }
      users.push({
        userId: peer.id,
        locale: peer.locale,
        nickname: peer.nickname,
        introduction: introText,
        impression: impressionText,
        tags,
      });
    } catch (e) {
      if (e instanceof UnauthorizedError) throw e;
      logger.info(
        `Failed to fetch peer profile for interest userId=${profile.id} peerId=${imp.peerId}: ${e}`,
      );
    }
  }
  if (users.length < 1 && !interest) {
    logger.info("no user impressions");
    return;
  }
  const postImps = await fetchOwnPostImpressions(
    userSessionCookie,
    profile.id,
    Config.AI_USER_READ_INTEREST_LIMIT,
  );
  const posts: {
    locale: string;
    authorId: string;
    authorNickname: string;
    content: string;
    summary: string;
    impression: string;
    tags: string[];
  }[] = [];
  for (const imp of postImps) {
    try {
      const post = await fetchPostById(userSessionCookie, imp.postId);
      const postLocale = (post.locale || post.ownerLocale || profile.locale).replaceAll(/_/g, "-");
      const contentText = truncateText(post.content, Config.AI_USER_IMPRESSION_PEER_TEXT_LIMIT);
      const postSummary = await fetchPostSummary(userSessionCookie, post.id);
      const rawSummary = postSummary.summary ?? "";
      const summaryText = rawSummary
        ? truncateText(rawSummary, Config.AI_USER_POST_TEXT_LIMIT)
        : "";
      let impressionText = "";
      let tags: string[] = [];
      const parsed = parsePeerImpressionPayload(imp.payload);
      if (parsed) {
        impressionText = truncateText(parsed.impression, Config.AI_USER_OUTPUT_TEXT_LIMIT);
        tags = parsed.tags?.slice(0, Config.AI_TAG_MAX_COUNT) ?? [];
      }
      posts.push({
        locale: postLocale,
        authorId: post.ownedBy,
        authorNickname: post.ownerNickname,
        content: contentText,
        summary: summaryText,
        impression: impressionText,
        tags,
      });
    } catch (e) {
      if (e instanceof UnauthorizedError) throw e;
      logger.info(
        `Failed to fetch post detail for interest userId=${profile.id} postId=${imp.postId}: ${e}`,
      );
    }
  }
  if (posts.length < 1 && !interest) {
    logger.info("no post impressions");
    return;
  }
  const postsExcerpt = { users, posts };
  const postsJson = JSON.stringify(postsExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
  let maxChars = Config.AI_USER_INTEREST_LENGTH;
  let tagChars = Config.AI_TAG_MAX_LENGTH;
  if (
    locale === "ja" ||
    locale.startsWith("ja-") ||
    locale === "zh" ||
    locale.startsWith("zh-") ||
    locale === "ko" ||
    locale.startsWith("ko-")
  ) {
    maxChars = Math.ceil(maxChars * 0.5);
    tagChars = Math.ceil(tagChars * 0.5);
  }
  let localeText = locale;
  if (locale === "en" || locale.startsWith("en-")) localeText = `English (${locale})`;
  if (locale === "ja" || locale.startsWith("ja-")) localeText = `日本語（${locale}）`;
  const promptTpl =
    readPrompt("common-profile", locale, "en").trim() +
    "\n\n" +
    readPrompt("interest", locale, "en").trim() +
    "\n";
  const prompt = promptTpl
    .replaceAll("{{PROFILE_JSON}}", profileJson)
    .replaceAll("{{POSTS_JSON}}", postsJson)
    .replaceAll("{{MAX_CHARS}}", String(maxChars))
    .replaceAll("{{TAG_CHARS}}", String(tagChars))
    .replaceAll("{{TAG_NUM}}", String(Config.AI_TAG_MAX_COUNT))
    .replaceAll("{{LOCALE}}", localeText);
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
    throw new Error(`ai-users/chat returned empty content userId=${profile.id}`);
  }
  console.log(content);
  const parsed = evaluateChatResponseAsJson<unknown>(content);
  if (!isRecord(parsed)) {
    throw new Error(`AI output JSON is not an object userId=${profile.id}`);
  }
  const interestRaw = parsed["interest"];
  if (typeof interestRaw !== "string") {
    throw new Error(`AI output JSON missing interest userId=${profile.id}`);
  }
  const newInterest = truncateText(interestRaw.trim(), Config.AI_USER_OUTPUT_TEXT_LIMIT);
  const newTags = parseTagsField(parsed["tags"], Config.AI_TAG_MAX_COUNT);
  const lines: string[] = [];
  lines.push(newInterest.trim());
  if (newTags.length > 0) {
    lines.push("");
    lines.push(...newTags);
  }
  const featuresInput = lines.join("\n");
  console.log("--- INTEREST FEAT\n", featuresInput);
  const feat = await generateFeatures(adminSessionCookie, {
    model: Config.AI_SUMMARY_MODEL,
    input: featuresInput,
  });

  console.log(feat);

  const saveRes = await apiRequest(
    adminSessionCookie,
    `/ai-users/${encodeURIComponent(profile.id)}/interests`,
    {
      method: "POST",
      body: {
        interest: newInterest,
        tags: newTags,
        features: feat,
      },
    },
  );
  const saved = JSON.parse(saveRes.body) as unknown;
  if (isRecord(saved)) {
    const updatedAt = typeof saved["updatedAt"] === "string" ? saved["updatedAt"] : "";
    logger.info(
      `Saved interest userId=${profile.id} updatedAt=${updatedAt} tags=${newTags.join(",")}`,
    );
  } else {
    logger.info(`Saved interest userId=${profile.id} tags=${newTags.join(",")}`);
  }
}

async function createNewPost(
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
): Promise<void> {
  const locale = profile.locale.replaceAll(/_/g, "-");
  const profileExcerpt = buildProfileExcerpt(profile, interest);
  const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
  const ownPosts = await fetchOwnRecentPosts(
    userSessionCookie,
    profile.id,
    Config.AI_USER_READ_POST_LIMIT,
  );
  const seedPosts = ownPosts.slice(0, Math.min(5, Config.AI_USER_READ_POST_LIMIT));
  if (seedPosts.length > 0) {
    const lastPost = seedPosts[0];
    if (isNewerThanDays(lastPost.createdAt, Config.AI_USER_SKIP_NEW_POST_DAYS)) {
      logger.info(`Skip new post userId=${profile.id} updatedAt=${lastPost.createdAt}`);
      return;
    }
  }
  const posts: {
    locale: string;
    createdAt: string;
    content: string;
    tags: string[];
    summary: string;
  }[] = [];
  for (const p of seedPosts) {
    const postLocale = (p.locale || p.ownerLocale || profile.locale).replaceAll(/_/g, "-");
    const contentText = truncateText(p.content ?? "", Config.AI_USER_POST_TEXT_LIMIT);
    const postSummary = await fetchPostSummary(userSessionCookie, p.id);
    const summaryText =
      typeof postSummary.summary === "string"
        ? truncateText(postSummary.summary, Config.AI_USER_READ_NEW_POST_LIMIT)
        : "";
    const tags = parseTagsField(postSummary.tags, Config.AI_TAG_MAX_COUNT);
    posts.push({
      locale: postLocale,
      createdAt: p.createdAt,
      content: contentText,
      tags,
      summary: summaryText,
    });
  }
  const postExcerpt = { posts };
  const postJson = JSON.stringify(postExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
  let maxChars = Config.AI_USER_NEW_POST_LENGTH;
  let tagChars = Config.AI_TAG_MAX_LENGTH;
  if (
    locale === "ja" ||
    locale.startsWith("ja-") ||
    locale === "zh" ||
    locale.startsWith("zh-") ||
    locale === "ko" ||
    locale.startsWith("ko-")
  ) {
    maxChars = Math.ceil(maxChars * 0.5);
    tagChars = Math.ceil(tagChars * 0.5);
  }
  let localeText = locale;
  if (locale === "en" || locale.startsWith("en-")) localeText = `English (${locale})`;
  if (locale === "ja" || locale.startsWith("ja-")) localeText = `日本語（${locale}）`;
  const promptTpl =
    readPrompt("common-profile", locale, "en").trim() +
    "\n\n" +
    readPrompt("new-post", locale, "en").trim() +
    "\n";
  const prompt = promptTpl
    .replaceAll("{{PROFILE_JSON}}", profileJson)
    .replaceAll("{{POST_JSON}}", postJson)
    .replaceAll("{{MAX_CHARS}}", String(maxChars))
    .replaceAll("{{TAG_CHARS}}", String(tagChars))
    .replaceAll("{{TAG_NUM}}", String(Config.AI_USER_NEW_POST_TAGS))
    .replaceAll("{{LOCALE}}", localeText);

  console.log(prompt);

  const chatReq: ChatRequest = { messages: [{ role: "user", content: prompt }] };
  const chatRes = await apiRequest(userSessionCookie, "/ai-users/chat", {
    method: "POST",
    body: chatReq,
  });
  const chat = parseChatResponse(chatRes.body);
  const raw = chat.message.content;
  if (raw.trim() === "") {
    throw new Error(`ai-users/chat returned empty content userId=${profile.id}`);
  }

  console.log(raw);

  const parsed = evaluateChatResponseAsJson<unknown>(raw);
  if (!isRecord(parsed)) {
    throw new Error(
      `AI output JSON is not an object userId=${profile.id} content=${truncateForLog(raw, 50)}`,
    );
  }
  const contentRaw = parsed["content"];
  if (typeof contentRaw !== "string") {
    throw new Error(
      `AI output JSON missing content userId=${profile.id} content=${truncateForLog(raw, 50)}`,
    );
  }
  const content = truncateText(contentRaw, Config.AI_USER_OUTPUT_TEXT_LIMIT);
  const tags = parseTagsField(parsed["tags"], Config.AI_TAG_MAX_COUNT);
  const saveRes = await apiRequest(userSessionCookie, "/posts", {
    method: "POST",
    body: { content, tags },
  });
  try {
    const saved = JSON.parse(saveRes.body) as unknown;
    if (isRecord(saved) && typeof saved["id"] === "string") {
      logger.info(
        `Created new post userId=${profile.id} postId=${saved["id"]} tags=${tags.join(",")}`,
      );
    } else {
      logger.info(`Created new post userId=${profile.id} tags=${tags.join(",")}`);
    }
  } catch {
    logger.info(`Created new post userId=${profile.id} tags=${tags.join(",")}`);
  }
}

async function processUser(adminSessionCookie: string, user: AiUser): Promise<void> {
  logger.info(`Processing AI user: id=${user.id}, nickname=${user.nickname}`);
  const userSessionCookie = await switchToUser(adminSessionCookie, user.id);
  const profile = await fetchUserProfile(userSessionCookie, user.id);
  const interest = await fetchUserInterest(userSessionCookie, user.id);
  const posts = await fetchPostsToRead(userSessionCookie, user.id, user.nickname, profile.locale, interest);
  logger.info(`postsToRead userId=${user.id} count=${posts.length}`);
  const peerIdSet = new Set<string>();
  const topPeerPosts = new Map<string, PostDetail>();
  for (const item of posts) {
    const post = item.post;
    if (post.ownedBy === user.id) continue;
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
  if (interest) {
    const sortedItems = posts.sort((a, b) => b.similarity - a.similarity);
    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      const post = item.post;
      if (i < Config.AI_USER_LIKE_LIMIT && item.similarity >= Config.AI_USER_LIKE_MIN_SIMILARITY) {
        try {
          await addLikeToPost(userSessionCookie, profile, post);
        } catch (e) {
          if (e instanceof UnauthorizedError) throw e;
          logger.error(`error liking userId=${user.id} postId={post.id}: ${e}`);
        }
      }
      if (i < Config.AI_USER_REPLY_LIMIT && item.similarity >= Config.AI_USER_REPLY_MIN_SIMILARITY) {
        try {
          await replyToPost(userSessionCookie, profile, interest, post);
        } catch (e) {
          if (e instanceof UnauthorizedError) throw e;
          logger.error(`error replying userId=${user.id}: postId={post.id}: ${e}`);
        }
      }
    }
  }

  // debug only
  return;

  const peerIds = Array.from(peerIdSet);
  logger.info(`Selected peer IDs to read: ${peerIds.join(",")}`);
  for (const peerId of peerIds) {
    try {
      const peer = await fetchUserProfile(userSessionCookie, peerId);
      await createPeerImpression(userSessionCookie, profile, interest, peer);
    } catch (e) {
      if (e instanceof UnauthorizedError) throw e;
      logger.error(`error creating peer impression userId=${user.id} peerId=${peerId}: ${e}`);
    }
  }
  await createInterest(adminSessionCookie, userSessionCookie, profile, interest);
  const newInterest = (await fetchUserInterest(userSessionCookie, user.id)) ?? interest;
  await createNewPost(userSessionCookie, profile, newInterest);
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
    await sleep(Config.AI_SUMMARY_FAMILY_SLEEP_MS);
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
