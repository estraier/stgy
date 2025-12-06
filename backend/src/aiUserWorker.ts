import fs from "fs";
import path from "path";
import { createLogger } from "./utils/logger";
import type { UserLite, UserDetail } from "./models/user";
import type { Post, PostDetail } from "./models/post";
import type { Notification } from "./models/notification";

type AiUserConfig = {
  backendApiBaseUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  userPageSize?: number;
  userLimit?: number | null;
  postImpressionPromptFile?: string;
};

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

function getConfigPath(): string {
  const argPath = process.argv[2];
  if (argPath && argPath.trim() !== "") {
    return path.resolve(argPath);
  }
  return path.resolve(__dirname, DEFAULT_CONFIG_FILENAME);
}

function loadConfig(configPath: string): AiUserConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`config file not found: ${configPath}`);
  }
  const json = fs.readFileSync(configPath, "utf8");
  const raw = JSON.parse(json) as unknown;
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`invalid config JSON: ${configPath}`);
  }
  const obj = raw as Record<string, unknown>;
  const config: AiUserConfig = {};

  if (typeof obj.backendApiBaseUrl === "string") {
    config.backendApiBaseUrl = obj.backendApiBaseUrl;
  }
  if (typeof obj.adminEmail === "string") {
    config.adminEmail = obj.adminEmail;
  }
  if (typeof obj.adminPassword === "string") {
    config.adminPassword = obj.adminPassword;
  }
  if (typeof obj.userPageSize === "number" && Number.isFinite(obj.userPageSize)) {
    config.userPageSize = obj.userPageSize;
  }
  if (typeof obj.userLimit === "number" ? Number.isFinite(obj.userLimit) : obj.userLimit === null) {
    config.userLimit = obj.userLimit as number | null;
  }
  if (typeof obj.postImpressionPromptFile === "string") {
    config.postImpressionPromptFile = obj.postImpressionPromptFile;
  }

  return config;
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
const fileConfig = loadConfig(configPath);
const CONFIG_DIR = path.dirname(configPath);

const POST_IMPRESSION_PROMPT_PREFIX = (() => {
  if (!fileConfig.postImpressionPromptFile) {
    throw new Error("postImpressionPromptFile is not configured in ai-user-config.json");
  }
  return path.isAbsolute(fileConfig.postImpressionPromptFile)
    ? fileConfig.postImpressionPromptFile
    : path.resolve(CONFIG_DIR, fileConfig.postImpressionPromptFile);
})();

const BACKEND_API_BASE_URL =
  process.env.STGY_BACKEND_API_BASE_URL || fileConfig.backendApiBaseUrl || "http://localhost:3001";

const ADMIN_EMAIL = process.env.STGY_ADMIN_EMAIL || fileConfig.adminEmail || "admin@stgy.jp";

const ADMIN_PASSWORD = process.env.STGY_ADMIN_PASSWORD || fileConfig.adminPassword || "stgystgy";

const PAGE_LIMIT =
  typeof fileConfig.userPageSize === "number" && fileConfig.userPageSize > 0
    ? fileConfig.userPageSize
    : 100;

const USER_LIMIT =
  typeof fileConfig.userLimit === "number" && fileConfig.userLimit > 0
    ? fileConfig.userLimit
    : undefined;

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
    throw new Error(`failed to login as admin: ${resp.status} ${body}`);
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
    throw new Error(`failed to fetch ai users: ${resp.status} ${body}`);
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
    throw new Error(`failed to switch user: ${resp.status} ${body}`);
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
    throw new Error(`failed to fetch user profile: ${resp.status} ${body}`);
  }

  const profile = (await resp.json()) as UserDetail;
  return profile;
}

async function fetchFolloweePosts(sessionCookie: string, userId: string): Promise<Post[]> {
  const params = new URLSearchParams();
  params.set("userId", userId);
  params.set("offset", "0");
  params.set("limit", "30");
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
    throw new Error(`failed to fetch posts by followees: ${resp.status} ${body}`);
  }

  const posts = (await resp.json()) as Post[];
  return posts;
}

async function fetchLatestPosts(sessionCookie: string, userId: string): Promise<Post[]> {
  const params = new URLSearchParams();
  params.set("offset", "0");
  params.set("limit", "30");
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
    throw new Error(`failed to fetch latest posts: ${resp.status} ${body}`);
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
    throw new Error(`failed to fetch notifications: ${resp.status} ${body}`);
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
  throw new Error(`failed to check post impression: ${resp.status} ${body}`);
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
    throw new Error(`failed to fetch post detail: ${resp.status} ${body}`);
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
    .slice(0, 10)
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
  prompt: string,
  post: PostDetail,
): Promise<void> {
  try {
    const profileExcerpt = {
      nickname: profile.nickname,
      locale: profile.locale,
      introduction: profile.introduction.slice(0, 1000),
      aiPersonality: profile.aiPersonality,
    };
    const profileJson = JSON.stringify(profileExcerpt, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");

    const postExcerpt = {
      author: post.ownerNickname,
      locale: post.locale,
      createdAt: post.createdAt,
      content: post.content.slice(0, 300),
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
      logger.error(
        `AI features are disabled when calling ai-users/chat for aiUserId=${profile.id}, postId=${post.id}: ${bodyText}`,
      );
      return;
    }

    if (!chatResp.ok) {
      const bodyText = await chatResp.text().catch(() => "");
      logger.error(
        `failed to call ai-users/chat for aiUserId=${profile.id}, postId=${post.id}: ${chatResp.status} ${bodyText}`,
      );
      return;
    }

    const chatJson = (await chatResp.json()) as {
      message?: { content?: string };
    };
    let content = chatJson.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      logger.error(
        `ai-users/chat returned empty content for aiUserId=${profile.id}, postId=${post.id}`,
      );
      return;
    }

    let jsonText = content.trim();
    if (!jsonText.startsWith("{")) {
      const first = jsonText.indexOf("{");
      const last = jsonText.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        jsonText = jsonText.slice(first, last + 1);
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      logger.error(
        `failed to parse AI output as JSON for aiUserId=${profile.id}, postId=${post.id}: ${e} content=${jsonText}`,
      );
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      logger.error(
        `AI output JSON is not an object for aiUserId=${profile.id}, postId=${post.id}: ${jsonText}`,
      );
      return;
    }

    const obj = parsed as { summary?: unknown; impression?: unknown };
    if (typeof obj.summary !== "string" || typeof obj.impression !== "string") {
      logger.error(
        `AI output JSON missing summary/impression string fields for aiUserId=${profile.id}, postId=${post.id}: ${jsonText}`,
      );
      return;
    }

    const trimmed = {
      summary: obj.summary.trim().slice(0, 400),
      impression: obj.impression.trim().slice(0, 400),
    };

    const description = JSON.stringify(trimmed);

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
      logger.error(
        `failed to save post impression for aiUserId=${profile.id}, postId=${post.id}: ${saveResp.status} ${bodyText}`,
      );
      return;
    }

    logger.info(
      `Saved post impression for aiUserId=${profile.id}, postId=${post.id}: ${description}`,
    );
  } catch (e) {
    logger.error(
      `Error in createPostImpression for aiUserId=${profile.id}, postId=${post.id}: ${e}`,
    );
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
  const unreadPosts = await fetchPostsToRead(userSessionCookie, user.id);
  const impressionPrompt = readPromptFile(POST_IMPRESSION_PROMPT_PREFIX, profile.locale);
  const peerIdSet = new Set();
  for (const post of unreadPosts) {
    await createPostImpression(userSessionCookie, profile, impressionPrompt, post);
    peerIdSet.add(post.ownedBy);

    // for debug.
    break;
  }
  const peerIds = Array.from(peerIdSet);
  logger.info(`Selected peer IDs to read: ${peerIds.join(",")}`);


  console.log(peerIds);


}

async function main() {
  logger.info("STGY AI user worker started");
  logger.info(`BACNEND: ${BACKEND_API_BASE_URL}`);
  if (USER_LIMIT !== undefined) {
    logger.info(`User processing limit from config: ${USER_LIMIT}`);
  }
  logger.info("Logging in as admin for listing AI users");
  const sessionCookie = await loginAsAdmin();
  logger.info("Admin login for listing succeeded");

  let offset = 0;
  let processedCount = 0;
  for (;;) {
    if (USER_LIMIT !== undefined && processedCount >= USER_LIMIT) {
      break;
    }
    const users = await fetchNextUsers(sessionCookie, offset, PAGE_LIMIT);
    if (users.length === 0) {
      break;
    }
    for (const user of users) {
      if (USER_LIMIT !== undefined && processedCount >= USER_LIMIT) {
        break;
      }
      await processUser(user);
      processedCount += 1;
    }
    if (users.length < PAGE_LIMIT) {
      break;
    }
    offset += PAGE_LIMIT;
  }
}

main().catch((e) => {
  logger.error(`Fatal error: ${e}`);
  process.exit(1);
});
