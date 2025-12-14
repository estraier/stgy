// このコードの中では絶対にanyを使わない。このコメントは消さない。
// AIはコード内にコメントを書かない。人間は書いても良い。

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
import type { AiUserInterest, AiPostImpression } from "./models/aiUser";
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

class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTrimmedStringProp(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
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

async function loginAsAdmin(): Promise<string> {
  if (!authService) throw new Error("authService is not initialized");
  const res = await authService.loginAsAdmin();
  const sessionCookie = `session_id=${res.sessionId}`;
  return sessionCookie;
}

async function fetchNextUsers(
  sessionCookie: string,
  offset: number,
  limit: number,
): Promise<UserLite[]> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  const res = await apiRequest(sessionCookie, `/ai-users?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const out: UserLite[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const id = getTrimmedStringProp(item, "id");
    if (!id) continue;
    out.push(item as unknown as UserLite);
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
  const id = getTrimmedStringProp(parsed, "id");
  if (!id) {
    throw new Error(`user profile missing id: ${truncateForLog(res.body, 50)}`);
  }
  return parsed as unknown as UserDetail;
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
  return parsed as unknown as Post[];
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
  return parsed as unknown as Post[];
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
  return parsed as unknown as Notification[];
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
      `401 from /ai-users/${encodeURIComponent(aiUserId)}/post-impressions/${encodeURIComponent(postId)}`,
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

  const list = parsed as unknown as Post[];
  const ids = list
    .map((p) => {
      const id = (p as unknown as { id?: unknown }).id;
      return typeof id === "string" ? id.trim() : "";
    })
    .filter(Boolean)
    .slice(0, Config.AI_USER_READ_POST_LIMIT);

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

  const followers = parsed as unknown as UserLite[];
  if (followers.length === 0) return [];

  const shuffledFollowerIds = followers
    .map((f) => ({ id: String((f as unknown as { id?: unknown }).id ?? "").trim(), score: Math.random() }))
    .filter((x) => x.id !== "")
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((x) => x.id);

  const postIds: string[] = [];
  for (const followerId of shuffledFollowerIds) {
    try {
      const posts = await fetchOwnRecentPosts(sessionCookie, followerId);
      for (const post of posts.slice(0, 3)) {
        const id = (post as unknown as { id?: unknown }).id;
        if (typeof id === "string" && id.trim() !== "") {
          postIds.push(id);
        }
      }
    } catch (e) {
      logger.info(`Failed to fetch recent posts followerId=${followerId} of userId=${userId}: ${e}`);
    }
  }

  return postIds;
}

async function fetchPostsToRead(sessionCookie: string, userId: string): Promise<PostDetail[]> {
  const candidates: PostCandidate[] = [];

  const followeePosts = await fetchFolloweePosts(sessionCookie, userId);
  for (const post of followeePosts) {
    const ownedBy = (post as unknown as { ownedBy?: unknown }).ownedBy;
    if (ownedBy === userId) continue;

    const postId = (post as unknown as { id?: unknown }).id;
    if (typeof postId !== "string" || postId.trim() === "") continue;

    const hasImpression = await checkPostImpression(sessionCookie, userId, postId);
    if (!hasImpression) {
      candidates.push({ postId, weight: 1 });
    }
  }

  const latestPosts = await fetchLatestPosts(sessionCookie, userId);
  for (const post of latestPosts) {
    const ownedBy = (post as unknown as { ownedBy?: unknown }).ownedBy;
    if (ownedBy === userId) continue;

    const postId = (post as unknown as { id?: unknown }).id;
    if (typeof postId !== "string" || postId.trim() === "") continue;

    const hasImpression = await checkPostImpression(sessionCookie, userId, postId);
    if (!hasImpression) {
      candidates.push({ postId, weight: 1 });
    }
  }

  const notifications = await fetchNotifications(sessionCookie);
  for (const n of notifications) {
    const slotRaw = (n as unknown as { slot?: unknown }).slot;
    const recordsRaw = (n as unknown as { records?: unknown }).records;
    if (typeof slotRaw !== "string" || !Array.isArray(recordsRaw)) continue;

    const slot = slotRaw;
    const records: unknown[] = recordsRaw;

    if (slot.startsWith("reply:")) {
      for (const record of records) {
        if (!isRecord(record)) continue;
        const postId = getTrimmedStringProp(record, "postId");
        const recordUserId = getTrimmedStringProp(record, "userId");
        if (!postId) continue;
        if (!recordUserId || recordUserId === userId) continue;

        const hasImpression = await checkPostImpression(sessionCookie, userId, postId);
        if (!hasImpression) {
          candidates.push({ postId, weight: 0.5 });
        }
      }
    }

    if (slot.startsWith("mention:")) {
      for (const record of records) {
        if (!isRecord(record)) continue;
        const postId = getTrimmedStringProp(record, "postId");
        const recordUserId = getTrimmedStringProp(record, "userId");
        if (!postId) continue;
        if (!recordUserId || recordUserId === userId) continue;

        const hasImpression = await checkPostImpression(sessionCookie, userId, postId);
        if (!hasImpression) {
          candidates.push({ postId, weight: 0.3 });
        }
      }
    }
  }

  try {
    const followerPostIds = await fetchFollowerRecentRandomPostIds(sessionCookie, userId);
    for (const postId of followerPostIds) {
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
  const locale = (post.locale || post.ownerLocale || "en").replace(/_/g, "-");
  console.log(post);


  const promptTpl = readPrompt("post-impression", locale, "en");
  const postText = truncateText(post.content, Config.AI_USER_POST_TEXT_LIMIT);

  console.log(promptTpl);

  console.log(postText);




}

async function processUser(sessionCookie: string, user: UserLite): Promise<void> {
  logger.info(`Processing AI user: id=${user.id}`);

  const profile = await fetchUserProfile(sessionCookie, user.id);
  const interest: AiUserInterest | null = null;

  const posts = await fetchPostsToRead(sessionCookie, user.id);
  logger.info(`postsToRead userId=${user.id} count=${posts.length}`);

  const peerIdSet = new Set<string>();
  const topPeerPosts = new Map<string, PostDetail>();

  for (const post of posts) {
    await createPostImpression(sessionCookie, profile, interest, post);

    const ownedBy = (post as unknown as { ownedBy?: unknown }).ownedBy;
    if (typeof ownedBy === "string" && ownedBy.trim() !== "") {
      peerIdSet.add(ownedBy);
      if (topPeerPosts.size < 5 && !topPeerPosts.has(ownedBy)) {
        topPeerPosts.set(ownedBy, post);
      }
    }
  }

  const peerIds = Array.from(peerIdSet);
  logger.info(`Selected peer IDs to read: ${peerIds.join(",")}`);
  void topPeerPosts;
}

async function processLoop(): Promise<void> {
  while (!shuttingDown) {
    let sessionCookie: string;
    try {
      sessionCookie = await loginAsAdmin();
    } catch (e) {
      logger.error(`loginAsAdmin error: ${e}`);
      await sleep(Config.AI_USER_IDLE_SLEEP_MS);
      continue;
    }

    let needRelogin = false;
    let offset = 0;

    while (!shuttingDown) {
      let users: UserLite[] = [];
      try {
        users = await fetchNextUsers(sessionCookie, offset, Config.AI_USER_BATCH_SIZE);
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
            await processUser(sessionCookie, user);
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
