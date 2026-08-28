import type { Pool, PoolClient } from "pg";
import type Redis from "ioredis";
import { Config } from "../config";
import type { PubComment, PubCommentOrder, PubCommentStatus } from "../models/pubComment";
import type { AuthenticatedUser } from "../models/session";
import type { PubCommentsMode } from "../models/user";
import { IdIssueService } from "./idIssue";
import { EventLogService } from "./eventLog";
import { CaptchaService } from "./captcha";
import { getPubCommentsMode, parsePubConfigExtensions } from "../utils/pubConfigExtensions";
import { normalizePubCommentBody, normalizePubCommentNickname } from "../utils/pubCommentNormalize";
import { decToHex, hexToDec } from "../utils/format";
import { pgQuery } from "../utils/servers";

export const PUB_COMMENT_PAGE_SIZE = 10;
export const PUB_COMMENT_CAPTCHA_PURPOSE = "pub-comment";
const PUB_COMMENT_PUBLIC_CACHE_RECENT_TTL_SECONDS = 180;
const PUB_COMMENT_PUBLIC_CACHE_OLD_TTL_SECONDS = 60;
const PUB_COMMENT_PUBLIC_CACHE_RECENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PubCommentFailureCode =
  | "invalid_input"
  | "not_found"
  | "comments_disabled"
  | "comment_limit_reached"
  | "captcha_required"
  | "captcha_invalid"
  | "forbidden";

export class PubCommentError extends Error {
  constructor(
    public readonly code: PubCommentFailureCode,
    message: string,
  ) {
    super(message);
  }
}

type PostState = {
  postId: string;
  ownerId: string;
  allowReplies: boolean;
  mode: PubCommentsMode;
  createdAt: string;
};

type PublicListResult = {
  comments: PubComment[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  limitReached: boolean;
};

type FormState = {
  captchaRequired: boolean;
  nickname: string;
  canPostAsAuthor: boolean;
  asAuthor: boolean;
  canPost: boolean;
  limitReached: boolean;
};

type CreateInput = {
  postId: string;
  nickname: unknown;
  body: unknown;
  asAuthor: boolean;
  challengeId?: string;
  captchaAnswer?: string;
  currentUser: AuthenticatedUser | null;
  passToken?: string;
  clientIp: string;
};

type CreateResult = {
  comment: PubComment;
  newPassToken?: string;
  passTokenInvalidated: boolean;
  asAuthorPreference?: boolean;
};

export class PubCommentsService {
  private readonly idIssueService = new IdIssueService(Config.ID_ISSUE_WORKER_ID);
  private readonly captchaService: CaptchaService;

  constructor(
    private readonly pgPool: Pool,
    private readonly redis: Redis,
    private readonly eventLogService?: EventLogService,
  ) {
    this.captchaService = new CaptchaService(redis);
  }

  async listPublic(
    postId: string,
    page: number,
    order: PubCommentOrder,
    currentUser: AuthenticatedUser | null = null,
  ): Promise<PublicListResult> {
    const state = await this.requirePublicCommentState(postId);
    const canManage = currentUser?.isAdmin === true || currentUser?.id === state.ownerId;
    const normalizedPage = normalizePage(page);
    if (!canManage) {
      const cached = await this.getCachedPublicList(state.postId, normalizedPage, order);
      if (cached) return cached;
    }

    const offset = (normalizedPage - 1) * PUB_COMMENT_PAGE_SIZE;
    const direction = order === "oldest" ? "ASC" : "DESC";
    const statusFilter = canManage ? "" : " AND status = 'published'";
    const res = await pgQuery<{
      id: string;
      post_id: string;
      nickname: string;
      body: string;
      status: PubCommentStatus;
      is_author: boolean;
    }>(
      this.pgPool,
      `SELECT id, post_id, nickname, body, status, is_author
         FROM post_pub_comments
        WHERE post_id = $1${statusFilter}
        ORDER BY id ${direction}
        OFFSET $2 LIMIT $3`,
      [hexToDec(state.postId), offset, PUB_COMMENT_PAGE_SIZE + 1],
    );
    const hasNext = res.rows.length > PUB_COMMENT_PAGE_SIZE;
    const rows = hasNext ? res.rows.slice(0, PUB_COMMENT_PAGE_SIZE) : res.rows;
    const totalCount = await this.countComments(state.postId);
    const result: PublicListResult = {
      comments: rows.map(rowToComment),
      page: normalizedPage,
      hasPrevious: normalizedPage > 1,
      hasNext,
      limitReached: totalCount >= Config.PUB_COMMENT_MAX_COMMENTS,
    };
    if (!canManage) {
      await this.cachePublicList(state.postId, normalizedPage, order, result, state.createdAt);
    }
    return result;
  }

  async getFormState(input: {
    postId: string;
    currentUser: AuthenticatedUser | null;
    passToken?: string;
    clientIp: string;
    savedNickname?: string;
    savedAsAuthor?: boolean;
  }): Promise<FormState> {
    const state = await this.requirePublicCommentState(input.postId);
    const ownerLoggedIn = input.currentUser?.id === state.ownerId;
    const canPostAsAuthor = ownerLoggedIn && input.currentUser?.isFrozen !== true;
    const count = await this.countComments(state.postId);
    const limitReached = count >= Config.PUB_COMMENT_MAX_COMMENTS;
    let nickname = "";
    if (input.savedNickname) {
      try {
        nickname = normalizePubCommentNickname(input.savedNickname);
      } catch {
        nickname = "";
      }
    }
    let captchaRequired = false;
    if (!limitReached && !ownerLoggedIn) {
      const passStatus = await this.captchaService.getPassTokenStatus(
        PUB_COMMENT_CAPTCHA_PURPOSE,
        input.passToken,
        input.clientIp,
      );
      captchaRequired = !passStatus.valid;
    }
    return {
      captchaRequired,
      nickname,
      canPostAsAuthor,
      asAuthor: canPostAsAuthor && (input.savedAsAuthor ?? true),
      canPost: !limitReached,
      limitReached,
    };
  }

  async create(input: CreateInput): Promise<CreateResult> {
    const postId = normalizeId(input.postId, "postId");
    const initialState = await this.requirePublicCommentState(postId);
    const { nickname, body } = normalizeCreateInput(input.nickname, input.body);
    const ownerLoggedIn = input.currentUser?.id === initialState.ownerId;
    const canPostAsAuthor = ownerLoggedIn && input.currentUser?.isFrozen !== true;
    if (input.asAuthor && !canPostAsAuthor) {
      throw new PubCommentError("forbidden", "as author is not allowed");
    }

    if ((await this.countComments(postId)) >= Config.PUB_COMMENT_MAX_COMMENTS) {
      throw new PubCommentError("comment_limit_reached", "comment limit reached");
    }

    let usedExistingPass = false;
    let solvedChallenge = false;
    if (!ownerLoggedIn) {
      const passStatus = await this.captchaService.getPassTokenStatus(
        PUB_COMMENT_CAPTCHA_PURPOSE,
        input.passToken,
        input.clientIp,
      );
      if (passStatus.valid) {
        usedExistingPass = true;
      } else {
        if (!input.challengeId || !input.captchaAnswer) {
          throw new PubCommentError("captcha_required", "captcha required");
        }
        const challengeId = input.challengeId.trim();
        const captchaAnswer = input.captchaAnswer.trim();
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(challengeId) || !/^\d{6}$/.test(captchaAnswer)) {
          throw new PubCommentError("captcha_invalid", "invalid captcha");
        }
        const passed = await this.captchaService.verifyChallenge(
          PUB_COMMENT_CAPTCHA_PURPOSE,
          challengeId,
          captchaAnswer,
        );
        if (!passed) throw new PubCommentError("captcha_invalid", "invalid captcha");
        solvedChallenge = true;
      }
    }

    const id = await this.idIssueService.issueId();
    let status: PubCommentStatus;
    let ownerVerified = ownerLoggedIn;
    let passUseReserved = false;
    const client = await this.pgPool.connect();
    try {
      await client.query("BEGIN");
      const locked = await this.loadPostState(client, postId, true);
      if (!locked) throw new PubCommentError("not_found", "publication not found");
      this.assertCommentsEnabled(locked);
      const stillOwner = input.currentUser?.id === locked.ownerId;
      ownerVerified = stillOwner;
      if (ownerLoggedIn && !stillOwner) {
        throw new PubCommentError("captcha_required", "captcha required");
      }
      if (input.asAuthor && (!stillOwner || input.currentUser?.isFrozen === true)) {
        throw new PubCommentError("forbidden", "as author is not allowed");
      }
      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM post_pub_comments WHERE post_id = $1`,
        [hexToDec(postId)],
      );
      const count = Number(countRes.rows[0]?.count ?? "0");
      if (count >= Config.PUB_COMMENT_MAX_COMMENTS) {
        throw new PubCommentError("comment_limit_reached", "comment limit reached");
      }
      if (usedExistingPass) {
        passUseReserved = await this.captchaService.reservePassTokenUse(
          PUB_COMMENT_CAPTCHA_PURPOSE,
          input.passToken,
          input.clientIp,
        );
        if (!passUseReserved) {
          throw new PubCommentError("captcha_required", "captcha required");
        }
      }
      status = locked.mode === "open" || stillOwner ? "published" : "pending";
      await client.query(
        `INSERT INTO post_pub_comments (id, post_id, nickname, body, status, is_author)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [hexToDec(id), hexToDec(postId), nickname, body, status, input.asAuthor],
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (passUseReserved) {
        try {
          await this.captchaService.releasePassTokenUse(
            PUB_COMMENT_CAPTCHA_PURPOSE,
            input.passToken,
          );
        } catch {}
      }
      throw error;
    } finally {
      client.release();
    }

    await this.invalidatePublicListCache(postId);

    let newPassToken: string | undefined;
    let passTokenInvalidated = false;
    if (passUseReserved) {
      try {
        const committed = await this.captchaService.commitPassTokenUse(
          PUB_COMMENT_CAPTCHA_PURPOSE,
          input.passToken,
        );
        passTokenInvalidated = committed !== "valid";
        if (committed === "invalid") {
          try {
            await this.captchaService.revokePassToken(PUB_COMMENT_CAPTCHA_PURPOSE, input.passToken);
          } catch {}
        }
      } catch {
        passTokenInvalidated = true;
        try {
          await this.captchaService.revokePassToken(PUB_COMMENT_CAPTCHA_PURPOSE, input.passToken);
        } catch {}
      }
    }
    if (!ownerLoggedIn && solvedChallenge) {
      try {
        // This comment itself is the first successful use of the newly issued pass.
        newPassToken = await this.captchaService.issuePassToken(
          PUB_COMMENT_CAPTCHA_PURPOSE,
          input.clientIp,
          1,
        );
      } catch {
        // The comment is already committed. Failure to issue the convenience pass must not
        // turn a successful submission into an HTTP error.
        newPassToken = undefined;
      }
    }

    const comment: PubComment = {
      id,
      postId,
      nickname,
      body,
      status: status!,
      isAuthor: input.asAuthor,
      createdAt: IdIssueService.bigIntToDate(BigInt(hexToDec(id))).toISOString(),
    };

    if (!ownerVerified && this.eventLogService) {
      try {
        await this.eventLogService.recordPubComment({
          postId,
          commentId: id,
          commenterNickname: nickname,
        });
      } catch {}
    }

    return {
      comment,
      newPassToken,
      passTokenInvalidated,
      asAuthorPreference: canPostAsAuthor ? input.asAuthor : undefined,
    };
  }

  async approve(commentId: string, currentUser: AuthenticatedUser): Promise<PubComment> {
    const id = normalizeId(commentId, "commentId");
    const info = await this.getCommentWithOwner(id);
    if (!info) throw new PubCommentError("not_found", "comment not found");
    if (!currentUser.isAdmin && currentUser.id !== info.ownerId) {
      throw new PubCommentError("forbidden", "forbidden");
    }
    if (info.comment.status !== "pending") {
      throw new PubCommentError("invalid_input", "comment is not pending");
    }
    await pgQuery(this.pgPool, `UPDATE post_pub_comments SET status = 'published' WHERE id = $1`, [
      hexToDec(id),
    ]);
    await this.invalidatePublicListCache(info.comment.postId);
    return { ...info.comment, status: "published" };
  }

  async editAuthorComment(
    commentId: string,
    currentUser: AuthenticatedUser,
    input: { nickname: unknown; body: unknown },
  ): Promise<PubComment> {
    const id = normalizeId(commentId, "commentId");
    const info = await this.getCommentWithOwner(id);
    if (!info) throw new PubCommentError("not_found", "comment not found");
    const ownerMayEdit = currentUser.id === info.ownerId && info.comment.isAuthor;
    if (!currentUser.isAdmin && !ownerMayEdit) {
      throw new PubCommentError("forbidden", "forbidden");
    }
    const { nickname, body } = normalizeCreateInput(input.nickname, input.body);
    await pgQuery(this.pgPool, `UPDATE post_pub_comments SET nickname = $2, body = $3 WHERE id = $1`, [
      hexToDec(id),
      nickname,
      body,
    ]);
    await this.invalidatePublicListCache(info.comment.postId);
    return { ...info.comment, nickname, body };
  }

  async delete(commentId: string, currentUser: AuthenticatedUser): Promise<void> {
    const id = normalizeId(commentId, "commentId");
    const info = await this.getCommentWithOwner(id);
    if (!info) throw new PubCommentError("not_found", "comment not found");
    if (!currentUser.isAdmin && currentUser.id !== info.ownerId) {
      throw new PubCommentError("forbidden", "forbidden");
    }
    await pgQuery(this.pgPool, `DELETE FROM post_pub_comments WHERE id = $1`, [hexToDec(id)]);
    await this.invalidatePublicListCache(info.comment.postId);
  }

  private async getCachedPublicList(
    postId: string,
    page: number,
    order: PubCommentOrder,
  ): Promise<PublicListResult | null> {
    try {
      const raw = await this.redis.hget(
        publicListCacheKey(postId),
        publicListCacheField(page, order),
      );
      return parseCachedPublicList(raw);
    } catch {
      return null;
    }
  }

  private async cachePublicList(
    postId: string,
    page: number,
    order: PubCommentOrder,
    result: PublicListResult,
    postCreatedAt: string,
  ): Promise<void> {
    try {
      const key = publicListCacheKey(postId);
      await this.redis.hset(key, publicListCacheField(page, order), JSON.stringify(result));
      await this.redis.expire(key, pubCommentPublicCacheTtlSeconds(postCreatedAt));
    } catch {}
  }

  private async invalidatePublicListCache(postId: string): Promise<void> {
    try {
      await this.redis.del(publicListCacheKey(postId));
    } catch {}
  }

  private async countComments(postId: string): Promise<number> {
    const res = await pgQuery<{ count: string }>(
      this.pgPool,
      `SELECT COUNT(*)::text AS count FROM post_pub_comments WHERE post_id = $1`,
      [hexToDec(postId)],
    );
    return Number(res.rows[0]?.count ?? "0");
  }

  private async requirePublicCommentState(postId: string): Promise<PostState> {
    const normalized = normalizeId(postId, "postId");
    const state = await this.loadPostState(this.pgPool, normalized, false);
    if (!state) throw new PubCommentError("not_found", "publication not found");
    this.assertCommentsEnabled(state);
    return state;
  }

  private assertCommentsEnabled(state: PostState): void {
    if (!state.allowReplies || state.mode === "none") {
      throw new PubCommentError("comments_disabled", "comments are disabled");
    }
  }

  private async loadPostState(
    db: Pool | PoolClient,
    postId: string,
    lock: boolean,
  ): Promise<PostState | null> {
    const res = await db.query<{
      id: string;
      owned_by: string;
      allow_replies: boolean;
      extensions: string | null;
      created_at: string;
    }>(
      `SELECT p.id, p.owned_by, p.allow_replies, upc.extensions, id_to_timestamp(p.id) AS created_at
         FROM posts p
         LEFT JOIN user_pub_configs upc ON upc.user_id = p.owned_by
        WHERE p.id = $1
          AND p.published_at IS NOT NULL
          AND p.published_at <= now()
        ${lock ? "FOR UPDATE OF p" : ""}`,
      [hexToDec(postId)],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    let mode: PubCommentsMode = "none";
    if (typeof row.extensions === "string") {
      mode = getPubCommentsMode(parsePubConfigExtensions(row.extensions));
    }
    return {
      postId: decToHex(row.id),
      ownerId: decToHex(row.owned_by),
      allowReplies: row.allow_replies,
      mode,
      createdAt: row.created_at,
    };
  }

  private async getCommentWithOwner(
    commentId: string,
  ): Promise<{ comment: PubComment; ownerId: string } | null> {
    const res = await pgQuery<{
      id: string;
      post_id: string;
      nickname: string;
      body: string;
      status: PubCommentStatus;
      is_author: boolean;
      owned_by: string;
    }>(
      this.pgPool,
      `SELECT c.id, c.post_id, c.nickname, c.body, c.status, c.is_author, p.owned_by
         FROM post_pub_comments c
         JOIN posts p ON p.id = c.post_id
        WHERE c.id = $1`,
      [hexToDec(commentId)],
    );
    if (res.rows.length === 0) return null;
    return {
      comment: rowToComment(res.rows[0]!),
      ownerId: decToHex(res.rows[0]!.owned_by),
    };
  }
}


function pubCommentPublicCacheTtlSeconds(createdAt: string, nowMs = Date.now()): number {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return PUB_COMMENT_PUBLIC_CACHE_OLD_TTL_SECONDS;
  return nowMs - createdAtMs <= PUB_COMMENT_PUBLIC_CACHE_RECENT_AGE_MS
    ? PUB_COMMENT_PUBLIC_CACHE_RECENT_TTL_SECONDS
    : PUB_COMMENT_PUBLIC_CACHE_OLD_TTL_SECONDS;
}

function publicListCacheKey(postId: string): string {
  return `post-pub-comments:public:${postId}`;
}

function publicListCacheField(page: number, order: PubCommentOrder): string {
  return `${order}:${page}`;
}

function parseCachedPublicList(raw: string | null): PublicListResult | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<PublicListResult>;
    if (
      !Array.isArray(value.comments) ||
      !Number.isInteger(value.page) ||
      typeof value.hasPrevious !== "boolean" ||
      typeof value.hasNext !== "boolean" ||
      typeof value.limitReached !== "boolean"
    ) {
      return null;
    }
    return value as PublicListResult;
  } catch {
    return null;
  }
}

function normalizeCreateInput(nickname: unknown, body: unknown): { nickname: string; body: string } {
  try {
    return {
      nickname: normalizePubCommentNickname(nickname),
      body: normalizePubCommentBody(body),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid comment";
    throw new PubCommentError("invalid_input", message);
  }
}

function normalizePage(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function normalizeId(value: string, name: string): string {
  try {
    return decToHex(hexToDec(value));
  } catch {
    throw new PubCommentError("invalid_input", `invalid ${name}`);
  }
}

function rowToComment(row: {
  id: string;
  post_id: string;
  nickname: string;
  body: string;
  status: PubCommentStatus;
  is_author: boolean;
}): PubComment {
  const id = decToHex(row.id);
  return {
    id,
    postId: decToHex(row.post_id),
    nickname: row.nickname,
    body: row.body,
    status: row.status,
    isAuthor: row.is_author,
    createdAt: IdIssueService.bigIntToDate(BigInt(row.id)).toISOString(),
  };
}
