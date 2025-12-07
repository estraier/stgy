import fs from "fs";
import path from "path";
import { createLogger } from "./utils/logger";
import type { AiUserInterest } from "./models/aiUser";
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

const logger = createLogger({ file: "mailWorker" });

const DEFAULT_CONFIG_FILENAME = "ai-user-config.json";
const LOG_TEXT_LIMIT = 100;

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
const INFINITE_LOOP = !!(fileConfig as any).infiniteLoop;
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

function buildProfileExcerpt(
  profile: UserDetail,
  interest: AiUserInterest | null,
): {
  userId: string;
  nickname: string;
  locale: string | null;
  introduction: string;
  aiPersonality: string;
  currentInterest: string;
} {
  return {
    userId: profile.id,
    nickname: profile.nickname,
    locale: profile.locale,
    introduction: profile.introduction.slice(0, PROFILE_CHAR_LIMIT),
    aiPersonality: profile.aiPersonality
      ? profile.aiPersonality.slice(0, PROFILE_CHAR_LIMIT)
      : "",
    currentInterest: interest ? interest.description.slice(0, PROFILE_CHAR_LIMIT) : "",
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
    const postExcerpt = {
      author: post.ownerNickname,
      locale: post.locale,
      createdAt: post.createdAt,
      content: post.content.slice(0, POST_CHAR_LIMIT),
    };
    const postJson = JSON.stringify(postExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
    const modifiedPrompt = prompt
      .replace("{{PROFILE_JSON}}", profileJson)
      .replace("{{POST_JSON}}", postJson);
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
    const obj = parsed as { summary?: unknown; impression?: unknown };
    if (typeof obj.summary !== "string" || typeof obj.impression !== "string") {
      const contentSnippet = truncateForLog(content);
      logger.error(
        `AI output JSON missing summary/impression string fields for aiUserId=${profile.id}, postId=${post.id}: ${contentSnippet}`,
      );
      return;
    }
    const trimmed = {
      summary: obj.summary.trim().slice(0, OUTPUT_CHAR_LIMIT),
      impression: obj.impression.trim().slice(0, OUTPUT_CHAR_LIMIT),
    };
    const description = JSON.stringify(trimmed);
    const descriptionSnippet = truncateForLog(description);
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
          description,
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
      `Saved post impression for aiUserId=${profile.id}, postId=${post.id}: ${descriptionSnippet}`,
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
    let lastImpression = "";
    try {
      const resp = await fetch(
        `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(
          profile.id,
        )}/peer-impressions/${encodeURIComponent(peerId)}`,
        {
          method: "GET",
          headers: {
            Cookie: userSessionCookie,
          },
        },
      );
      if (resp.status === 404) {
      } else if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        const bodySnippet = truncateForLog(bodyText);
        logger.error(
          `failed to fetch peer impression for aiUserId=${profile.id}, peerId=${peerId}: ${resp.status} ${bodySnippet}`,
        );
      } else {
        const data = (await resp.json()) as { description?: unknown };
        if (typeof data.description === "string") {
          lastImpression = data.description;
        }
      }
    } catch (e) {
      logger.error(
        `Error while fetching last peer impression for aiUserId=${profile.id}, peerId=${peerId}: ${e}`,
      );
    }
    type RawPostImpression = {
      postId?: unknown;
      description?: unknown;
    };
    const peerPosts: { postId: string; summary: string; impression: string }[] = [];
    try {
      const params = new URLSearchParams();
      params.set("ownerId", peerId);
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
        const arr = (await resp.json()) as RawPostImpression[];
        for (const imp of arr) {
          if (typeof imp.postId !== "string") continue;
          if (typeof imp.description !== "string") continue;
          let summary = "";
          let impression = "";
          try {
            const obj = JSON.parse(imp.description) as {
              summary?: unknown;
              impression?: unknown;
            };
            if (typeof obj.summary === "string") summary = obj.summary;
            if (typeof obj.impression === "string") impression = obj.impression;
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
    const obj = parsed as { impression?: unknown };
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
    const trimmedImpressionSnippet = truncateForLog(trimmedImpression);
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
          description: trimmedImpression,
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
      `Saved peer impression for aiUserId=${profile.id}, peerId=${peerId}: ${trimmedImpressionSnippet}`,
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

    type RawPostImpression = {
      postId?: unknown;
      description?: unknown;
    };
    const posts: { summary: string; impression: string }[] = [];
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
        const arr = (await resp.json()) as RawPostImpression[];
        for (const imp of arr) {
          if (typeof imp.description !== "string") continue;
          let summary = "";
          let impression = "";
          try {
            const obj = JSON.parse(imp.description) as {
              summary?: unknown;
              impression?: unknown;
            };
            if (typeof obj.summary === "string") summary = obj.summary;
            if (typeof obj.impression === "string") impression = obj.impression;
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
          posts.push({ summary, impression });
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
    const obj = parsed as { interest?: unknown };
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

    const trimmedInterestSnippet = truncateForLog(trimmedInterest);
    const saveResp = await fetch(
      `${BACKEND_API_BASE_URL}/ai-users/${encodeURIComponent(profile.id)}/interests`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: userSessionCookie,
        },
        body: JSON.stringify({
          description: trimmedInterest,
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
    logger.info(`Saved interest for aiUserId=${profile.id}: ${trimmedInterestSnippet}`);
  } catch (e) {
    logger.error(`Error in createInterest for aiUserId=${profile.id}: ${e}`);
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
  const interest = await fetchUserInterest(userSessionCookie, user.id);
  const unreadPosts = await fetchPostsToRead(userSessionCookie, user.id);
  let postImpressionPrompt;
  try {
    postImpressionPrompt = readPromptFile(POST_IMPRESSION_PROMPT_PREFIX, profile.locale);
  } catch (e) {
    logger.info(`Failed to read the post impression prompt for ${profile.locale}: ${e}`);
    return;
  }
  let peerImpressionPrompt;
  try {
    peerImpressionPrompt = readPromptFile(PEER_IMPRESSION_PROMPT_PREFIX, profile.locale);
  } catch (e) {
    logger.info(`Failed to read the peer impression prompt for ${profile.locale}: ${e}`);
    return;
  }
  let interestPrompt;
  try {
    interestPrompt = readPromptFile(INTEREST_PROMPT_PREFIX, profile.locale);
  } catch (e) {
    logger.info(`Failed to read the interest prompt for ${profile.locale}: ${e}`);
    return;
  }
  const peerIdSet = new Set<string>();
  for (const post of unreadPosts) {
    await createPostImpression(userSessionCookie, profile, interest, postImpressionPrompt, post);
    peerIdSet.add(post.ownedBy);
  }
  const peerIds = Array.from(peerIdSet);
  logger.info(`Selected peer IDs to read: ${peerIds.join(",")}`);
  for (const peerId of peerIds) {
    await createPeerImpression(userSessionCookie, profile, interest, peerImpressionPrompt, peerId);
  }
  await createInterest(userSessionCookie, profile, interest, interestPrompt);
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
        batch.map(async (user) => {
          try {
            await processUser(user);
          } catch (e) {
            logger.info(`Failed to process the user of userId=${user.id}: ${e}`);
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
