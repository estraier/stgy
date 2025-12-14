import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { AuthService } from "./services/auth";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import { countPseudoTokens, sliceByPseudoTokens } from "stgy-markdown";
import type { Pool } from "pg";
import type Redis from "ioredis";
import http from "http";
import https from "https";
import { URLSearchParams } from "url";

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

type UserLite = {
  id: string;
};

class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
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

/**
 * バックドア（aiSummaryWorker と同様）
 */
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

  // id だけ保証して返す（落ちにくくする）
  const out: UserLite[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || id.trim() === "") continue;
    out.push({ id });
  }
  return out;
}

/**
 * summarizePost 相当：まずは userId を出すだけ
 */
async function processUser(_sessionCookie: string, userId: string): Promise<void> {
  console.log(userId);
}

async function processLoop(): Promise<void> {
  let offset = 0;

  while (!shuttingDown) {
    let sessionCookie: string;

    try {
      sessionCookie = await loginAsAdmin();
    } catch (e) {
      logger.error(`[aiUserWorker] loginAsAdmin error: ${e}`);
      await sleep(Config.AI_USER_IDLE_SLEEP_MS);
      continue;
    }

    let users: UserLite[] = [];
    try {
      users = await fetchNextUsers(sessionCookie, offset, Config.AI_USER_BATCH_SIZE);
    } catch (e) {
      logger.error(`[aiUserWorker] fetchNextUsers error: ${e}`);
      await sleep(Config.AI_USER_IDLE_SLEEP_MS);
      continue;
    }

    if (users.length === 0) {
      offset = 0;
      await sleep(Config.AI_USER_IDLE_SLEEP_MS);
      continue;
    }

    let index = 0;

    while (index < users.length && !shuttingDown) {
      if (inflight.size >= Config.AI_USER_CONCURRENCY) {
        await Promise.race(inflight);
        continue;
      }

      const { id: userId } = users[index++];

      const p = (async () => {
        try {
          await processUser(sessionCookie, userId);
        } catch (e) {
          if (e instanceof UnauthorizedError) {
            logger.warn(`[aiUserWorker] 401 while processing userId=${userId}; will relogin`);
            return;
          }
          logger.error(`[aiUserWorker] error processing userId=${userId}: ${e}`);
        }
      })();

      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }

    if (inflight.size > 0) await Promise.allSettled(Array.from(inflight));

    offset += users.length;
    if (users.length < Config.AI_USER_BATCH_SIZE) offset = 0;

    await sleep(Config.AI_USER_IDLE_SLEEP_MS);
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
  logger.error(`[aiUserWorker] Fatal error: ${e}`);
  process.exit(1);
});
