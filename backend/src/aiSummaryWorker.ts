import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { readPrompt } from "./utils/prompt";
import type { AiPostSummary } from "./models/aiPost";
import type { PostDetail } from "./models/post";
import { AuthService } from "./services/auth";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import { countPseudoTokens, sliceByPseudoTokens } from "stgy-markdown";
import type { Pool } from "pg";
import type Redis from "ioredis";
import http from "http";
import https from "https";
import { URLSearchParams } from "url";

const logger = createLogger({ file: "aiSummaryWorker" });

const BASIC_MODEL = "basic";

const POST_TEXT_LIMIT = 10000;
const SUMMARY_TEXT_LIMIT = 2000;

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

type ChatResponse = {
  message?: {
    content?: string;
  };
};

type GenerateFeaturesRequest = {
  model: string;
  input: string;
};

type GenerateFeaturesResponse = {
  features: string;
  dims: number;
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

async function fetchPendingSummaries(sessionCookie: string): Promise<AiPostSummary[]> {
  const newerThan = new Date(Date.now() - Config.AI_SUMMARY_POST_LOOKBACK_MS).toISOString();
  const params = new URLSearchParams({
    offset: "0",
    limit: String(Config.AI_SUMMARY_BATCH_SIZE),
    order: "asc",
    nullOnly: "true",
    newerThan,
  });
  const res = await apiRequest(sessionCookie, `/ai-posts?${params.toString()}`, { method: "GET" });
  const parsed = JSON.parse(res.body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const now = Date.now();
  const cutoff = now - Config.AI_SUMMARY_POST_SKIP_LATEST_MS;
  const out: AiPostSummary[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const createdAtRaw = (item as { createdAt?: unknown }).createdAt;
    if (typeof createdAtRaw === "string") {
      const createdAtMs = Date.parse(createdAtRaw);
      if (createdAtMs > cutoff) continue;
    }
    const updatedAtRaw = (item as { updatedAt?: unknown }).updatedAt;
    if (typeof updatedAtRaw === "string") {
      const updatedAtMs = Date.parse(updatedAtRaw);
      if (updatedAtMs > cutoff) continue;
    }
    out.push(item as AiPostSummary);
  }
  return out;
}

async function fetchPostDetail(sessionCookie: string, postId: string): Promise<PostDetail> {
  const res = await apiRequest(sessionCookie, `/posts/${encodeURIComponent(postId)}`, {
    method: "GET",
  });
  return JSON.parse(res.body) as PostDetail;
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

async function generateFeaturesViaBackend(
  sessionCookie: string,
  req: GenerateFeaturesRequest,
): Promise<GenerateFeaturesResponse> {
  const res = await apiRequest(sessionCookie, "/ai-users/features", {
    method: "POST",
    body: { model: req.model, input: req.input },
  });

  const parsed = JSON.parse(res.body) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`features api returned non-object: ${truncateForLog(res.body, 50)}`);
  }

  const obj = parsed as { features?: unknown };
  if (typeof obj.features !== "string" || obj.features.trim() === "") {
    throw new Error(`features api missing features string: ${truncateForLog(res.body, 50)}`);
  }

  const dims = Buffer.from(obj.features, "base64").byteLength;
  return { features: obj.features, dims };
}

function buildFeaturesInput(summary: string, tags: string[]): string {
  const s = summary.trim();
  const t = tags
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5);
  return `${s}\n\n${t.join("\n")}`;
}

async function postSummaryResult(
  sessionCookie: string,
  postId: string,
  body: {
    model: string;
    summary: string;
    tags: string[];
    features: string;
  },
): Promise<void> {
  await apiRequest(sessionCookie, `/ai-posts/${encodeURIComponent(postId)}`, {
    method: "PUT",
    body,
  });
}

async function summarizePost(sessionCookie: string, postId: string): Promise<void> {
  logger.info(`[aiSummaryWorker] summarizePost postId=${postId}`);
  const post = await fetchPostDetail(sessionCookie, postId);
  const locale = (post.locale || post.ownerLocale || "en").replace(/_/g, "-");
  logger.info(
    `[aiSummaryWorker] post fetched postId=${postId} locale=${locale} author=${
      post.ownerNickname
    } content=${truncateForLog(post.content, 50)}`,
  );
  const promptTpl = readPrompt("post-summary", locale, "en");
  const postText = truncateText(post.content, POST_TEXT_LIMIT);
  const postJsonObj = {
    locale,
    nickname: post.ownerNickname,
    content: postText,
  };
  const postJson = JSON.stringify(postJsonObj, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
  let localeText = locale;
  if (locale === "en" || locale.startsWith("en-")) localeText = `English (${locale})`;
  if (locale === "ja" || locale.startsWith("ja-")) localeText = `日本語（${locale}）`;
  const prompt = promptTpl.replace("{{POST_JSON}}", postJson).replace("{{LOCALE}}", localeText);
  //console.log(prompt);
  const chatRes = await apiRequest(sessionCookie, `/ai-users/chat`, {
    method: "POST",
    body: {
      model: BASIC_MODEL,
      messages: [{ role: "user" as const, content: prompt }],
    },
  });
  const chatJson = JSON.parse(chatRes.body) as ChatResponse;
  const aiContent = chatJson.message?.content;
  if (typeof aiContent !== "string" || aiContent.trim() === "") {
    throw new Error(`ai-users/chat returned empty content for postId=${postId}`);
  }
  //console.log(aiContent);
  const parsed = evaluateChatResponseAsJson<{
    summary?: unknown;
    tags?: unknown;
  }>(aiContent);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`AI output is not an object: postId=${postId}`);
  }
  const obj = parsed as { summary?: unknown; tags?: unknown };
  if (typeof obj.summary !== "string") {
    throw new Error(`AI output missing summary string: postId=${postId}`);
  }
  const summary = truncateText(obj.summary, SUMMARY_TEXT_LIMIT);
  const tags = parseTagsField(obj.tags, 5);
  logger.info(
    `[aiSummaryWorker] parsed result postId=${postId} summary=${truncateForLog(
      summary,
      50,
    )} tags=${tags.join(",")}`,
  );
  const featuresInput = buildFeaturesInput(summary, tags);
  const feat = await generateFeaturesViaBackend(sessionCookie, {
    model: BASIC_MODEL,
    input: featuresInput,
  });
  await postSummaryResult(sessionCookie, postId, {
    model: BASIC_MODEL,
    summary,
    tags,
    features: feat.features,
  });
  logger.info(`[aiSummaryWorker] summary saved postId=${postId}`);
}

async function processLoop(): Promise<void> {
  while (!shuttingDown) {
    let sessionCookie: string;
    try {
      sessionCookie = await loginAsAdmin();
    } catch (e) {
      logger.error(`[aiSummaryWorker] loginAsAdmin error: ${e}`);
      await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
      continue;
    }
    let summaries: AiPostSummary[] = [];
    try {
      summaries = await fetchPendingSummaries(sessionCookie);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        logger.warn(`[aiSummaryWorker] session expired while fetching pending summaries; relogin`);
        await sleep(200);
        continue;
      }
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
          await summarizePost(sessionCookie, postId);
        } catch (e) {
          if (e instanceof UnauthorizedError) {
            logger.warn(`[aiSummaryWorker] 401 while summarizing postId=${postId}; will relogin`);
            return;
          }
          logger.error(`[aiSummaryWorker] error summarizing postId=${postId}: ${e}`);
        }
      })();
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
    if (inflight.size > 0) await Promise.allSettled(Array.from(inflight));
    await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
  }
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
  await processLoop();
}

main().catch((e) => {
  logger.error(`[aiSummaryWorker] Fatal error: ${e}`);
  process.exit(1);
});
