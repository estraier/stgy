import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { readPrompt } from "./utils/prompt";
import type { AiPostSummaryPacket, UpdateAiPostSummaryPacket } from "./models/aiPost";
import type { PostDetail } from "./models/post";
import type { ChatRequest, ChatResponse, GenerateFeaturesRequest } from "./models/aiUser";
import { AuthService } from "./services/auth";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import { makeTextFromMarkdown } from "./utils/snippet";
import { countPseudoTokens, sliceByPseudoTokens } from "stgy-markdown";
import type { Pool } from "pg";
import type Redis from "ioredis";
import http from "http";
import https from "https";
import { URLSearchParams } from "url";

const logger = createLogger({ file: "aiSummaryWorker" });

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

type GenerateFeaturesResponseWire =
  | { features: string }
  | { features: number[] }
  | { features: { type: "Buffer"; data: number[] } };

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

type PendingAiPostSummaryPacket = AiPostSummaryPacket & { createdAt?: string; updatedAt?: string };

async function fetchPendingSummaries(sessionCookie: string): Promise<PendingAiPostSummaryPacket[]> {
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
  const out: PendingAiPostSummaryPacket[] = [];
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
    out.push(item as PendingAiPostSummaryPacket);
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

function normalizeFeaturesToBase64(respBody: string): { features: string; dims: number } {
  const parsed = JSON.parse(respBody) as unknown;
  const getFromNumbers = (nums: number[]): { base64: string; dims: number } => {
    const allU8 = nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
    if (allU8) {
      const buf = Buffer.from(Uint8Array.from(nums));
      return { base64: buf.toString("base64"), dims: buf.byteLength };
    }
    const allI8 = nums.every((n) => Number.isInteger(n) && n >= -128 && n <= 127);
    if (allI8) {
      const arr = Int8Array.from(nums);
      const buf = Buffer.from(arr.buffer);
      return { base64: buf.toString("base64"), dims: arr.byteLength };
    }
    throw new Error("features array has invalid byte values");
  };
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as GenerateFeaturesResponseWire;
    if (typeof obj.features === "string" && obj.features.trim() !== "") {
      const dims = Buffer.from(obj.features, "base64").byteLength;
      return { features: obj.features, dims };
    }
    if (Array.isArray(obj.features)) {
      const { base64, dims } = getFromNumbers(obj.features);
      return { features: base64, dims };
    }
    if (
      typeof obj.features === "object" &&
      obj.features !== null &&
      "type" in obj.features &&
      (obj.features as { type?: unknown }).type === "Buffer" &&
      "data" in obj.features &&
      Array.isArray((obj.features as { data?: unknown }).data)
    ) {
      const data = (obj.features as { data: unknown }).data as unknown[];
      const nums: number[] = [];
      for (const x of data) {
        if (typeof x !== "number") throw new Error("features Buffer data contains non-number");
        nums.push(x);
      }
      const { base64, dims } = getFromNumbers(nums);
      return { features: base64, dims };
    }
  }
  throw new Error(`features api returned invalid payload: ${truncateForLog(respBody, 50)}`);
}

async function generateFeaturesViaBackend(
  sessionCookie: string,
  req: GenerateFeaturesRequest,
): Promise<{ features: string; dims: number }> {
  const res = await apiRequest(sessionCookie, "/ai-users/features", {
    method: "POST",
    body: { model: req.model, input: req.input },
  });
  return normalizeFeaturesToBase64(res.body);
}

function buildFeaturesInput(summary: string, tags: string[], postSnippet: string): string {
  const lines: string[] = [];
  lines.push(summary.trim());
  if (tags.length > 0) {
    lines.push("");
    lines.push(...tags);
  }
  if (postSnippet) {
    lines.push("");
    lines.push(postSnippet);
  }
  return lines.join("\n");
}

type UpdateAiPostSummaryPutBody = { summary: string; tags: string[]; features: string };

async function postSummaryResult(
  sessionCookie: string,
  postId: string,
  body: UpdateAiPostSummaryPutBody,
): Promise<void> {
  await apiRequest(sessionCookie, `/ai-posts/${encodeURIComponent(postId)}`, {
    method: "PUT",
    body,
  });
}

async function summarizePost(sessionCookie: string, postId: string): Promise<void> {
  logger.info(`summarizePost postId=${postId}`);
  const post = await fetchPostDetail(sessionCookie, postId);
  const locale = (post.locale || post.ownerLocale || "en").replace(/_/g, "-");
  logger.info(
    `post fetched postId=${postId} locale=${locale} author=${post.ownerNickname} content=${truncateForLog(
      post.content,
      50,
    )}`,
  );
  const promptTpl = readPrompt("post-summary", locale, "en");
  const postText = truncateText(post.content, Config.AI_SUMMARY_POST_TEXT_LIMIT);
  const postJsonObj = {
    locale,
    nickname: post.ownerNickname,
    content: postText,
  };
  const postJson = JSON.stringify(postJsonObj, null, 2).replaceAll(/{{[A-Z_]+}}/g, "");
  let maxChars = Config.AI_SUMMARY_SUMMARY_LENGTH;
  let tagChars = Config.AI_TAG_MAX_LENGTH;
  if (
    locale === "ja" ||
    locale.startsWith("ja-") ||
    locale === "zh" ||
    locale.startsWith("zh-") ||
    locale === "ko" ||
    locale.startsWith("ko-")
  ) {
    maxChars *= 0.5;
    tagChars *= 0.5;
  }
  if (postText.length < maxChars * 1.2) {
    maxChars = Math.ceil(Math.max(postText.length * 0.8, maxChars / 4) / 10) * 10;
  }
  let localeText = locale;
  if (locale === "en" || locale.startsWith("en-")) localeText = `English (${locale})`;
  if (locale === "ja" || locale.startsWith("ja-")) localeText = `日本語（${locale}）`;
  const prompt = promptTpl
    .replaceAll("{{POST_JSON}}", postJson)
    .replaceAll("{{MAX_CHARS}}", String(maxChars))
    .replaceAll("{{TAG_CHARS}}", String(tagChars))
    .replaceAll("{{TAG_NUM}}", String(Config.AI_TAG_MAX_COUNT))
    .replaceAll("{{LOCALE}}", localeText);

  // for debug
  console.log("--- REQ\n" + prompt);

  const chatReq: ChatRequest = {
    model: Config.AI_SUMMARY_MODEL,
    messages: [{ role: "user", content: prompt }],
  };
  const chatRes = await apiRequest(sessionCookie, `/ai-users/chat`, {
    method: "POST",
    body: chatReq,
  });
  const chatJson = JSON.parse(chatRes.body) as ChatResponse;
  const aiContent = chatJson.message.content;
  if (typeof aiContent !== "string" || aiContent.trim() === "") {
    throw new Error(`ai-users/chat returned empty content for postId=${postId}`);
  }

  // for debug
  console.log("--- RES\n" + aiContent);

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
  const summary = truncateText(obj.summary, Config.AI_SUMMARY_SUMMARY_TEXT_LIMIT);
  const tags = parseTagsField(obj.tags, Config.AI_TAG_MAX_COUNT);
  logger.info(
    `parsed result postId=${postId} summary=${truncateForLog(summary, 50)} tags=${tags.join(",")}`,
  );
  const postSnippet = truncateText(
    makeTextFromMarkdown(post.content).replace(/\s+/, " ").trim(),
    Config.AI_SUMMARY_SUMMARY_LENGTH,
  );
  const featuresInput = buildFeaturesInput(summary, tags, postSnippet);

  // for debug
  console.log("--- FEAT\n" + featuresInput);

  const feat = await generateFeaturesViaBackend(sessionCookie, {
    model: Config.AI_SUMMARY_MODEL,
    input: featuresInput,
  });
  const pkt: UpdateAiPostSummaryPacket = { postId, summary, tags, features: feat.features };
  await postSummaryResult(sessionCookie, postId, {
    summary: pkt.summary ?? "",
    tags: pkt.tags ?? [],
    features: pkt.features ?? "",
  });
  logger.info(`summary saved postId=${postId}`);
}

async function processLoop(): Promise<void> {
  while (!shuttingDown) {
    let sessionCookie: string;
    try {
      sessionCookie = await loginAsAdmin();
    } catch (e) {
      logger.error(`loginAsAdmin error: ${e}`);
      await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
      continue;
    }
    let summaries: PendingAiPostSummaryPacket[] = [];
    try {
      summaries = await fetchPendingSummaries(sessionCookie);
    } catch (e) {
      logger.error(`fetchPendingSummaries error: ${e}`);
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
            logger.warn(`401 while summarizing postId=${postId}; will relogin`);
            return;
          }
          logger.error(`error summarizing postId=${postId}: ${e}`);
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
    logger.info("OPENAI_API_KEY is not set so do nothing.");
    await idleLoop();
  }
}

main().catch((e) => {
  logger.error(`Fatal error: ${e}`);
  process.exit(1);
});
