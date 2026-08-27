import type { Pool } from "pg";
import type Redis from "ioredis";
import type { AuthenticatedUser } from "../models/session";
import { Config } from "../config";
import { hexToDec } from "../utils/format";
import { PubCommentsService } from "./pubComments";

const POST_ID = "0000000000000100";
const OWNER_ID = "0000000000000020";
const GUEST_ID = "0000000000000030";
const ADMIN_ID = "0000000000000040";

type FakeDbOptions = {
  mode?: "none" | "moderated" | "open";
  allowReplies?: boolean;
  initialCount?: number;
  lockedCount?: number;
  listRows?: Array<{
    id: string;
    post_id: string;
    name: string;
    body: string;
    status: "pending" | "published";
    is_author: boolean;
  }>;
  commentRow?: {
    id: string;
    post_id: string;
    name: string;
    body: string;
    status: "pending" | "published";
    is_author: boolean;
    owned_by: string;
  };
};

function makeDb(options: FakeDbOptions = {}) {
  const mode = options.mode ?? "moderated";
  const allowReplies = options.allowReplies ?? true;
  const initialCount = options.initialCount ?? 0;
  const lockedCount = options.lockedCount ?? initialCount;
  const inserted: unknown[][] = [];
  const updated: unknown[][] = [];
  const listRows = options.listRows ?? [];

  const postRow = {
    id: hexToDec(POST_ID),
    owned_by: hexToDec(OWNER_ID),
    allow_replies: allowReplies,
    extensions: JSON.stringify(mode === "none" ? {} : { comments: { mode } }),
  };

  const poolQuery = jest.fn(async (sql: string) => {
    if (/SELECT p\.id, p\.owned_by, p\.allow_replies, upc\.extensions/i.test(sql)) {
      return { rows: [postRow], rowCount: 1 };
    }
    if (/SELECT id, post_id, name, body, status, is_author\s+FROM pub_comments/i.test(sql)) {
      const rows = /status = 'published'/i.test(sql)
        ? listRows.filter((row) => row.status === "published")
        : listRows;
      return { rows, rowCount: rows.length };
    }
    if (/SELECT c\.id, c\.post_id, c\.name, c\.body, c\.status, c\.is_author, p\.owned_by/i.test(sql)) {
      const row = options.commentRow;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE pub_comments SET name = \$2, body = \$3 WHERE id = \$1/i.test(sql)) {
      updated.push([]);
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE pub_comments SET status = 'published' WHERE id = \$1/i.test(sql)) {
      updated.push([]);
      return { rows: [], rowCount: 1 };
    }
    if (/DELETE FROM pub_comments WHERE id = \$1/i.test(sql)) {
      updated.push([]);
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT COUNT\(\*\)::text AS count FROM pub_comments/i.test(sql)) {
      return { rows: [{ count: String(initialCount) }], rowCount: 1 };
    }
    throw new Error(`unexpected pool query: ${sql}`);
  });

  const clientQuery = jest.fn(async (sql: string, params?: unknown[]) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [], rowCount: null };
    if (/SELECT p\.id, p\.owned_by, p\.allow_replies, upc\.extensions/i.test(sql)) {
      return { rows: [postRow], rowCount: 1 };
    }
    if (/SELECT COUNT\(\*\)::text AS count FROM pub_comments/i.test(sql)) {
      return { rows: [{ count: String(lockedCount) }], rowCount: 1 };
    }
    if (/INSERT INTO pub_comments/i.test(sql)) {
      inserted.push(params ?? []);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected client query: ${sql}`);
  });
  const client = { query: clientQuery, release: jest.fn() };
  const pool = { query: poolQuery, connect: jest.fn(async () => client) } as unknown as Pool;
  return { pool, poolQuery, clientQuery, inserted, updated };
}

function makeRedis(options: { passValid?: boolean; reserveResult?: boolean } = {}) {
  let passState = options.passValid ? "0,0" : null;
  const get = jest.fn(async () => passState);
  const evalFn = jest.fn(async (script: string) => {
    if (script.includes("reserved = reserved + 1")) {
      if (!passState || options.reserveResult === false) return 0;
      const [used, reserved] = passState.split(",").map(Number);
      passState = `${used},${reserved + 1}`;
      return 1;
    }
    if (script.includes("used = used + 1")) {
      if (!passState) return 0;
      let [used, reserved] = passState.split(",").map(Number);
      if (reserved <= 0) return 0;
      used += 1;
      reserved -= 1;
      passState = `${used},${reserved}`;
      return 1;
    }
    if (script.includes("reserved = reserved - 1")) {
      if (!passState) return 0;
      const [used, reserved] = passState.split(",").map(Number);
      passState = `${used},${Math.max(0, reserved - 1)}`;
      return 1;
    }
    return 1;
  });
  const redis = {
    get,
    set: jest.fn(async () => "OK"),
    eval: evalFn,
    del: jest.fn(async () => 1),
  } as unknown as Redis;
  return { redis, get, evalFn };
}

function user(id: string, extra: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id, isAdmin: false, isFrozen: false, ...extra };
}

describe("PubCommentsService", () => {
  test("logged-in article owner bypasses CAPTCHA and as-author publishes immediately", async () => {
    const db = makeDb({ mode: "moderated" });
    const rd = makeRedis();
    const eventLog = { recordPubComment: jest.fn() };
    const service = new PubCommentsService(db.pool, rd.redis, eventLog as any);

    const result = await service.create({
      postId: POST_ID,
      name: " Author ",
      body: "hello",
      asAuthor: true,
      currentUser: user(OWNER_ID),
      passToken: undefined,
    });

    expect(result.comment.status).toBe("published");
    expect(result.comment.isAuthor).toBe(true);
    expect(result.comment.name).toBe("Author");
    expect(result.comment.body).toBe("hello\n");
    expect(rd.get).not.toHaveBeenCalled();
    expect(rd.evalFn).not.toHaveBeenCalled();
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]?.[5]).toBe(true);
    expect(eventLog.recordPubComment).not.toHaveBeenCalled();
  });

  test("logged-in owner may post anonymously without CAPTCHA and moderated comment publishes immediately", async () => {
    const db = makeDb({ mode: "moderated" });
    const rd = makeRedis();
    const eventLog = { recordPubComment: jest.fn(async () => 1n) };
    const service = new PubCommentsService(db.pool, rd.redis, eventLog as any);

    const result = await service.create({
      postId: POST_ID,
      name: "guest name",
      body: "hello",
      asAuthor: false,
      currentUser: user(OWNER_ID),
    });

    expect(result.comment.status).toBe("published");
    expect(result.comment.isAuthor).toBe(false);
    expect(rd.get).not.toHaveBeenCalled();
    expect(eventLog.recordPubComment).not.toHaveBeenCalled();
  });

  test("guest with a valid pass token reserves and commits one use around saving and records notification event", async () => {
    const db = makeDb({ mode: "open" });
    const rd = makeRedis({ passValid: true });
    const eventLog = { recordPubComment: jest.fn(async () => 1n) };
    const service = new PubCommentsService(db.pool, rd.redis, eventLog as any);

    const result = await service.create({
      postId: POST_ID,
      name: "guest",
      body: "hello",
      asAuthor: false,
      currentUser: user(GUEST_ID),
      passToken: "token",
    });

    expect(result.comment.status).toBe("published");
    expect(rd.get).toHaveBeenCalled();
    expect(rd.evalFn).toHaveBeenCalledTimes(2);
    expect(db.inserted).toHaveLength(1);
    expect(eventLog.recordPubComment).toHaveBeenCalledWith(
      expect.objectContaining({ postId: POST_ID, commenterName: "guest" }),
    );
  });

  test("article owner sees pending comments in the public-page list", async () => {
    const db = makeDb({
      listRows: [
        {
          id: hexToDec("0000000000000200"),
          post_id: hexToDec(POST_ID),
          name: "pending guest",
          body: "pending\n",
          status: "pending",
          is_author: false,
        },
        {
          id: hexToDec("0000000000000201"),
          post_id: hexToDec(POST_ID),
          name: "published guest",
          body: "published\n",
          status: "published",
          is_author: false,
        },
      ],
      initialCount: 2,
    });
    const rd = makeRedis();
    const service = new PubCommentsService(db.pool, rd.redis);

    const result = await service.listPublic(POST_ID, 1, "newest", user(OWNER_ID));

    expect(result.comments.map((comment) => comment.status)).toEqual(["pending", "published"]);
  });

  test("administrator sees pending comments for another user's article", async () => {
    const db = makeDb({
      listRows: [
        {
          id: hexToDec("0000000000000200"),
          post_id: hexToDec(POST_ID),
          name: "pending guest",
          body: "pending\n",
          status: "pending",
          is_author: false,
        },
        {
          id: hexToDec("0000000000000201"),
          post_id: hexToDec(POST_ID),
          name: "published guest",
          body: "published\n",
          status: "published",
          is_author: false,
        },
      ],
      initialCount: 2,
    });
    const rd = makeRedis();
    const service = new PubCommentsService(db.pool, rd.redis);

    const result = await service.listPublic(
      POST_ID,
      1,
      "newest",
      user(ADMIN_ID, { isAdmin: true }),
    );

    expect(result.comments.map((comment) => comment.status)).toEqual(["pending", "published"]);
  });

  test("non-owner public-page list hides pending comments", async () => {
    const db = makeDb({
      listRows: [
        {
          id: hexToDec("0000000000000200"),
          post_id: hexToDec(POST_ID),
          name: "pending guest",
          body: "pending\n",
          status: "pending",
          is_author: false,
        },
        {
          id: hexToDec("0000000000000201"),
          post_id: hexToDec(POST_ID),
          name: "published guest",
          body: "published\n",
          status: "published",
          is_author: false,
        },
      ],
      initialCount: 2,
    });
    const rd = makeRedis();
    const service = new PubCommentsService(db.pool, rd.redis);

    const result = await service.listPublic(POST_ID, 1, "newest", null);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.status).toBe("published");
  });

  test("administrator may edit any comment on another user's article", async () => {
    const commentId = "0000000000000200";
    const db = makeDb({
      commentRow: {
        id: hexToDec(commentId),
        post_id: hexToDec(POST_ID),
        name: "guest",
        body: "before\n",
        status: "published",
        is_author: false,
        owned_by: hexToDec(OWNER_ID),
      },
    });
    const rd = makeRedis();
    const service = new PubCommentsService(db.pool, rd.redis);

    const updated = await service.editAuthorComment(
      commentId,
      user(ADMIN_ID, { isAdmin: true }),
      { name: "edited", body: "after" },
    );

    expect(updated.name).toBe("edited");
    expect(updated.body).toBe("after\n");
    expect(db.updated).toHaveLength(1);
  });

  test("normalization failures are exposed as invalid_input", async () => {
    const db = makeDb();
    const rd = makeRedis();
    const service = new PubCommentsService(db.pool, rd.redis);

    await expect(
      service.create({
        postId: POST_ID,
        name: "   ",
        body: "hello",
        asAuthor: false,
        currentUser: user(OWNER_ID),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("allow_replies=false disables external comments", async () => {
    const db = makeDb({ allowReplies: false });
    const rd = makeRedis();
    const service = new PubCommentsService(db.pool, rd.redis);

    await expect(service.listPublic(POST_ID, 1, "newest")).rejects.toMatchObject({
      code: "comments_disabled",
    });
  });

  test("transactional maximum prevents saving when the post reaches the global limit", async () => {
    const db = makeDb({ initialCount: 0, lockedCount: Config.PUB_COMMENT_MAX_COMMENTS });
    const rd = makeRedis();
    const service = new PubCommentsService(db.pool, rd.redis);

    await expect(
      service.create({
        postId: POST_ID,
        name: "author",
        body: "hello",
        asAuthor: true,
        currentUser: user(OWNER_ID),
      }),
    ).rejects.toMatchObject({ code: "comment_limit_reached" });
    expect(db.inserted).toHaveLength(0);
  });
});
