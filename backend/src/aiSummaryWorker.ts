import { Config } from "./config";
import { createLogger } from "./utils/logger";
import { readPrompt, evaluateChatResponseAsJson } from "./utils/prompt";
import type { AiPostSummaryPacket, UpdateAiPostSummaryPacket } from "./models/aiPost";
import type { PostDetail } from "./models/post";
import type { ChatRequest, GenerateFeaturesRequest } from "./models/aiUser";
import { AuthService } from "./services/auth";
import { connectPgWithRetry, connectRedisWithRetry } from "./utils/servers";
import { makeTextFromMarkdown } from "./utils/snippet";
import { normalizeOneLiner } from "./utils/format";
import { countPseudoTokens, sliceByPseudoTokens } from "stgy-markdown";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { URLSearchParams } from "url";
import { apiRequest, httpRequest, UnauthorizedError } from "./utils/client";
import { WorkerLifecycle, runIfMain } from "./utils/workerRunner";

const logger = createLogger({ file: "aiSummaryWorker" });
export const lifecycle = new WorkerLifecycle();

let pgPool: Pool | null = null;
let redis: Redis | null = null;
let authService: AuthService | null = null;

const inflight = new Set<Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

async function waitForAiChatAvailability(): Promise<"enabled" | "disabled"> {
  const path = "/ai-users/chat";
  const intervalMs = 3000;
  while (lifecycle.isActive) {
    try {
      const res = await httpRequest(path, { method: "HEAD" });
      if (res.statusCode === 200) {
        logger.info(`ai chat is enabled on server`);
        return "enabled";
      }
      if (res.statusCode === 501) {
        logger.info(`ai chat is disabled on server`);
        return "disabled";
      }
      logger.info(`waiting server... status=${res.statusCode}`);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      logger.info(`waiting server... error=${truncateForLog(msg, 80)}`);
    }
    await sleep(intervalMs);
  }
  throw new Error("shutting down while waiting for server");
}

async function loginAsAdmin(): Promise<string> {
  if (!authService) throw new Error("authService is not initialized");
  const res = await authService.loginAsAdmin();
  const sessionCookie = `session_id=${res.sessionId}`;
  return sessionCookie;
}

async function fetchPendingSummaries(sessionCookie: string): Promise<AiPostSummaryPacket[]> {
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
  const out: AiPostSummaryPacket[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const updatedAtRaw = item["updatedAt"];
    if (typeof updatedAtRaw === "string") {
      const updatedAtMs = Date.parse(updatedAtRaw);
      if (Number.isFinite(updatedAtMs) && updatedAtMs > cutoff) continue;
    }
    out.push(item as AiPostSummaryPacket);
  }
  return out;
}

async function fetchPostDetail(sessionCookie: string, postId: string): Promise<PostDetail> {
  const res = await apiRequest(sessionCookie, `/posts/${encodeURIComponent(postId)}`, {
    method: "GET",
  });
  return JSON.parse(res.body) as PostDetail;
}

function parseTagsField(raw: unknown, maxCount: number): string[] {
  if (!Array.isArray(raw)) return [];
  const baseTags: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    baseTags.push(trimmed);
  }
  const baseSet = new Set<string>();
  for (const tag of baseTags) {
    if (/^\d+:/.test(tag)) {
      const normalized = tag.replace(/^\d+:\s*/, "").trim();
      if (normalized) baseSet.add(normalized);
    } else {
      baseSet.add(tag);
    }
  }
  const adopted: string[] = [];
  for (const tag of baseTags) {
    if (/^\d+:/.test(tag)) {
      const withoutPrefix = tag.replace(/^\d+:\s*/, "").trim();
      const segments = withoutPrefix
        .split(/(?:．|\. )/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (segments.length === 0) continue;
      const matched = segments.filter((s) => baseSet.has(s));
      if (matched.length > 0) {
        adopted.push(...matched);
      } else {
        adopted.push(...segments);
      }
      continue;
    }
    adopted.push(tag);
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const t of adopted) {
    const v = t.trim();
    if (!v) continue;
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    unique.push(v);
  }
  return unique.slice(0, maxCount);
}

function normalizeTerm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = normalizeOneLiner(raw.toLowerCase());
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

function parseKeywordsField(raw: unknown, maxCount: number, tags: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const tagSet = new Set<string>();
  for (const t of tags) {
    const v = normalizeTerm(t);
    if (v) tagSet.add(v);
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const v = normalizeTerm(t);
    if (!v) continue;
    if (tagSet.has(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    unique.push(v);
    if (unique.length >= maxCount) break;
  }
  return unique;
}

async function generateFeatures(
  sessionCookie: string,
  req: GenerateFeaturesRequest,
): Promise<string> {
  const res = await apiRequest(sessionCookie, "/ai-users/features", {
    method: "POST",
    body: { model: req.model, input: req.input },
  });

  const parsed = JSON.parse(res.body) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`features api returned non-object payload: ${truncateForLog(res.body, 50)}`);
  }
  const featuresRaw = parsed["features"];
  if (typeof featuresRaw !== "string" || featuresRaw.trim() === "") {
    throw new Error(`features api returned invalid features: ${truncateForLog(res.body, 50)}`);
  }
  const features = featuresRaw.trim();
  const buf = Buffer.from(features, "base64");
  if (buf.byteLength <= 0) {
    throw new Error(`features api returned empty features: ${truncateForLog(res.body, 50)}`);
  }
  return features;
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

type UpdateAiPostSummaryPutBody = {
  summary: string;
  tags: string[];
  keywords: string[];
  features: string;
};

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

function parseChatContent(body: string): string {
  const parsed = JSON.parse(body) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`chat response is not an object: ${truncateForLog(body, 50)}`);
  }
  const msg = parsed["message"];
  if (!isRecord(msg)) {
    throw new Error(`chat response missing message object: ${truncateForLog(body, 50)}`);
  }
  const content = msg["content"];
  if (typeof content !== "string") {
    throw new Error(`chat response missing content string: ${truncateForLog(body, 50)}`);
  }
  return content;
}

async function summarizePost(sessionCookie: string, postId: string): Promise<void> {
  logger.info(`summarizePost postId=${postId}`);
  const post = await fetchPostDetail(sessionCookie, postId);
  const locale = post.locale || post.ownerLocale || "en";
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
    author: post.ownerNickname,
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

  const chatReq: ChatRequest = {
    model: Config.AI_SUMMARY_MODEL,
    messages: [{ role: "user", content: prompt }],
  };
  const chatRes = await apiRequest(sessionCookie, `/ai-users/chat`, {
    method: "POST",
    body: chatReq,
  });

  const aiContent = parseChatContent(chatRes.body);
  if (aiContent.trim() === "") {
    throw new Error(`ai-users/chat returned empty content for postId=${postId}`);
  }

  const parsed = evaluateChatResponseAsJson<{
    summary?: unknown;
    tags?: unknown;
    keywords?: unknown;
  }>(aiContent);
  if (!isRecord(parsed)) {
    throw new Error(`AI output is not an object: postId=${postId}`);
  }
  const summaryRaw = parsed["summary"];
  const tagsRaw = parsed["tags"];
  const keywordsRaw = parsed["keywords"];
  if (typeof summaryRaw !== "string") {
    throw new Error(`AI output missing summary string: postId=${postId}`);
  }
  const summary = truncateText(summaryRaw, Config.AI_SUMMARY_SUMMARY_TEXT_LIMIT);
  const tags = parseTagsField(tagsRaw, Config.AI_TAG_MAX_COUNT);
  const aiKeywords = parseKeywordsField(keywordsRaw, 10, tags);
  const postTags = Array.isArray(post.tags)
    ? (post.tags as unknown[])
        .map((t) => normalizeTerm(t))
        .filter((t): t is string => typeof t === "string" && t !== "")
    : [];
  const keywords = [...postTags, ...tags, ...aiKeywords].splice(0, Config.AI_SUMMARY_MAX_KEYWORDS);
  logger.info(
    `parsed result postId=${postId} summary=${truncateForLog(summary, 50)} tags=${tags.join(",")} keywords=${aiKeywords.join(",")}`,
  );
  const postSnippet = truncateText(
    makeTextFromMarkdown(post.content).replaceAll(/ +/g, " ").replaceAll(/\n+/g, "\n").trim(),
    Config.AI_SUMMARY_SUMMARY_LENGTH,
  );
  const featuresInput = buildFeaturesInput(summary, keywords, postSnippet);

  const features = await generateFeatures(sessionCookie, {
    model: Config.AI_SUMMARY_MODEL,
    input: featuresInput,
  });
  const pkt: UpdateAiPostSummaryPacket = { postId, summary, tags, keywords, features };
  await postSummaryResult(sessionCookie, postId, {
    summary: pkt.summary ?? "",
    tags: pkt.tags ?? [],
    keywords: pkt.keywords ?? [],
    features: pkt.features ?? "",
  });
  logger.info(`summary saved postId=${postId}`);
}

async function processLoop(): Promise<void> {
  while (lifecycle.isActive) {
    let sessionCookie: string;
    try {
      sessionCookie = await loginAsAdmin();
    } catch (e) {
      logger.error(`loginAsAdmin error: ${e}`);
      await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
      continue;
    }
    let summaries: AiPostSummaryPacket[] = [];
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
    while (index < summaries.length && lifecycle.isActive) {
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
    await sleep(Config.AI_SUMMARY_LOOP_SLEEP_MS);
  }
}

async function idleLoop(): Promise<void> {
  while (lifecycle.isActive) await sleep(Config.AI_SUMMARY_IDLE_SLEEP_MS);
}

async function cleanup() {
  if (inflight.size > 0) await Promise.allSettled(Array.from(inflight));
  const tasks: Promise<unknown>[] = [];
  if (pgPool) tasks.push(pgPool.end());
  if (redis) tasks.push(redis.quit());
  if (tasks.length > 0) await Promise.allSettled(tasks);
}

export async function startAiSummaryWorker() {
  logger.info(`STGY AI summary worker started (concurrency=${Config.AI_SUMMARY_CONCURRENCY})`);
  pgPool = await connectPgWithRetry();
  redis = await connectRedisWithRetry();
  authService = new AuthService(pgPool, redis);

  const avail = await waitForAiChatAvailability();
  if (avail === "enabled") {
    await processLoop();
  } else {
    logger.info("AI is disabled on server so do nothing.");
    await idleLoop();
  }
}

runIfMain(module, startAiSummaryWorker, logger, lifecycle, cleanup);
