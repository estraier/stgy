import fs from "fs";
import path from "path";
import { createLogger } from "./utils/logger";
import type { UserLite, UserDetail } from "./models/user";
import type { Post } from "./models/post";

type AiUserConfig = {
  backendApiBaseUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  userPageSize?: number;
  userLimit?: number | null;
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

  return config;
}

const configPath = getConfigPath();
const fileConfig = loadConfig(configPath);

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

async function processUser(user: UserLite): Promise<void> {
  logger.info(`Processing AI user: id=${user.id}, nickname=${user.nickname}`);
  const adminSessionCookie = await loginAsAdmin();
  const userSessionCookie = await switchToUser(adminSessionCookie, user.id);
  const profile = await fetchUserProfile(userSessionCookie, user.id);
  logger.info(
    `AI user profile: id=${profile.id}, nickname=${profile.nickname}, aiModel=${
      profile.aiModel ?? ""
    }, locale=${profile.locale}, timezone=${profile.timezone}, isAdmin=${
      profile.isAdmin
    }, blockStrangers=${profile.blockStrangers}, introduction=${profile.introduction}`,
  );
  const followeePosts = await fetchFolloweePosts(userSessionCookie, user.id);
  logger.info(
    `AI user followee posts (to read): count=${followeePosts.length}, posts=${JSON.stringify(
      followeePosts,
    )}`,
  );
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
