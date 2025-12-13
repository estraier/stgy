import { Config } from "./config";
import { createLogger } from "./utils/logger";
import type { AiPostSummary } from "./models/aiPost";
import { AuthService } from "./services/auth";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import type { Pool } from "pg";
import type Redis from "ioredis";
import http from "http";
import https from "https";
import { URLSearchParams } from "url";

const logger = createLogger({ file: "aiSummaryWorker" });

let pgPool: Pool | null = null;
let redis: Redis | null = null;
let authService: AuthService | null = null;

let sessionId: string | null = null;
let shuttingDown = false;
const inflight = new Set<Promise<void>>();

type HttpResult = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function loginAsAdmin(): Promise<void> {
  if (!authService) throw new Error("authService is not initialized");
  const res = await authService.loginAsAdmin();
  sessionId = res.sessionId;
  logger.info(`[aiSummaryWorker] loginAsAdmin ok; session_id length=${sessionId.length}`);
}

async function apiRequest(
  path: string,
  options: { method?: string; body?: unknown } = {},
  allowRetry = true,
): Promise<HttpResult> {
  if (!sessionId) await loginAsAdmin();
  const method = options.method ?? "GET";
  let bodyStr = "";
  const headers: Record<string, string> = { Cookie: `session_id=${sessionId}` };
  if (options.body !== undefined) {
    bodyStr = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
  }
  const res = await httpRequest(path, { method, headers, body: bodyStr });
  if (res.statusCode === 401 && allowRetry) {
    logger.warn(`[aiSummaryWorker] 401 from ${path}, retrying loginAsAdmin`);
    sessionId = null;
    await loginAsAdmin();
    return apiRequest(path, options, false);
  }
  if (res.statusCode < 200 || res.statusCode >= 300)
    throw new Error(`request failed: ${res.statusCode} ${res.body}`);
  return res;
}

async function fetchPendingSummaries(): Promise<AiPostSummary[]> {
  const newerThan = new Date(Date.now() - Config.AI_SUMMARY_POST_LOOKBACK_MS).toISOString();
  const params = new URLSearchParams({
    offset: "0",
    limit: String(Config.AI_SUMMARY_BATCH_SIZE),
    order: "asc",
    nullOnly: "true",
    newerThan,
  });
  const res = await apiRequest(`/ai-posts?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as AiPostSummary[];
}

async function summaryzePost(postId: string): Promise<void> {
  logger.info(`[aiSummaryWorker] summaryzePost ${postId}`);
}

async function processLoop(): Promise<void> {
  while (!shuttingDown) {
    let summaries: AiPostSummary[] = [];
    try {
      summaries = await fetchPendingSummaries();
    } catch (e) {
      logger.error(`[aiSummaryWorker] fetchPendingSummaries error: ${e}`);
      await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
      continue;
    }
    if (summaries.length === 0) {
      await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
      continue;
    }
    let index = 0;
    while (index < summaries.length && !shuttingDown) {
      if (inflight.size >= Config.AI_SUMMARY_CONCURRENCY) {
        await Promise.race(inflight);
        continue;
      }
      const { postId } = summaries[index++];
      const p = (async () => {
        try {
          await summaryzePost(postId);
        } catch (e) {
          logger.error(`[aiSummaryWorker] error summarizing post ${postId}: ${e}`);
        }
      })();
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
    if (inflight.size > 0) await Promise.allSettled(Array.from(inflight));
    await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
  }
}

async function idleLoop(): Promise<void> {
  while (!shuttingDown) await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
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
  logger.info(`STGY AI summary worker started (concurrency=${Config.AI_SUMMARY_CONCURRENCY})`);
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
    logger.info("API key is not set so do nothing.");
    await idleLoop();
  }
}

main().catch((e) => {
  logger.error(`[aiSummaryWorker] Fatal error: ${e}`);
  process.exit(1);
});
