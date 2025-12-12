import fs from "fs";
import path from "path";
import { createLogger } from "./utils/logger";
import type { AiUserInterest, AiPostImpression } from "./models/aiUser";
import type { UserLite, UserDetail } from "./models/user";
import type { Post, PostDetail } from "./models/post";
import type { Notification } from "./models/notification";
import {
  loadConfig as loadFileConfig,
  getFileConfigStr,
  getFileConfigNum,
  type FileConfig,
} from "./utils/fileConfig";

type PostCandidate = {
  postId: string;
  weight: number;
};

type ChatResponse = {
  message?: {
    content?: string;
  };
};

const logger = createLogger({ file: "aiUserWorker" });

const DEFAULT_CONFIG_FILENAME = "ai-user-config.json";
const LOG_TEXT_LIMIT = 100;
const OWN_POST_CONTEXT_LIMIT = 3;

function truncateForLog(value: unknown, max = LOG_TEXT_LIMIT): string {
  const s = String(value);
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function evaluateChatResponseAsJson<T = unknown>(raw: string): T {
  let s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    s = fenced[1].trim();
  }
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

function getConfigPath(): string {
  const argPath = process.argv[2];
  if (argPath && argPath.trim() !== "") {
    return path.resolve(argPath);
  }
  return path.resolve(__dirname, DEFAULT_CONFIG_FILENAME);
}

function readPromptFile(prefix: string, locale: string): string {
  const normalizedLocale = locale.replace(/_/g, "-");
  const parts = normalizedLocale.split("-");
  const candidates: string[] = [];
  if (normalizedLocale) {
    candidates.push(`${prefix}-${normalizedLocale}.txt`);
  }
  if (parts[0]) {
    candidates.push(`${prefix}-${parts[0]}.txt`);
  }
  candidates.push(`${prefix}.txt`);
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
  }
  throw new Error(`prompt file not found for prefix=${prefix} locale=${locale}`);
}

const configPath = getConfigPath();
const fileConfig: FileConfig = loadFileConfig(configPath);
const CONFIG_DIR = path.dirname(configPath);
const BACKEND_API_BASE_URL =
  process.env.STGY_BACKEND_API_BASE_URL ?? getFileConfigStr(fileConfig, "backendApiBaseUrl");
const ADMIN_EMAIL = process.env.STGY_ADMIN_EMAIL ?? getFileConfigStr(fileConfig, "adminEmail");
const ADMIN_PASSWORD =
  process.env.STGY_ADMIN_PASSWORD ?? getFileConfigStr(fileConfig, "adminPassword");
const INFINITE_LOOP = (() => {
  const cfg = fileConfig as { infiniteLoop?: unknown };
  if (typeof cfg.infiniteLoop === "boolean") {
    return cfg.infiniteLoop;
  }
  return false;
})();
const LOOP_INTERVAL = getFileConfigNum(fileConfig, "loopInterval");
const CONCURRENCY = Math.max(1, Math.floor(getFileConfigNum(fileConfig, "concurrency")));
const USER_PAGE_SIZE = getFileConfigNum(fileConfig, "userPageSize");
const USER_LIMIT = getFileConfigNum(fileConfig, "userLimit");
const FETCH_POST_LIMIT = getFileConfigNum(fileConfig, "fetchPostLimit");
const READ_POST_LIMIT = getFileConfigNum(fileConfig, "readPostLimit");
const PROFILE_CHAR_LIMIT = getFileConfigNum(fileConfig, "profileCharLimit");
const POST_CHAR_LIMIT = getFileConfigNum(fileConfig, "postCharLimit");
const OUTPUT_CHAR_LIMIT = getFileConfigNum(fileConfig, "outputCharLimit");
const READ_IMPRESSION_LIMIT = getFileConfigNum(fileConfig, "readImpressionLimit");
const PUBLISH_NEW_POSTS = (() => {
  const cfg = fileConfig as { publishNewPosts?: unknown };
  if (typeof cfg.publishNewPosts === "boolean") {
    return cfg.publishNewPosts;
  }
  return false;
})();
const COMMON_PROFILE_PROMPT_PREFIX = (() => {
  const rel = getFileConfigStr(fileConfig, "commonProfilePromptFile");
  return path.isAbsolute(rel) ? rel : path.resolve(CONFIG_DIR, rel);
})();
const POST_IMPRESSION_PROMPT_PREFIX = (() => {
  const rel = getFileConfigStr(fileConfig, "postImpressionPromptFile");
  return path.isAbsolute(rel) ? rel : path.resolve(CONFIG_DIR, rel);
})();
const PEER_IMPRESSION_PROMPT_PREFIX = (() => {
  const rel = getFileConfigStr(fileConfig, "peerImpressionPromptFile");
  return path.isAbsolute(rel) ? rel : path.resolve(CONFIG_DIR, rel);
})();
const INTEREST_PROMPT_PREFIX = (() => {
  const rel = getFileConfigStr(fileConfig, "interestPromptFile");
  return path.isAbsolute(rel) ? rel : path.resolve(CONFIG_DIR, rel);
})();
const NEW_POST_PROMPT_PREFIX = (() => {
  const rel = getFileConfigStr(fileConfig, "newPostPromptFile");
  return path.isAbsolute(rel) ? rel : path.resolve(CONFIG_DIR, rel);
})();

type InterestPayloadJson = {
  interest: string;
  tags?: string[];
};

type PeerImpressionPayloadJson = {
  impression: string;
  tags?: string[];
};

function parseTagsField(raw: unknown, maxCount: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
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

function parseInterestPayload(payload: string): InterestPayloadJson | null {
  try {
    const obj = JSON.parse(payload) as {
      interest?: unknown;
      tags?: unknown;
    };
    if (typeof obj.interest !== "string") {
      return null;
    }
    const tags = parseTagsField(obj.tags, 5);
    return { interest: obj.interest, tags };
  } catch {
    return null;
  }
}

function parsePeerImpressionPayload(payload: string): PeerImpressionPayloadJson | null {
  try {
    const obj = JSON.parse(payload) as {
      impression?: unknown;
      tags?: unknown;
    };
    if (typeof obj.impression !== "string") {
      return null;
    }
    const tags = parseTagsField(obj.tags, 5);
    return { impression: obj.impression, tags };
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
    const parsed = parseInterestPayload(interest.payload);
    if (parsed) {
      currentInterest = parsed.interest.slice(0, PROFILE_CHAR_LIMIT);
      if (parsed.tags) {
        for (const t of parsed.tags) {
          if (t.length > 0) {
            currentInterestTags.push(t);
            if (currentInterestTags.length >= 5) break;
          }
        }
      }
    } else {
      currentInterest = interest.payload.slice(0, PROFILE_CHAR_LIMIT);
    }
  }

  return {
    userId: profile.id,
    nickname: profile.nickname,
    locale: profile.locale,
    introduction: profile.introduction.slice(0, PROFILE_CHAR_LIMIT),
    aiPersonality: profile.aiPersonality ? profile.aiPersonality.slice(0, PROFILE_CHAR_LIMIT) : "",
    currentInterest,
    currentInterestTags,
  };
}

async function loginAsAdmin(): Promise<string> {
  const resp = await fetch(`${BACKEND_API_BASE_URL}/auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to login as admin: ${resp.status} ${bodySnippet}`);
  }
  const setCookie = resp.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("no set-cookie header in login response");
  }
  const match = setCookie.match(/session_id=[^;]+/);
  if (!match) {
    throw new Error("session_id cookie not found in login response");
  }
  return match[0];
}

async function fetchNextUsers(
  sessionCookie: string,
  offset: number,
  limit: number,
): Promise<UserLite[]> {
  const resp = await fetch(`${BACKEND_API_BASE_URL}/ai-users?offset=${offset}&limit=${limit}`, {
    method: "GET",
    headers: {
      Cookie: sessionCookie,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to fetch ai users: ${resp.status} ${bodySnippet}`);
  }
  const users = (await resp.json()) as UserLite[];
  return users;
}

async function switchToUser(adminSessionCookie: string, userId: string): Promise<string> {
  const resp = await fetch(`${BACKEND_API_BASE_URL}/auth/switch-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminSessionCookie,
    },
    body: JSON.stringify({ id: userId }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to switch user: ${resp.status} ${bodySnippet}`);
  }
  const setCookie = resp.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("no set-cookie header in switch-user response");
  }
  const match = setCookie.match(/session_id=[^;]+/);
  if (!match) {
    throw new Error("session_id cookie not found in switch-user response");
  }
  return match[0];
}

async function fetchUserProfile(sessionCookie: string, userId: string): Promise<UserDetail> {
  const resp = await fetch(`${BACKEND_API_BASE_URL}/users/${encodeURIComponent(userId)}`, {
    method: "GET",
    headers: {
      Cookie: sessionCookie,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to fetch user profile: ${resp.status} ${bodySnippet}`);
  }
  const profile = (await resp.json()) as UserDetail;
  return profile;
}

async function fetchUserInterest(
  sessionCookie: string,
  userId: string,
): Promise<AiUserInterest | null> {
  const resp = await fetch(
    `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(userId)}/interests`,
    {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
      },
    },
  );
  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to fetch user interest: ${resp.status} ${bodySnippet}`);
  }
  const interest = (await resp.json()) as AiUserInterest;
  return interest;
}

async function fetchPeerImpression(
  userSessionCookie: string,
  aiUserId: string,
  peerId: string,
): Promise<string> {
  let lastImpression = "";
  try {
    const resp = await fetch(
      `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(
        aiUserId,
      )}/peer-impressions/${encodeURIComponent(peerId)}`,
      {
        method: "GET",
        headers: {
          Cookie: userSessionCookie,
        },
      },
    );
    if (resp.status === 404) {
      return "";
    }
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to fetch peer impression for aiUserId=${aiUserId}, peerId=${peerId}: ${resp.status} ${bodySnippet}`,
      );
      return "";
    }
    const data = (await resp.json()) as { payload?: unknown };
    if (typeof data.payload === "string") {
      lastImpression = data.payload;
    }
  } catch (e) {
    logger.error(
      `Error while fetching last peer impression for aiUserId=${aiUserId}, peerId=${peerId}: ${e}`,
    );
  }
  return lastImpression;
}

async function fetchFolloweePosts(sessionCookie: string, userId: string): Promise<Post[]> {
  const params = new URLSearchParams();
  params.set("userId", userId);
  params.set("offset", "0");
  params.set("limit", String(FETCH_POST_LIMIT));
  params.set("includeSelf", "false");
  params.set("includeReplies", "true");
  params.set("focusUserId", userId);
  params.set("limitPerUser", "3");
  const resp = await fetch(`${BACKEND_API_BASE_URL}/posts/by-followees?${params.toString()}`, {
    method: "GET",
    headers: {
      Cookie: sessionCookie,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to fetch posts by followees: ${resp.status} ${bodySnippet}`);
  }
  const posts = (await resp.json()) as Post[];
  return posts;
}

async function fetchLatestPosts(sessionCookie: string, userId: string): Promise<Post[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(FETCH_POST_LIMIT));
  params.set("order", "desc");
  params.set("focusUserId", userId);
  const resp = await fetch(`${BACKEND_API_BASE_URL}/posts?${params.toString()}`, {
    method: "GET",
    headers: {
      Cookie: sessionCookie,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to fetch latest posts: ${resp.status} ${bodySnippet}`);
  }
  const posts = (await resp.json()) as Post[];
  return posts;
}

async function fetchNotifications(sessionCookie: string): Promise<Notification[]> {
  const resp = await fetch(`${BACKEND_API_BASE_URL}/notifications/feed`, {
    method: "GET",
    headers: {
      Cookie: sessionCookie,
    },
  });
  if (resp.status === 304) {
    return [];
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to fetch notifications: ${resp.status} ${bodySnippet}`);
  }
  const notifications = (await resp.json()) as Notification[];
  return notifications;
}

async function checkPostImpression(
  sessionCookie: string,
  aiUserId: string,
  postId: string,
): Promise<boolean> {
  const resp = await fetch(
    `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(
      aiUserId,
    )}/post-impressions/${encodeURIComponent(postId)}`,
    {
      method: "HEAD",
      headers: {
        Cookie: sessionCookie,
      },
    },
  );
  if (resp.status === 200) {
    return true;
  }
  if (resp.status === 404) {
    return false;
  }
  const body = await resp.text().catch(() => "");
  const bodySnippet = truncateForLog(body);
  throw new Error(`failed to check post impression: ${resp.status} ${bodySnippet}`);
}

async function fetchPostById(
  sessionCookie: string,
  postId: string,
  focusUserId: string,
): Promise<PostDetail> {
  const url = new URL(`${BACKEND_API_BASE_URL}/posts/${encodeURIComponent(postId)}`);
  url.searchParams.set("focusUserId", focusUserId);
  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Cookie: sessionCookie,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to fetch post detail: ${resp.status} ${bodySnippet}`);
  }
  const post = (await resp.json()) as PostDetail;
  return post;
}

async function fetchOwnRecentPosts(sessionCookie: string, userId: string): Promise<PostDetail[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", String(READ_POST_LIMIT));
  params.set("order", "desc");
  params.set("ownedBy", userId);
  params.set("focusUserId", userId);
  const resp = await fetch(`${BACKEND_API_BASE_URL}/posts?${params.toString()}`, {
    method: "GET",
    headers: {
      Cookie: sessionCookie,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(`failed to fetch own posts: ${resp.status} ${bodySnippet}`);
  }
  const list = (await resp.json()) as Post[];
  const ids = list.map((p) => p.id).slice(0, READ_POST_LIMIT);
  const result: PostDetail[] = [];
  for (const postId of ids) {
    try {
      const detail = await fetchPostById(sessionCookie, postId, userId);
      result.push(detail);
    } catch (e) {
      logger.info(`Failed to fetch own post detail for aiUserId=${userId}, postId=${postId}: ${e}`);
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
  params.set("limit", "100");
  params.set("order", "desc");
  const resp = await fetch(
    `${BACKEND_API_BASE_URL}/users/${encodeURIComponent(userId)}/followers?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
      },
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const bodySnippet = truncateForLog(body);
    throw new Error(
      `failed to fetch followers for aiUserId=${userId}: ${resp.status} ${bodySnippet}`,
    );
  }
  const followers = (await resp.json()) as UserLite[];
  if (followers.length === 0) {
    return [];
  }
  const shuffledFollowerIds = followers
    .map((f) => ({ id: f.id, score: Math.random() }))
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
        `Failed to fetch recent posts for followerId=${followerId} of aiUserId=${userId}: ${e}`,
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
    const hasImpression = await checkPostImpression(sessionCookie, userId, post.id);
    if (!hasImpression) {
      candidates.push({ postId: post.id, weight: 1 });
    }
  }
  const latestPosts = await fetchLatestPosts(sessionCookie, userId);
  for (const post of latestPosts) {
    if (post.ownedBy === userId) continue;
    const hasImpression = await checkPostImpression(sessionCookie, userId, post.id);
    if (!hasImpression) {
      candidates.push({ postId: post.id, weight: 1 });
    }
  }
  const notifications = await fetchNotifications(sessionCookie);
  for (const n of notifications) {
    if (n.slot.startsWith("reply:")) {
      for (const record of n.records) {
        if (!("postId" in record) || typeof record.postId !== "string") continue;
        if (!("userId" in record) || record.userId === userId) continue;
        const hasImpression = await checkPostImpression(sessionCookie, userId, record.postId);
        if (!hasImpression) {
          candidates.push({ postId: record.postId, weight: 0.5 });
        }
      }
    }
    if (n.slot.startsWith("mention:")) {
      for (const record of n.records) {
        if (!("postId" in record) || typeof record.postId !== "string") continue;
        if (!("userId" in record) || record.userId === userId) continue;
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
      const hasImpression = await checkPostImpression(sessionCookie, userId, postId);
      if (!hasImpression) {
        candidates.push({ postId, weight: 0.3 });
      }
    }
  } catch (e) {
    logger.error(
      `Error while fetching follower recent random post ids for aiUserId=${userId}: ${e}`,
    );
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
    .slice(0, READ_POST_LIMIT)
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
  prompt: string,
  post: PostDetail,
): Promise<void> {
  try {
    const profileExcerpt = buildProfileExcerpt(profile, interest);
    const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");

    const rawPeerImpression = await fetchPeerImpression(
      userSessionCookie,
      profile.id,
      post.ownedBy,
    );
    let peerImpressionText = rawPeerImpression;
    let peerTags: string[] = [];
    if (rawPeerImpression) {
      const parsedPeer = parsePeerImpressionPayload(rawPeerImpression);
      if (parsedPeer) {
        peerImpressionText = parsedPeer.impression.slice(0, OUTPUT_CHAR_LIMIT);
        if (parsedPeer.tags) {
          peerTags = parsedPeer.tags.slice(0, 5);
        }
      }
    }
    const postExcerpt = {
      author: post.ownerNickname,
      locale: post.locale,
      createdAt: post.createdAt,
      content: post.content.slice(0, POST_CHAR_LIMIT),
      peerImpression: peerImpressionText,
      peerTags: peerTags,
    };
    const postJson = JSON.stringify(postExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
    const modifiedPrompt = prompt
      .replace("{{PROFILE_JSON}}", profileJson)
      .replace("{{POST_JSON}}", postJson);

    console.log(modifiedPrompt);

    const chatBody = {
      messages: [
        {
          role: "user" as const,
          content: modifiedPrompt,
        },
      ],
    };
    const chatResp = await fetch(`${BACKEND_API_BASE_URL}/ai-users/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userSessionCookie,
      },
      body: JSON.stringify(chatBody),
    });

    if (chatResp.status === 501) {
      const bodyText = await chatResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `AI features are disabled when calling ai-users/chat for aiUserId=${profile.id}, postId=${post.id}: ${bodySnippet}`,
      );
      return;
    }
    if (!chatResp.ok) {
      const bodyText = await chatResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to call ai-users/chat for aiUserId=${profile.id}, postId=${post.id}: ${chatResp.status} ${bodySnippet}`,
      );
      return;
    }

    const chatJson = (await chatResp.json()) as ChatResponse;
    console.log(chatJson);
    const content = chatJson.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      logger.error(
        `ai-users/chat returned empty content for aiUserId=${profile.id}, postId=${post.id}`,
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = evaluateChatResponseAsJson(content);
    } catch (e) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `failed to parse AI output as JSON for aiUserId=${profile.id}, postId=${post.id}: ${e} content=${contentSnippet}`,
      );
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON is not an object for aiUserId=${profile.id}, postId=${post.id}: ${contentSnippet}`,
      );
      return;
    }

    const obj = parsed as {
      summary?: unknown;
      impression?: unknown;
      tags?: unknown;
    };

    if (typeof obj.summary !== "string" || typeof obj.impression !== "string") {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON missing summary/impression string fields for aiUserId=${profile.id}, postId=${post.id}: ${contentSnippet}`,
      );
      return;
    }

    const tags = parseTagsField(obj.tags, 5);

    const trimmed = {
      summary: obj.summary.trim().slice(0, OUTPUT_CHAR_LIMIT),
      impression: obj.impression.trim().slice(0, OUTPUT_CHAR_LIMIT),
      tags,
    };

    const payload = JSON.stringify(trimmed);
    const payloadSnippet = truncateForLog(payload);
    const saveResp = await fetch(
      `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(profile.id)}/post-impressions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: userSessionCookie,
        },
        body: JSON.stringify({
          postId: post.id,
          payload,
        }),
      },
    );
    if (!saveResp.ok) {
      const bodyText = await saveResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to save post impression for aiUserId=${profile.id}, postId=${post.id}: ${saveResp.status} ${bodySnippet}`,
      );
      return;
    }
    logger.info(
      `Saved post impression for aiUserId=${profile.id}, postId=${post.id}: ${payloadSnippet}`,
    );
  } catch (e) {
    logger.error(
      `Error in createPostImpression for aiUserId=${profile.id}, postId=${post.id}: ${e}`,
    );
  }
}

async function createPeerImpression(
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
  prompt: string,
  peerId: string,
): Promise<void> {
  try {
    const profileExcerpt = buildProfileExcerpt(profile, interest);
    const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
    const peerProfile = await fetchUserProfile(userSessionCookie, peerId);
    const peerIntro = peerProfile.introduction.slice(0, PROFILE_CHAR_LIMIT);
    const lastImpressionRaw = await fetchPeerImpression(userSessionCookie, profile.id, peerId);

    let lastImpression = lastImpressionRaw;
    if (lastImpressionRaw) {
      const parsedLast = parsePeerImpressionPayload(lastImpressionRaw);
      if (parsedLast) {
        lastImpression = parsedLast.impression.slice(0, OUTPUT_CHAR_LIMIT);
      }
    }

    const peerPosts: {
      postId: string;
      summary: string;
      impression: string;
      tags: string[];
    }[] = [];

    try {
      const params = new URLSearchParams();
      params.set("peerId", peerId);
      params.set("limit", String(READ_IMPRESSION_LIMIT));
      params.set("offset", "0");
      params.set("order", "desc");
      const resp = await fetch(
        `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(
          profile.id,
        )}/post-impressions?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Cookie: userSessionCookie,
          },
        },
      );
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        const bodySnippet = truncateForLog(bodyText);
        logger.error(
          `failed to fetch peer post impressions for aiUserId=${profile.id}, peerId=${peerId}: ${resp.status} ${bodySnippet}`,
        );
      } else {
        const arr = (await resp.json()) as AiPostImpression[];
        for (const imp of arr) {
          if (typeof imp.postId !== "string") continue;
          if (typeof imp.payload !== "string") continue;

          let summary = "";
          let impression = "";
          let tags: string[] = [];

          try {
            const obj = JSON.parse(imp.payload) as {
              summary?: unknown;
              impression?: unknown;
              tags?: unknown;
            };
            if (typeof obj.summary === "string") summary = obj.summary;
            if (typeof obj.impression === "string") impression = obj.impression;
            tags = parseTagsField(obj.tags, 5);
          } catch (e) {
            logger.error(
              `failed to parse post impression JSON for aiUserId=${profile.id}, peerId=${peerId}, postId=${imp.postId}: ${e}`,
            );
            continue;
          }

          summary = summary.trim().slice(0, OUTPUT_CHAR_LIMIT);
          impression = impression.trim().slice(0, OUTPUT_CHAR_LIMIT);
          if (!summary && !impression) continue;

          peerPosts.push({
            postId: imp.postId,
            summary,
            impression,
            tags,
          });
        }
      }
    } catch (e) {
      logger.error(
        `Error while fetching/processing peer post impressions for aiUserId=${profile.id}, peerId=${peerId}: ${e}`,
      );
    }

    const peerJsonObj = {
      userId: peerId,
      nickname: peerProfile.nickname,
      introduction: peerIntro,
      lastImpression,
      posts: peerPosts,
    };
    const peerJson = JSON.stringify(peerJsonObj, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");

    const modifiedPrompt = prompt
      .replace("{{PROFILE_JSON}}", profileJson)
      .replace("{{PEER_JSON}}", peerJson);

    console.log(modifiedPrompt);

    const chatBody = {
      messages: [
        {
          role: "user" as const,
          content: modifiedPrompt,
        },
      ],
    };

    const chatResp = await fetch(`${BACKEND_API_BASE_URL}/ai-users/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userSessionCookie,
      },
      body: JSON.stringify(chatBody),
    });

    if (chatResp.status === 501) {
      const bodyText = await chatResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `AI features are disabled when calling ai-users/chat for aiUserId=${profile.id}, peerId=${peerId}: ${bodySnippet}`,
      );
      return;
    }
    if (!chatResp.ok) {
      const bodyText = await chatResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to call ai-users/chat for aiUserId=${profile.id}, peerId=${peerId}: ${chatResp.status} ${bodySnippet}`,
      );
      return;
    }

    const chatJson = (await chatResp.json()) as ChatResponse;
    console.log(chatJson);
    const content = chatJson.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      logger.error(
        `ai-users/chat returned empty content for aiUserId=${profile.id}, peerId=${peerId}`,
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = evaluateChatResponseAsJson(content);
    } catch (e) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `failed to parse AI output as JSON for aiUserId=${profile.id}, peerId=${peerId}: ${e} content=${contentSnippet}`,
      );
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON is not an object for aiUserId=${profile.id}, peerId=${peerId}: ${contentSnippet}`,
      );
      return;
    }

    const obj = parsed as { impression?: unknown; tags?: unknown };
    if (typeof obj.impression !== "string") {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON missing impression string field for aiUserId=${profile.id}, peerId=${peerId}: ${contentSnippet}`,
      );
      return;
    }

    const trimmedImpression = obj.impression.trim().slice(0, OUTPUT_CHAR_LIMIT);
    if (!trimmedImpression) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON impression is empty after trimming for aiUserId=${profile.id}, peerId=${peerId}: ${contentSnippet}`,
      );
      return;
    }

    const tags = parseTagsField(obj.tags, 5);

    const payloadObj = {
      impression: trimmedImpression,
      tags,
    };
    const payload = JSON.stringify(payloadObj);
    const payloadSnippet = truncateForLog(payload);

    const saveResp = await fetch(
      `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(profile.id)}/peer-impressions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: userSessionCookie,
        },
        body: JSON.stringify({
          peerId,
          payload,
        }),
      },
    );
    if (!saveResp.ok) {
      const bodyText = await saveResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to save peer impression for aiUserId=${profile.id}, peerId=${peerId}: ${saveResp.status} ${bodySnippet}`,
      );
      return;
    }
    logger.info(
      `Saved peer impression for aiUserId=${profile.id}, peerId=${peerId}: ${payloadSnippet}`,
    );
  } catch (e) {
    logger.error(
      `Error in createPeerImpression for aiUserId=${profile.id}, peerId=${peerId}: ${e}`,
    );
  }
}

async function createInterest(
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
  prompt: string,
): Promise<void> {
  try {
    const profileExcerpt = buildProfileExcerpt(profile, interest);
    const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
    const posts: {
      userId: string;
      nickname: string;
      summary: string;
      impression: string;
      tags: string[];
    }[] = [];
    try {
      const params = new URLSearchParams();
      params.set("limit", String(READ_IMPRESSION_LIMIT));
      params.set("offset", "0");
      params.set("order", "desc");
      const resp = await fetch(
        `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(
          profile.id,
        )}/post-impressions?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Cookie: userSessionCookie,
          },
        },
      );
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        const bodySnippet = truncateForLog(bodyText);
        logger.error(
          `failed to fetch post impressions for interest of aiUserId=${profile.id}: ${resp.status} ${bodySnippet}`,
        );
      } else {
        const arr = (await resp.json()) as AiPostImpression[];
        for (const imp of arr) {
          if (typeof imp.payload !== "string") continue;
          let nickname = "";
          try {
            const peer = await fetchUserProfile(userSessionCookie, imp.peerId);
            nickname = peer.nickname;
          } catch (e) {
            logger.error(`failed to fetch user ${imp.peerId}: ${e}`);
            continue;
          }
          let summary = "";
          let impression = "";
          let tags: string[] = [];
          try {
            const obj = JSON.parse(imp.payload) as {
              summary?: unknown;
              impression?: unknown;
              tags?: unknown;
            };
            if (typeof obj.summary === "string") summary = obj.summary;
            if (typeof obj.impression === "string") impression = obj.impression;
            tags = parseTagsField(obj.tags, 5);
          } catch (e) {
            logger.error(
              `failed to parse post impression JSON for interest of aiUserId=${profile.id}, postId=${String(
                imp.postId,
              )}: ${e}`,
            );
            continue;
          }
          summary = summary.trim().slice(0, OUTPUT_CHAR_LIMIT);
          impression = impression.trim().slice(0, OUTPUT_CHAR_LIMIT);
          if (!summary && !impression) continue;
          posts.push({ userId: imp.peerId, nickname, summary, impression, tags });
        }
      }
    } catch (e) {
      logger.error(
        `Error while fetching/processing post impressions for interest of aiUserId=${profile.id}: ${e}`,
      );
    }
    const postsJsonObj = { posts };
    const postsJson = JSON.stringify(postsJsonObj, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
    const modifiedPrompt = prompt
      .replace("{{PROFILE_JSON}}", profileJson)
      .replace("{{POSTS_JSON}}", postsJson);
    console.log(modifiedPrompt);
    const chatBody = {
      messages: [
        {
          role: "user" as const,
          content: modifiedPrompt,
        },
      ],
    };
    const chatResp = await fetch(`${BACKEND_API_BASE_URL}/ai-users/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userSessionCookie,
      },
      body: JSON.stringify(chatBody),
    });
    if (chatResp.status === 501) {
      const bodyText = await chatResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `AI features are disabled when calling ai-users/chat for interest of aiUserId=${profile.id}: ${bodySnippet}`,
      );
      return;
    }
    if (!chatResp.ok) {
      const bodyText = await chatResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to call ai-users/chat for interest of aiUserId=${profile.id}: ${chatResp.status} ${bodySnippet}`,
      );
      return;
    }
    const chatJson = (await chatResp.json()) as ChatResponse;
    console.log(chatJson);
    const content = chatJson.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      logger.error(`ai-users/chat returned empty content for interest of aiUserId=${profile.id}`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = evaluateChatResponseAsJson(content);
    } catch (e) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `failed to parse AI output as JSON for interest of aiUserId=${profile.id}: ${e} content=${contentSnippet}`,
      );
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON is not an object for interest of aiUserId=${profile.id}: ${contentSnippet}`,
      );
      return;
    }
    const obj = parsed as { interest?: unknown; tags?: unknown };
    if (typeof obj.interest !== "string") {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON missing interest string field for aiUserId=${profile.id}: ${contentSnippet}`,
      );
      return;
    }
    const trimmedInterest = obj.interest.trim().slice(0, OUTPUT_CHAR_LIMIT);
    if (!trimmedInterest) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON interest is empty after trimming for aiUserId=${profile.id}: ${contentSnippet}`,
      );
      return;
    }

    const tags = parseTagsField(obj.tags, 5);

    const payloadObj: InterestPayloadJson = {
      interest: trimmedInterest,
      tags,
    };
    const payload = JSON.stringify(payloadObj);
    const payloadSnippet = truncateForLog(payload);

    const saveResp = await fetch(
      `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(profile.id)}/interests`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: userSessionCookie,
        },
        body: JSON.stringify({
          payload,
        }),
      },
    );
    if (!saveResp.ok) {
      const bodyText = await saveResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to save interest for aiUserId=${profile.id}: ${saveResp.status} ${bodySnippet}`,
      );
      return;
    }
    logger.info(`Saved interest for aiUserId=${profile.id}: ${payloadSnippet}`);
  } catch (e) {
    logger.error(`Error in createInterest for aiUserId=${profile.id}: ${e}`);
  }
}

async function createNewPost(
  userSessionCookie: string,
  profile: UserDetail,
  interest: AiUserInterest | null,
  peerPosts: Map<string, PostDetail>,
  prompt: string,
): Promise<void> {
  try {
    const profileExcerpt = buildProfileExcerpt(profile, interest);
    const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
    const peers: {
      userId: string;
      nickname: string;
      impression: string;
      tags: string[];
      post: {
        summary: string;
        impression: string;
        tags: string[];
      };
    }[] = [];
    for (const [peerId, peerPost] of peerPosts.entries()) {
      let nickname = peerPost.ownerNickname;
      try {
        const peerProfile = await fetchUserProfile(userSessionCookie, peerId);
        nickname = peerProfile.nickname;
      } catch (e) {
        logger.info(
          `Failed to fetch peer profile for aiUserId=${profile.id}, peerId=${peerId}: ${e}`,
        );
      }

      const userImpressionRaw = await fetchPeerImpression(userSessionCookie, profile.id, peerId);
      if (!userImpressionRaw) continue;

      let userImpressionText = userImpressionRaw;
      let userTags: string[] = [];
      const parsedUserImp = parsePeerImpressionPayload(userImpressionRaw);
      if (parsedUserImp) {
        userImpressionText = parsedUserImp.impression.slice(0, OUTPUT_CHAR_LIMIT);
        if (parsedUserImp.tags) {
          userTags = parsedUserImp.tags.slice(0, 5);
        }
      }

      let postSummary = "";
      let postImpressionText = "";
      let postTags: string[] = [];
      try {
        const params = new URLSearchParams();
        params.set("peerId", peerId);
        params.set("limit", "1");
        params.set("offset", "0");
        params.set("order", "desc");
        const resp = await fetch(
          `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(
            profile.id,
          )}/post-impressions?${params.toString()}`,
          {
            method: "GET",
            headers: {
              Cookie: userSessionCookie,
            },
          },
        );
        if (!resp.ok) {
          const bodyText = await resp.text().catch(() => "");
          const bodySnippet = truncateForLog(bodyText);
          logger.error(
            `failed to fetch peer post impressions for new post of aiUserId=${profile.id}, peerId=${peerId}: ${resp.status} ${bodySnippet}`,
          );
        } else {
          const arr = (await resp.json()) as AiPostImpression[];
          if (arr.length > 0 && typeof arr[0].payload === "string") {
            try {
              const obj = JSON.parse(arr[0].payload) as {
                summary?: unknown;
                impression?: unknown;
                tags?: unknown;
              };
              if (typeof obj.summary === "string") postSummary = obj.summary;
              if (typeof obj.impression === "string") postImpressionText = obj.impression;
              postTags = parseTagsField(obj.tags, 5);
            } catch (e) {
              logger.error(
                `failed to parse peer post impression JSON for new post of aiUserId=${profile.id}, peerId=${peerId}: ${e}`,
              );
            }
          }
        }
      } catch (e) {
        logger.error(
          `Error while fetching peer post impressions for new post of aiUserId=${profile.id}, peerId=${peerId}: ${e}`,
        );
      }
      if (!postSummary) {
        postSummary = peerPost.content.slice(0, OUTPUT_CHAR_LIMIT);
      }
      peers.push({
        userId: peerId,
        nickname,
        impression: userImpressionText.slice(0, OUTPUT_CHAR_LIMIT),
        tags: userTags,
        post: {
          summary: postSummary.trim().slice(0, OUTPUT_CHAR_LIMIT),
          impression: postImpressionText.trim().slice(0, OUTPUT_CHAR_LIMIT),
          tags: postTags,
        },
      });
    }
    const peersJsonObj = { users: peers };
    const peersJson = JSON.stringify(peersJsonObj, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
    const recentPosts = await fetchOwnRecentPosts(userSessionCookie, profile.id);
    const posts = recentPosts.slice(0, OWN_POST_CONTEXT_LIMIT).map((post) => ({
      postId: post.id,
      createdAt: post.createdAt,
      content: post.content.slice(0, POST_CHAR_LIMIT),
    }));
    const postsJsonObj = { posts };
    const postsJson = JSON.stringify(postsJsonObj, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
    const modifiedPrompt = prompt
      .replace("{{PROFILE_JSON}}", profileJson)
      .replace("{{PEERS_JSON}}", peersJson)
      .replace("{{POSTS_JSON}}", postsJson);
    console.log(modifiedPrompt);
    const chatBody = {
      messages: [
        {
          role: "user" as const,
          content: modifiedPrompt,
        },
      ],
    };
    const chatResp = await fetch(`${BACKEND_API_BASE_URL}/ai-users/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userSessionCookie,
      },
      body: JSON.stringify(chatBody),
    });
    if (chatResp.status === 501) {
      const bodyText = await chatResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `AI features are disabled when calling ai-users/chat for new post of aiUserId=${profile.id}: ${bodySnippet}`,
      );
      return;
    }
    if (!chatResp.ok) {
      const bodyText = await chatResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to call ai-users/chat for new post of aiUserId=${profile.id}: ${chatResp.status} ${bodySnippet}`,
      );
      return;
    }
    const chatJson = (await chatResp.json()) as ChatResponse;
    console.log(chatJson);
    const content = chatJson.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      logger.error(`ai-users/chat returned empty content for new post of aiUserId=${profile.id}`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = evaluateChatResponseAsJson(content);
    } catch (e) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `failed to parse AI output as JSON for new post of aiUserId=${profile.id}: ${e} content=${contentSnippet}`,
      );
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON is not an object for new post of aiUserId=${profile.id}: ${contentSnippet}`,
      );
      return;
    }
    const obj = parsed as { content?: unknown; tags?: unknown };
    if (typeof obj.content !== "string") {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON missing content string field for new post of aiUserId=${profile.id}: ${contentSnippet}`,
      );
      return;
    }
    const trimmedContent = obj.content.trim().slice(0, POST_CHAR_LIMIT);
    if (!trimmedContent) {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON content is empty after trimming for new post of aiUserId=${profile.id}: ${contentSnippet}`,
      );
      return;
    }

    const postTags = parseTagsField(obj.tags, 3);
    const trimmedContentSnippet = truncateForLog(trimmedContent);
    const saveResp = await fetch(`${BACKEND_API_BASE_URL}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userSessionCookie,
      },
      body: JSON.stringify({
        content: trimmedContent,
        tags: postTags,
        publishedAt: PUBLISH_NEW_POSTS ? new Date().toISOString() : undefined,
      }),
    });
    if (!saveResp.ok) {
      const bodyText = await saveResp.text().catch(() => "");
      const bodySnippet = truncateForLog(bodyText);
      logger.error(
        `failed to create new post for aiUserId=${profile.id}: ${saveResp.status} ${bodySnippet}`,
      );
      return;
    }
    logger.info(`Created new post for aiUserId=${profile.id}: ${trimmedContentSnippet}`);
  } catch (e) {
    logger.error(`Error in createNewPost for aiUserId=${profile.id}: ${e}`);
  }
}

async function processUser(user: UserLite): Promise<void> {
  logger.info(`Processing AI user: id=${user.id}, nickname=${user.nickname}`);
  const adminSessionCookie = await loginAsAdmin();
  const userSessionCookie = await switchToUser(adminSessionCookie, user.id);
  const profile = await fetchUserProfile(userSessionCookie, user.id);
  if (!profile.locale) {
    throw new Error(`user locale is not set: id=${user.id}`);
  }
  let commonProfilePrompt;
  try {
    commonProfilePrompt = readPromptFile(COMMON_PROFILE_PROMPT_PREFIX, profile.locale);
  } catch (e) {
    logger.info(`Failed to read the common profile prompt for ${profile.locale}: ${e}`);
    return;
  }
  commonProfilePrompt = commonProfilePrompt.trim() + "\n\n";
  let postImpressionPrompt;
  try {
    postImpressionPrompt =
      commonProfilePrompt + readPromptFile(POST_IMPRESSION_PROMPT_PREFIX, profile.locale);
  } catch (e) {
    logger.info(`Failed to read the post impression prompt for ${profile.locale}: ${e}`);
    return;
  }
  let peerImpressionPrompt;
  try {
    peerImpressionPrompt =
      commonProfilePrompt + readPromptFile(PEER_IMPRESSION_PROMPT_PREFIX, profile.locale);
  } catch (e) {
    logger.info(`Failed to read the peer impression prompt for ${profile.locale}: ${e}`);
    return;
  }
  let interestPrompt;
  try {
    interestPrompt = commonProfilePrompt + readPromptFile(INTEREST_PROMPT_PREFIX, profile.locale);
  } catch (e) {
    logger.info(`Failed to read the interest prompt for ${profile.locale}: ${e}`);
    return;
  }
  let newPostPrompt;
  try {
    newPostPrompt = commonProfilePrompt + readPromptFile(NEW_POST_PROMPT_PREFIX, profile.locale);
  } catch (e) {
    logger.info(`Failed to read the new post prompt for ${profile.locale}: ${e}`);
    return;
  }
  const interest = await fetchUserInterest(userSessionCookie, user.id);
  const unreadPosts = await fetchPostsToRead(userSessionCookie, user.id);
  const peerIdSet = new Set<string>();
  const topPeerPosts = new Map<string, PostDetail>();
  for (const post of unreadPosts) {
    await createPostImpression(userSessionCookie, profile, interest, postImpressionPrompt, post);
    peerIdSet.add(post.ownedBy);
    if (topPeerPosts.size < 5 && !topPeerPosts.has(post.ownedBy)) {
      topPeerPosts.set(post.ownedBy, post);
    }
  }
  const peerIds = Array.from(peerIdSet);
  logger.info(`Selected peer IDs to read: ${peerIds.join(",")}`);
  for (const peerId of peerIds) {
    await createPeerImpression(userSessionCookie, profile, interest, peerImpressionPrompt, peerId);
  }
  await createInterest(userSessionCookie, profile, interest, interestPrompt);
  const newInterest = await fetchUserInterest(userSessionCookie, user.id);
  await createNewPost(userSessionCookie, profile, newInterest, topPeerPosts, newPostPrompt);
}

async function runOnce(): Promise<void> {
  logger.info("Logging in as admin for listing AI users");
  const sessionCookie = await loginAsAdmin();
  logger.info("Admin login for listing succeeded");
  let offset = 0;
  let processedCount = 0;
  for (;;) {
    if (processedCount >= USER_LIMIT) break;
    const users = await fetchNextUsers(sessionCookie, offset, USER_PAGE_SIZE);
    if (users.length === 0) break;
    for (let i = 0; i < users.length && processedCount < USER_LIMIT; i += CONCURRENCY) {
      const remaining = USER_LIMIT - processedCount;
      const batchSize = Math.min(CONCURRENCY, remaining, users.length - i);
      const batch = users.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (userItem) => {
          try {
            await processUser(userItem);
          } catch (e) {
            logger.info(`Failed to process the user of userId=${userItem.id}: ${e}`);
          }
          processedCount += 1;
        }),
      );
    }
    if (users.length < USER_PAGE_SIZE) break;
    offset += USER_PAGE_SIZE;
  }
}

async function main() {
  logger.info("STGY AI user worker started");
  logger.info(`BACNEND: ${BACKEND_API_BASE_URL}`);
  logger.info(`User processing limit from config: ${USER_LIMIT}`);
  logger.info(`Concurrency from config: ${CONCURRENCY}`);
  logger.info(`Infinite loop: ${INFINITE_LOOP}`);
  logger.info(`Loop interval (sec): ${LOOP_INTERVAL}`);
  if (!INFINITE_LOOP) {
    await runOnce();
    return;
  }
  for (;;) {
    await runOnce();
    if (LOOP_INTERVAL > 0) {
      logger.info(`Sleeping for ${LOOP_INTERVAL} seconds before next loop`);
      await new Promise<void>((resolve) => setTimeout(resolve, LOOP_INTERVAL * 1000));
    }
  }
}

main().catch((e) => {
  logger.error(`Fatal error: ${e}`);
  process.exit(1);
});
