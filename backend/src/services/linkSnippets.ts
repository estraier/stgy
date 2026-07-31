import crypto from "node:crypto";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { Config } from "../config";
import type { LinkSnippet, LinkSnippetStatus } from "../models/linkSnippet";
import { PostsService } from "./posts";
import { UsersService } from "./users";
import { makeTextFromMarkdown } from "../utils/snippet";
import {
  classifyFrontendUrl,
  type InternalLinkTarget,
  extractLinkSnippetMetadata,
  makeMarkdownLinkSnippetMetadata,
  normalizeLinkSnippetUrl,
  truncateSnippetText,
} from "../utils/linkSnippet";
import { fetchRemoteHtml } from "../utils/remoteHtml";
import { createLogger } from "../utils/logger";

const logger = createLogger({ file: "linkSnip" });
const CACHE_PREFIX = "stgy:link-snippet:";
const CACHE_VERSION = "v1";
const STGY_SITE_NAME = "STGY";

type CachedLinkSnippetStatus = Exclude<LinkSnippetStatus, "pending">;

type LinkSnippetCacheKeys = {
  cache: string;
  lock: string;
  backoff: string;
};

type CachedLinkSnippet = {
  url: string;
  status: CachedLinkSnippetStatus;
  title: string | null;
  description: string | null;
  siteName: string | null;
  fetchedAt: string;
  expiresAt: string;
};

export class LinkSnippetInputError extends Error {}
export class LinkSnippetRateLimitError extends Error {}

export class LinkSnippetsService {
  private usersService: UsersService;
  private postsService: PostsService;

  constructor(
    pgPool: Pool,
    private redis: Redis,
  ) {
    this.usersService = new UsersService(pgPool, redis);
    this.postsService = new PostsService(pgPool, redis);
  }

  async resolve(urlText: string, actorKey: string, viewerUserId?: string): Promise<LinkSnippet> {
    let url: URL;
    try {
      url = normalizeLinkSnippetUrl(urlText);
    } catch (error) {
      throw new LinkSnippetInputError(error instanceof Error ? error.message : "invalid url");
    }

    const classification = classifyFrontendUrl(url, Config.FRONTEND_ORIGIN);
    if (classification.kind === "unsupported_internal") {
      throw new LinkSnippetInputError("self url path is not supported");
    }
    if (classification.kind === "internal") {
      return this.resolveInternal(url, classification.target, viewerUserId);
    }
    return this.resolveExternal(url, actorKey);
  }

  private async resolveInternal(
    url: URL,
    target: InternalLinkTarget,
    viewerUserId?: string,
  ): Promise<LinkSnippet> {
    const now = new Date().toISOString();
    const unavailable = (siteName = STGY_SITE_NAME): LinkSnippet => ({
      url: url.toString(),
      status: "unavailable",
      title: null,
      description: null,
      siteName: truncateSnippetText(siteName, Config.LINK_SNIPPET_SITE_NAME_LENGTH_LIMIT) || null,
      fetchedAt: now,
      expiresAt: null,
      stale: false,
      refreshing: false,
    });

    if (target.kind === "user") {
      if (!viewerUserId) return unavailable();
      const user = await this.usersService.getUser(target.id, viewerUserId);
      if (!user || user.isBlockingFocusUser) return unavailable();
      const title = truncateSnippetText(user.nickname, Config.LINK_SNIPPET_TITLE_LENGTH_LIMIT);
      const description = truncateSnippetText(
        makeTextFromMarkdown(user.introduction),
        Config.LINK_SNIPPET_DESCRIPTION_LENGTH_LIMIT,
      );
      return {
        url: url.toString(),
        status: title ? "ready" : "unavailable",
        title: title || null,
        description: description || null,
        siteName: STGY_SITE_NAME,
        fetchedAt: now,
        expiresAt: null,
        stale: false,
        refreshing: false,
      };
    }

    const isPublic = target.kind === "pub";
    if (!isPublic && !viewerUserId) return unavailable();
    const post = isPublic
      ? await this.postsService.getPubPost(target.id, now)
      : await this.postsService.getPost(target.id, viewerUserId);
    if (!post || (!isPublic && post.isBlockingFocusUser)) return unavailable();

    const extracted = makeMarkdownLinkSnippetMetadata(post.content, {
      title: Config.LINK_SNIPPET_TITLE_LENGTH_LIMIT,
      description: Config.LINK_SNIPPET_DESCRIPTION_LENGTH_LIMIT,
    });
    const dateText = post.publishedAt ?? post.createdAt;
    const fallbackTitle = `POST@${dateText.slice(0, 10)}`;
    const title = extracted.title || truncateSnippetText(
      fallbackTitle,
      Config.LINK_SNIPPET_TITLE_LENGTH_LIMIT,
    );
    let siteName = STGY_SITE_NAME;
    if (isPublic) {
      const pubConfig = await this.usersService.getPubConfig(post.ownedBy);
      siteName = pubConfig.siteName.trim() || STGY_SITE_NAME;
    }

    return {
      url: url.toString(),
      status: title ? "ready" : "unavailable",
      title: title || null,
      description: extracted.description,
      siteName: truncateSnippetText(siteName, Config.LINK_SNIPPET_SITE_NAME_LENGTH_LIMIT) || null,
      fetchedAt: now,
      expiresAt: null,
      stale: false,
      refreshing: false,
    };
  }

  private async resolveExternal(url: URL, actorKey: string): Promise<LinkSnippet> {
    const normalizedUrl = url.toString();
    const keys = this.makeKeys(normalizedUrl);
    const cached = await this.readCache(keys.cache);
    const nowMs = Date.now();

    if (cached && Date.parse(cached.expiresAt) > nowMs) {
      return this.present(cached, false, false);
    }

    if (cached) {
      if (await this.redis.exists(keys.backoff)) {
        return this.present(cached, true, false);
      }
      const lockToken = await this.acquireLock(keys.lock);
      if (lockToken) {
        void this.runBackgroundRefresh(normalizedUrl, actorKey, keys, lockToken);
        return this.present(cached, true, true);
      }
      return this.present(cached, true, true);
    }

    const lockToken = await this.acquireLock(keys.lock);
    if (!lockToken) {
      const waited = await this.waitForCache(keys.cache, 2000);
      if (waited) return this.present(waited, false, false);
      return {
        url: normalizedUrl,
        status: "pending",
        title: null,
        description: null,
        siteName: truncateSnippetText(url.hostname, Config.LINK_SNIPPET_SITE_NAME_LENGTH_LIMIT) || null,
        fetchedAt: null,
        expiresAt: null,
        stale: false,
        refreshing: true,
      };
    }

    try {
      const result = await this.refreshExternal(normalizedUrl, actorKey, keys, false);
      return this.present(result, false, false);
    } finally {
      try {
        await this.releaseLock(keys.lock, lockToken);
      } catch (releaseError) {
        logger.warn(
          `[link-snippet] failed to release resolve lock: ${
            releaseError instanceof Error ? releaseError.message : String(releaseError)
          }`,
        );
      }
    }
  }

  private async runBackgroundRefresh(
    normalizedUrl: string,
    actorKey: string,
    keys: LinkSnippetCacheKeys,
    lockToken: string,
  ): Promise<void> {
    try {
      await this.refreshExternal(normalizedUrl, actorKey, keys, true);
    } catch (error) {
      try {
        await this.handleBackgroundFailure(keys, error);
      } catch (backoffError) {
        logger.warn(
          `[link-snippet] failed to record refresh backoff: ${
            backoffError instanceof Error ? backoffError.message : String(backoffError)
          }`,
        );
      }
    } finally {
      try {
        await this.releaseLock(keys.lock, lockToken);
      } catch (releaseError) {
        logger.warn(
          `[link-snippet] failed to release refresh lock: ${
            releaseError instanceof Error ? releaseError.message : String(releaseError)
          }`,
        );
      }
    }
  }

  private async refreshExternal(
    normalizedUrl: string,
    actorKey: string,
    keys: LinkSnippetCacheKeys,
    preserveExistingOnFailure: boolean,
  ): Promise<CachedLinkSnippet> {
    if (!(await this.consumeLimit(
      `client:${this.hash(actorKey)}`,
      Config.LINK_SNIPPET_CLIENT_FETCH_LIMIT_PER_HOUR,
      3600,
    ))) {
      throw new LinkSnippetRateLimitError("too many link snippet requests");
    }

    const initialUrl = new URL(normalizedUrl);
    try {
      const fetched = await fetchRemoteHtml(initialUrl, {
        frontendOrigins: Config.FRONTEND_ORIGIN,
        maxBytes: Config.LINK_SNIPPET_MAX_HTML_BYTES,
        timeoutMs: Config.LINK_SNIPPET_FETCH_TIMEOUT_MS,
        maxRedirects: Config.LINK_SNIPPET_MAX_REDIRECTS,
        beforeRequest: async ({ url, selectedAddress }) => {
          const allowed = await Promise.all([
            this.consumeLimit(
              "global",
              Config.LINK_SNIPPET_GLOBAL_FETCH_LIMIT_PER_MIN,
              60,
            ),
            this.consumeLimit(
              `host:${this.hash(url.hostname.toLowerCase())}`,
              Config.LINK_SNIPPET_HOST_FETCH_LIMIT_PER_MIN,
              60,
            ),
            this.consumeLimit(
              `address:${this.hash(selectedAddress.address)}`,
              Config.LINK_SNIPPET_ADDRESS_FETCH_LIMIT_PER_MIN,
              60,
            ),
          ]);
          if (allowed.some((value) => !value)) {
            throw new LinkSnippetRateLimitError("link snippet fetch rate limit exceeded");
          }
        },
      });

      const limits = {
        title: Config.LINK_SNIPPET_TITLE_LENGTH_LIMIT,
        description: Config.LINK_SNIPPET_DESCRIPTION_LENGTH_LIMIT,
        siteName: Config.LINK_SNIPPET_SITE_NAME_LENGTH_LIMIT,
      };
      const metadata = fetched.html
        ? extractLinkSnippetMetadata(fetched.html, fetched.finalUrl.hostname, limits)
        : {
            title: null,
            description: null,
            siteName:
              truncateSnippetText(fetched.finalUrl.hostname, limits.siteName) || null,
          };
      const record = this.makeCacheRecord(
        normalizedUrl,
        metadata.title ? "ready" : "unavailable",
        metadata.title,
        metadata.description,
        metadata.siteName,
        Config.LINK_SNIPPET_TTL_SEC,
      );
      await this.writeCache(
        keys.cache,
        record,
        Math.max(Config.LINK_SNIPPET_TTL_SEC, Config.LINK_SNIPPET_STALE_TTL_SEC),
      );
      await this.redis.del(keys.backoff);
      return record;
    } catch (error) {
      if (error instanceof LinkSnippetRateLimitError) throw error;
      logger.warn(
        `[link-snippet] fetch failed for ${initialUrl.hostname}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (preserveExistingOnFailure) throw error;
      const record = this.makeCacheRecord(
        normalizedUrl,
        "fetch_failed",
        null,
        null,
        truncateSnippetText(initialUrl.hostname, Config.LINK_SNIPPET_SITE_NAME_LENGTH_LIMIT) || null,
        Config.LINK_SNIPPET_FAILURE_TTL_SEC,
      );
      await this.writeCache(keys.cache, record, Config.LINK_SNIPPET_FAILURE_TTL_SEC);
      return record;
    }
  }

  private async handleBackgroundFailure(
    keys: LinkSnippetCacheKeys,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[link-snippet] background refresh skipped: ${message}`);
    await this.redis.setex(keys.backoff, Config.LINK_SNIPPET_FAILURE_TTL_SEC, "1");
  }

  private makeCacheRecord(
    url: string,
    status: CachedLinkSnippetStatus,
    title: string | null,
    description: string | null,
    siteName: string | null,
    ttlSec: number,
  ): CachedLinkSnippet {
    const now = Date.now();
    return {
      url,
      status,
      title,
      description,
      siteName,
      fetchedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(1, ttlSec) * 1000).toISOString(),
    };
  }

  private present(
    record: CachedLinkSnippet,
    stale: boolean,
    refreshing: boolean,
  ): LinkSnippet {
    return { ...record, stale, refreshing };
  }

  private makeKeys(url: string): LinkSnippetCacheKeys {
    const digest = this.hash(url);
    const base = `${CACHE_PREFIX}${CACHE_VERSION}:${digest}`;
    return {
      cache: `${base}:value`,
      lock: `${base}:lock`,
      backoff: `${base}:backoff`,
    };
  }

  private hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private async readCache(key: string): Promise<CachedLinkSnippet | null> {
    const text = await this.redis.get(key);
    if (!text) return null;
    try {
      const value = JSON.parse(text) as Partial<CachedLinkSnippet>;
      if (
        typeof value.url !== "string" ||
        !["ready", "unavailable", "fetch_failed"].includes(String(value.status)) ||
        typeof value.fetchedAt !== "string" ||
        typeof value.expiresAt !== "string"
      ) {
        return null;
      }
      return {
        url: value.url,
        status: value.status as CachedLinkSnippetStatus,
        title: typeof value.title === "string" ? value.title : null,
        description: typeof value.description === "string" ? value.description : null,
        siteName: typeof value.siteName === "string" ? value.siteName : null,
        fetchedAt: value.fetchedAt,
        expiresAt: value.expiresAt,
      };
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, value: CachedLinkSnippet, ttlSec: number): Promise<void> {
    await this.redis.setex(key, Math.max(1, ttlSec), JSON.stringify(value));
  }

  private async acquireLock(key: string): Promise<string | null> {
    const token = crypto.randomUUID();
    const ttlSec = Math.max(5, Math.ceil(Config.LINK_SNIPPET_FETCH_TIMEOUT_MS / 1000) + 5);
    const result = await this.redis.set(key, token, "EX", ttlSec, "NX");
    return result === "OK" ? token : null;
  }

  private async releaseLock(key: string, token: string): Promise<void> {
    await this.redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      key,
      token,
    );
  }

  private async waitForCache(key: string, timeoutMs: number): Promise<CachedLinkSnippet | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const cached = await this.readCache(key);
      if (cached) return cached;
    }
    return null;
  }

  private async consumeLimit(name: string, limit: number, ttlSec: number): Promise<boolean> {
    if (limit <= 0) return true;
    const safeTtlSec = Math.max(1, Math.floor(ttlSec));
    const window = Math.floor(Date.now() / (safeTtlSec * 1000));
    const key = `${CACHE_PREFIX}limit:${name}:${window}`;
    const result = await this.redis
      .multi()
      .incr(key)
      .expire(key, safeTtlSec * 2)
      .exec();
    const count = Number(result?.[0]?.[1] ?? Number.POSITIVE_INFINITY);
    return Number.isFinite(count) && count <= limit;
  }
}
