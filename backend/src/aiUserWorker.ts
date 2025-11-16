import { createLogger } from "./utils/logger";
import type { UserLite, UserDetail } from "./models/user";

const logger = createLogger({ file: "mailWorker" });

const BACKEND_API_BASE_URL = process.env.STGY_BACKEND_API_BASE_URL || "http://localhost:3001";
const ADMIN_EMAIL = process.env.STGY_ADMIN_EMAIL || "admin@stgy.jp";
const ADMIN_PASSWORD = process.env.STGY_ADMIN_PASSWORD || "stgystgy";
const PAGE_LIMIT = 100;

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
  const resp = await fetch(
    `${BACKEND_API_BASE_URL}/ai-users?offset=${offset}&limit=${limit}`,
    {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
      },
    },
  );

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

async function processUser(user: UserLite): Promise<void> {
  logger.info(`Processing AI user: id=${user.id}, nickname=${user.nickname}`);
  const adminSessionCookie = await loginAsAdmin();
  const userSessionCookie = await switchToUser(adminSessionCookie, user.id);
  const profile = await fetchUserProfile(userSessionCookie, user.id);
  logger.info(
    `AI user profile: id=${profile.id}, nickname=${profile.nickname}, aiModel=${profile.aiModel ?? ""}, locale=${profile.locale}, timezone=${profile.timezone}, isAdmin=${profile.isAdmin}, blockStrangers=${profile.blockStrangers}, introduction=${profile.introduction}`,
  );
}

async function main() {
  logger.info("STGY AI user worker started");
  logger.info(`BACNEND: ${BACKEND_API_BASE_URL}`);
  logger.info("Logging in as admin for listing AI users");
  const sessionCookie = await loginAsAdmin();
  logger.info("Admin login for listing succeeded");

  let offset = 0;
  for (;;) {
    const users = await fetchNextUsers(sessionCookie, offset, PAGE_LIMIT);
    if (users.length === 0) {
      break;
    }
    for (const user of users) {
      await processUser(user);
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
