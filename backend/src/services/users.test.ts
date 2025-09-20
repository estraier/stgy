import { UsersService } from "./users";
import { User } from "../models/user";
import { hexToDec, decToHex } from "../utils/format";
import crypto from "crypto";
import { jest } from "@jest/globals";

jest.mock("../utils/format", () => {
  const actual = jest.requireActual("../utils/format") as Record<string, unknown>;
  return Object.assign({}, actual, {
    generatePasswordHash: jest.fn(async (password: string) =>
      Buffer.from(crypto.createHash("md5").update(password).digest("hex"), "hex"),
    ),
  });
});

jest.mock("../utils/servers", () => {
  const pgQuery = jest.fn((pool: any, sql: string, params?: any[]) => pool.query(sql, params));
  return { pgQuery };
});

function md5(s: string) {
  return crypto.createHash("md5").update(s).digest("hex");
}

const ALICE = "00000000000000A1";
const BOB = "00000000000000B0";
const CAROL = "00000000000000C0";

type UserDetailRow = {
  introduction: string;
  aiPersonality: string | null;
};

class MockPgClient {
  users: User[];
  details: Record<string, UserDetailRow>;
  follows: { followerId: string; followeeId: string }[];
  blocks: { blockerId: string; blockeeId: string }[];
  passwords: Record<string, string>;

  constructor() {
    this.users = [
      {
        id: ALICE,
        email: "alice@example.com",
        nickname: "Alice",
        isAdmin: false,
        blockStrangers: false,
        snippet: "introA",
        avatar: null,
        aiModel: "gpt-4.1",
        createdAt: "2020-01-01T00:00:00Z",
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      },
      {
        id: BOB,
        email: "bob@example.com",
        nickname: "Bob",
        isAdmin: false,
        blockStrangers: false,
        snippet: "introB",
        avatar: null,
        aiModel: "gpt-4.1",
        createdAt: "2020-01-02T00:00:00Z",
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      },
      {
        id: CAROL,
        email: "carol@example.com",
        nickname: "Carol",
        isAdmin: false,
        blockStrangers: false,
        snippet: "introC",
        avatar: null,
        aiModel: "gpt-4.1",
        createdAt: "2020-01-03T00:00:00Z",
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      },
    ];
    this.details = {
      [ALICE]: { introduction: "introA", aiPersonality: "A" },
      [BOB]: { introduction: "introB", aiPersonality: "B" },
      [CAROL]: { introduction: "introC", aiPersonality: "C" },
    };
    this.follows = [
      { followerId: ALICE, followeeId: BOB },
      { followerId: ALICE, followeeId: CAROL },
      { followerId: BOB, followeeId: ALICE },
      { followerId: CAROL, followeeId: ALICE },
    ];
    this.blocks = [];
    this.passwords = {
      [ALICE]: md5("alicepass"),
      [BOB]: md5("bobpass"),
      [CAROL]: md5("carolpass"),
    };
  }

  private cntFollowers(idHex: string) {
    return this.follows.filter((f) => f.followeeId === idHex).length;
  }
  private cntFollowees(idHex: string) {
    return this.follows.filter((f) => f.followerId === idHex).length;
  }

  async query(sql: string, params: any[] = []) {
    sql = sql.replace(/\s+/g, " ").trim();

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [] };
    }

    if (
      sql.startsWith("WITH") &&
      sql.includes("dedup AS") &&
      sql.includes("page AS") &&
      sql.includes("JOIN users u ON u.id = p.id")
    ) {
      const likePattern: string = params[0];
      const focusUserIdHex: string = decToHex(params[1]);
      const offset: number = params[2] ?? 0;
      const limit: number = params[3] ?? 20;
      const k: number = params[4] ?? offset + limit;
      const prefix = likePattern.toLowerCase().replace(/%+$/g, "");
      const match = (u: User) => u.nickname.toLowerCase().startsWith(prefix);
      const hasSelf = sql.includes("self AS (");
      const hasOthers = sql.includes("others AS (");
      const candidates: Array<{ prio: number; id: string; nkey: string }> = [];
      if (hasSelf) {
        const selfUser = this.users.find((u) => u.id === focusUserIdHex && match(u));
        if (selfUser) {
          candidates.push({ prio: 0, id: selfUser.id, nkey: selfUser.nickname.toLowerCase() });
        }
      }
      const followeeIds = this.follows
        .filter((f) => f.followerId === focusUserIdHex)
        .map((f) => f.followeeId);
      const followees = this.users
        .filter((u) => followeeIds.includes(u.id) && match(u))
        .sort(
          (a, b) =>
            a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase()) ||
            a.nickname.localeCompare(b.nickname) ||
            (BigInt("0x" + a.id) > BigInt("0x" + b.id) ? 1 : -1),
        )
        .slice(0, k);
      for (const u of followees) {
        candidates.push({ prio: 1, id: u.id, nkey: u.nickname.toLowerCase() });
      }
      if (hasOthers) {
        const others = this.users
          .filter((u) => match(u))
          .sort(
            (a, b) =>
              a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase()) ||
              a.nickname.localeCompare(b.nickname) ||
              (BigInt("0x" + a.id) > BigInt("0x" + b.id) ? 1 : -1),
          )
          .slice(0, k);
        for (const u of others) {
          candidates.push({ prio: 3, id: u.id, nkey: u.nickname.toLowerCase() });
        }
      }
      const bestById = new Map<string, { prio: number; id: string; nkey: string }>();
      for (const c of candidates) {
        const prev = bestById.get(c.id);
        if (!prev || c.prio < prev.prio) bestById.set(c.id, c);
      }
      const deduped = Array.from(bestById.values()).sort(
        (a, b) =>
          a.prio - b.prio ||
          a.nkey.localeCompare(b.nkey) ||
          (BigInt("0x" + a.id) > BigInt("0x" + b.id) ? 1 : -1),
      );
      const page = deduped.slice(offset, offset + limit);
      const rows = page
        .map((p) => this.users.find((u) => u.id === p.id))
        .filter((u): u is User => !!u)
        .map((u) => ({
          id: hexToDec(u.id),
          email: u.email,
          nickname: u.nickname,
          is_admin: u.isAdmin,
          block_strangers: u.blockStrangers,
          snippet: u.snippet,
          avatar: u.avatar,
          ai_model: u.aiModel,
          created_at: u.createdAt,
          updated_at: u.updatedAt,
          count_followers: this.cntFollowers(u.id),
          count_followees: this.cntFollowees(u.id),
          count_posts: 0,
        }));
      return { rows };
    }

    if (sql.startsWith("SELECT COUNT(*) FROM users u")) {
      if (
        sql.includes(
          "WHERE (u.nickname ILIKE $1 OR u.snippet ILIKE $1 OR d.introduction ILIKE $1)",
        ) ||
        sql.includes("WHERE (u.nickname ILIKE $1 OR d.introduction ILIKE $1)")
      ) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        return {
          rows: [
            {
              count: this.users.filter(
                (u) =>
                  u.nickname.toLowerCase().includes(pat) ||
                  (u.snippet ?? "").toLowerCase().includes(pat) ||
                  (this.details[u.id]?.introduction ?? "").toLowerCase().includes(pat),
              ).length,
            },
          ],
        };
      }
      if (sql.includes("WHERE u.nickname ILIKE $1")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        return {
          rows: [
            { count: this.users.filter((u) => u.nickname.toLowerCase().includes(pat)).length },
          ],
        };
      }
      if (sql.includes("WHERE LOWER(u.nickname) LIKE $1")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        return {
          rows: [
            { count: this.users.filter((u) => u.nickname.toLowerCase().startsWith(pat)).length },
          ],
        };
      }
      return { rows: [{ count: this.users.length }] };
    }

    if (sql.startsWith("SELECT id FROM users WHERE email = $1")) {
      const user = this.users.find((u) => u.email === params[0]);
      if (!user) return { rows: [] };
      return { rows: [{ id: hexToDec(user.id) }] };
    }

    if (
      sql.startsWith(
        "SELECT id, email, nickname, is_admin, block_strangers, ai_model, id_to_timestamp(id) AS created_at, updated_at, count_followers, count_followees, count_posts FROM users WHERE id = $1",
      )
    ) {
      const idHex = decToHex(params[0]);
      const user = this.users.find((u) => u.id === idHex);
      if (!user) return { rows: [] };
      const row = {
        id: hexToDec(user.id),
        email: user.email,
        nickname: user.nickname,
        is_admin: user.isAdmin,
        block_strangers: user.blockStrangers,
        ai_model: user.aiModel,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        count_followers: this.cntFollowers(user.id),
        count_followees: this.cntFollowees(user.id),
        count_posts: 0,
      };
      return { rows: [row] };
    }

    if (
      sql.startsWith(
        "SELECT id, email, nickname, is_admin, block_strangers, ai_model, id_to_timestamp(id) AS created_at, updated_at, count_followers, count_followees, count_posts FROM users WHERE id = $1",
      )
    ) {
      const idHex = decToHex(params[0]);
      const user = this.users.find((u) => u.id === idHex);
      if (!user) return { rows: [] };
      const row = {
        id: hexToDec(user.id),
        email: user.email,
        nickname: user.nickname,
        is_admin: user.isAdmin,
        block_strangers: user.blockStrangers,
        ai_model: user.aiModel,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        count_followers: this.cntFollowers(user.id),
        count_followees: this.cntFollowees(user.id),
        count_posts: 0,
      };
      return { rows: [row] };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.block_strangers, u.snippet, u.avatar, u.ai_model, id_to_timestamp(u.id) AS created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts, d.introduction, d.ai_personality FROM users u LEFT JOIN user_details d ON d.user_id = u.id WHERE u.id = $1",
      )
    ) {
      const idHex = decToHex(params[0]);
      const user = this.users.find((u) => u.id === idHex);
      if (!user) return { rows: [] };
      const d = this.details[user.id] ?? { introduction: "", aiPersonality: null };
      const row = {
        id: hexToDec(user.id),
        email: user.email,
        nickname: user.nickname,
        is_admin: user.isAdmin,
        block_strangers: user.blockStrangers,
        snippet: user.snippet,
        avatar: user.avatar,
        ai_model: user.aiModel,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        count_followers: this.cntFollowers(user.id),
        count_followees: this.cntFollowees(user.id),
        count_posts: 0,
        introduction: d.introduction,
        ai_personality: d.aiPersonality,
      };
      return { rows: [row] };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.block_strangers, u.snippet, u.avatar, u.ai_model, id_to_timestamp(u.id) AS created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts, d.introduction, d.ai_personality FROM users u LEFT JOIN user_details d ON d.user_id = u.id WHERE u.id = $1",
      )
    ) {
      const idHex = decToHex(params[0]);
      const user = this.users.find((u) => u.id === idHex);
      if (!user) return { rows: [] };
      const d = this.details[user.id] ?? { introduction: "", aiPersonality: null };
      const row = {
        id: hexToDec(user.id),
        email: user.email,
        nickname: user.nickname,
        is_admin: user.isAdmin,
        block_strangers: user.blockStrangers,
        snippet: user.snippet,
        avatar: user.avatar,
        ai_model: user.aiModel,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
        count_followers: this.cntFollowers(user.id),
        count_followees: this.cntFollowees(user.id),
        count_posts: 0,
        introduction: d.introduction,
        ai_personality: d.aiPersonality,
      };
      return { rows: [row] };
    }

    if (
      sql.startsWith(
        "SELECT EXISTS (SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2) AS is_followed_by_focus_user",
      )
    ) {
      const [focusUserIdDec, idDec] = params;
      const focusUserId = decToHex(focusUserIdDec);
      const idHex = decToHex(idDec);
      const isFollowed = this.follows.some(
        (f) => f.followerId === focusUserId && f.followeeId === idHex,
      );
      const isFollowing = this.follows.some(
        (f) => f.followerId === idHex && f.followeeId === focusUserId,
      );
      const includeBlocks =
        sql.includes("is_blocked_by_focus_user") || sql.includes("is_blocking_focus_user");
      const isBlockedByFocus = this.blocks.some(
        (b) => b.blockerId === focusUserId && b.blockeeId === idHex,
      );
      const isBlockingFocus = this.blocks.some(
        (b) => b.blockerId === idHex && b.blockeeId === focusUserId,
      );
      const row: any = {
        is_followed_by_focus_user: isFollowed,
        is_following_focus_user: isFollowing,
      };
      if (includeBlocks) {
        row.is_blocked_by_focus_user = isBlockedByFocus;
        row.is_blocking_focus_user = isBlockingFocus;
      }
      return { rows: [row] };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.block_strangers, u.snippet, u.avatar, u.ai_model, id_to_timestamp(u.id) AS created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM users u",
      )
    ) {
      let list = [...this.users];
      if (
        sql.includes(
          "WHERE (u.nickname ILIKE $1 OR u.snippet ILIKE $1 OR d.introduction ILIKE $1)",
        ) ||
        sql.includes("WHERE (u.nickname ILIKE $1 OR d.introduction ILIKE $1)")
      ) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter(
          (u) =>
            u.nickname.toLowerCase().includes(pat) ||
            (u.snippet ?? "").toLowerCase().includes(pat) ||
            (this.details[u.id]?.introduction ?? "").toLowerCase().includes(pat),
        );
      } else if (sql.includes("WHERE u.nickname ILIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().includes(pat));
      } else if (sql.includes("WHERE LOWER(u.nickname) LIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().startsWith(pat));
      }
      list.sort((a, b) => (BigInt("0x" + b.id) > BigInt("0x" + a.id) ? 1 : -1));
      const offset = params[params.length - 2] || 0;
      const limit = params[params.length - 1] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: hexToDec(u.id),
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        block_strangers: u.blockStrangers,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.block_strangers, u.snippet, u.avatar, u.ai_model, id_to_timestamp(u.id) AS created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM users u",
      )
    ) {
      let list = [...this.users];
      if (
        sql.includes(
          "WHERE (u.nickname ILIKE $1 OR u.snippet ILIKE $1 OR d.introduction ILIKE $1)",
        ) ||
        sql.includes("WHERE (u.nickname ILIKE $1 OR d.introduction ILIKE $1)")
      ) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter(
          (u) =>
            u.nickname.toLowerCase().includes(pat) ||
            (u.snippet ?? "").toLowerCase().includes(pat) ||
            (this.details[u.id]?.introduction ?? "").toLowerCase().includes(pat),
        );
      } else if (sql.includes("WHERE u.nickname ILIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().includes(pat));
      } else if (sql.includes("WHERE LOWER(u.nickname) LIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().startsWith(pat));
      }
      list.sort((a, b) => (BigInt("0x" + b.id) > BigInt("0x" + a.id) ? 1 : -1));
      const offset = params[params.length - 2] || 0;
      const limit = params[params.length - 1] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: hexToDec(u.id),
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        block_strangers: u.blockStrangers,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT followee_id FROM user_follows WHERE follower_id = $1 AND followee_id = ANY($2)",
      )
    ) {
      const focusUserId = decToHex(params[0]);
      const idsHex: string[] = (params[1] as any[]).map(decToHex);
      return {
        rows: this.follows
          .filter((f) => f.followerId === focusUserId && idsHex.includes(f.followeeId))
          .map((f) => ({ followee_id: hexToDec(f.followeeId) })),
      };
    }
    if (
      sql.startsWith(
        "SELECT follower_id FROM user_follows WHERE follower_id = ANY($1) AND followee_id = $2",
      )
    ) {
      const idsHex: string[] = (params[0] as any[]).map(decToHex);
      const focusUserId = decToHex(params[1]);
      return {
        rows: this.follows
          .filter((f) => idsHex.includes(f.followerId) && f.followeeId === focusUserId)
          .map((f) => ({ follower_id: hexToDec(f.followerId) })),
      };
    }

    if (
      sql.startsWith(
        "SELECT blockee_id FROM user_blocks WHERE blocker_id = $1 AND blockee_id = ANY($2)",
      )
    ) {
      const focusUserId = decToHex(params[0]);
      const idsHex: string[] = (params[1] as any[]).map(decToHex);
      return {
        rows: this.blocks
          .filter((b) => b.blockerId === focusUserId && idsHex.includes(b.blockeeId))
          .map((b) => ({ blockee_id: hexToDec(b.blockeeId) })),
      };
    }
    if (
      sql.startsWith(
        "SELECT blocker_id FROM user_blocks WHERE blocker_id = ANY($1) AND blockee_id = $2",
      )
    ) {
      const idsHex: string[] = (params[0] as any[]).map(decToHex);
      const focusUserId = decToHex(params[1]);
      return {
        rows: this.blocks
          .filter((b) => idsHex.includes(b.blockerId) && b.blockeeId === focusUserId)
          .map((b) => ({ blocker_id: hexToDec(b.blockerId) })),
      };
    }

    if (sql.startsWith("SELECT 1 FROM users WHERE email = $1")) {
      const email = params[0];
      const exists = this.users.some((u) => u.email === email);
      return { rows: exists ? [1] : [] };
    }

    if (
      sql.startsWith(
        "INSERT INTO users (id, email, nickname, password, is_admin, block_strangers, snippet, avatar, ai_model, updated_at) VALUES",
      )
    ) {
      const [
        idDec,
        email,
        nickname,
        password,
        isAdmin,
        blockStrangers,
        snippet,
        avatar,
        aiModel,
        idDate,
      ] = params;
      const idHex = decToHex(idDec);
      const user: User = {
        id: idHex,
        email,
        nickname,
        isAdmin,
        blockStrangers,
        snippet,
        avatar,
        aiModel,
        createdAt: idDate,
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      };
      this.users.push(user);
      const pwHex = Buffer.isBuffer(password)
        ? password.toString("hex")
        : typeof password === "string"
          ? password
          : String(password);
      this.passwords[user.id] = pwHex;
      return {
        rows: [
          {
            id: idDec,
            email: user.email,
            nickname: user.nickname,
            is_admin: user.isAdmin,
            block_strangers: user.blockStrangers,
            snippet: user.snippet,
            avatar: user.avatar,
            ai_model: user.aiModel,
            created_at: user.createdAt,
            updated_at: user.updatedAt,
            count_followers: user.countFollowers,
            count_followees: user.countFollowees,
            count_posts: user.countPosts,
          },
        ],
      };
    }

    if (
      sql.startsWith(
        "INSERT INTO users (id, email, nickname, password, is_admin, block_strangers, snippet, avatar, ai_model, updated_at) VALUES",
      )
    ) {
      const [idDec, email, nickname, password, isAdmin, blockStrangers, snippet, avatar, aiModel] =
        params;
      const idHex = decToHex(idDec);
      const createdAt = new Date().toISOString();
      const user: User = {
        id: idHex,
        email,
        nickname,
        isAdmin,
        blockStrangers,
        snippet,
        avatar,
        aiModel,
        createdAt,
        updatedAt: null,
        countFollowers: 0,
        countFollowees: 0,
        countPosts: 0,
      };
      this.users.push(user);
      const pwHex = Buffer.isBuffer(password)
        ? password.toString("hex")
        : typeof password === "string"
          ? password
          : String(password);
      this.passwords[user.id] = pwHex;
      return {
        rows: [
          {
            id: idDec,
            email: user.email,
            nickname: user.nickname,
            is_admin: user.isAdmin,
            block_strangers: user.blockStrangers,
            snippet: user.snippet,
            avatar: user.avatar,
            ai_model: user.aiModel,
            created_at: user.createdAt,
            updated_at: user.updatedAt,
            count_followers: user.countFollowers,
            count_followees: user.countFollowees,
            count_posts: user.countPosts,
          },
        ],
      };
    }

    if (sql.startsWith("INSERT INTO user_details (user_id, introduction, ai_personality)")) {
      const [userIdDec, introduction, aiPersonality] = params;
      const userId = decToHex(userIdDec);
      const hasCoalesce = sql.includes("COALESCE(EXCLUDED.introduction");
      const prev = this.details[userId] ?? { introduction: "", aiPersonality: null };
      this.details[userId] = {
        introduction:
          hasCoalesce && (introduction === null || introduction === undefined)
            ? prev.introduction
            : (introduction ?? ""),
        aiPersonality:
          hasCoalesce && (aiPersonality === null || aiPersonality === undefined)
            ? prev.aiPersonality
            : (aiPersonality ?? null),
      };
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("UPDATE users SET password = $1 WHERE id = $2")) {
      const [password, idDec] = params;
      const id = decToHex(idDec);
      const exists = this.users.some((u) => u.id === id);
      if (!exists) return { rowCount: 0 };
      const pwHex = Buffer.isBuffer(password)
        ? password.toString("hex")
        : typeof password === "string"
          ? password
          : String(password);
      this.passwords[id] = pwHex;
      return { rowCount: 1 };
    }

    if (sql.startsWith("UPDATE users SET")) {
      const id = decToHex(params[params.length - 1]);
      const user = this.users.find((u) => u.id === id);
      if (!user) return { rows: [] };
      if (sql.includes("email = $1")) user.email = params[0];
      if (sql.includes("nickname =")) {
        const nick = params.find((p: any) => typeof p === "string" && !p.includes("@"));
        if (nick) user.nickname = nick;
      }
      if (sql.includes("is_admin ="))
        user.isAdmin = !!params.find((p: any) => typeof p === "boolean");
      if (sql.includes("block_strangers ="))
        user.blockStrangers = !!params.find((p: any) => typeof p === "boolean");
      if (sql.includes("avatar ="))
        user.avatar = params.find((p: any) => p === null || typeof p === "string") ?? user.avatar;
      if (sql.includes("ai_model ="))
        user.aiModel = params.find((p: any) => typeof p === "string") ?? user.aiModel;
      if (sql.includes("snippet =")) {
        const i = sql.split(",").findIndex((seg) => seg.includes("snippet ="));
        user.snippet = params[i >= 0 ? i : 0] ?? user.snippet;
      }
      return {
        rows: [
          {
            id: hexToDec(user.id),
            email: user.email,
            nickname: user.nickname,
            is_admin: user.isAdmin,
            block_strangers: user.blockStrangers,
            snippet: user.snippet,
            avatar: user.avatar,
            ai_model: user.aiModel,
            created_at: user.createdAt,
            updated_at: new Date().toISOString(),
            count_followers: this.cntFollowers(user.id),
            count_followees: this.cntFollowees(user.id),
            count_posts: 0,
          },
        ],
        rowCount: 1,
      };
    }

    if (sql.startsWith("DELETE FROM users WHERE id = $1")) {
      const id = decToHex(params[0]);
      const idx = this.users.findIndex((u) => u.id === id);
      if (idx === -1) return { rowCount: 0 };
      const hex = this.users[idx].id;
      this.users.splice(idx, 1);
      delete this.passwords[hex];
      delete this.details[hex];
      this.follows = this.follows.filter((f) => f.followerId !== hex && f.followeeId !== hex);
      this.blocks = this.blocks.filter((b) => b.blockerId !== hex && b.blockeeId !== hex);
      return { rowCount: 1 };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.block_strangers, u.snippet, u.avatar, u.ai_model, id_to_timestamp(u.id) AS created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM user_follows f JOIN users u ON f.followee_id = u.id WHERE f.follower_id = $1",
      )
    ) {
      const followerId = decToHex(params[0]);
      const list = this.follows
        .filter((f) => f.followerId === followerId)
        .map((f) => this.users.find((u) => u.id === f.followeeId))
        .filter((u): u is User => !!u);
      list.sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          (BigInt("0x" + b.id) > BigInt("0x" + a.id) ? 1 : -1),
      );
      const offset = params[1] || 0;
      const limit = params[2] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: hexToDec(u.id),
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        block_strangers: u.blockStrangers,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.block_strangers, u.snippet, u.avatar, u.ai_model, id_to_timestamp(u.id) AS created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM user_follows f JOIN users u ON f.followee_id = u.id WHERE f.follower_id = $1",
      )
    ) {
      const followerId = decToHex(params[0]);
      const list = this.follows
        .filter((f) => f.followerId === followerId)
        .map((f) => this.users.find((u) => u.id === f.followeeId))
        .filter((u): u is User => !!u);
      list.sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          (BigInt("0x" + b.id) > BigInt("0x" + a.id) ? 1 : -1),
      );
      const offset = params[1] || 0;
      const limit = params[2] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: hexToDec(u.id),
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        block_strangers: u.blockStrangers,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.block_strangers, u.snippet, u.avatar, u.ai_model, id_to_timestamp(u.id) AS created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM user_follows f JOIN users u ON f.follower_id = u.id WHERE f.followee_id = $1",
      )
    ) {
      const followeeId = decToHex(params[0]);
      const list = this.follows
        .filter((f) => f.followeeId === followeeId)
        .map((f) => this.users.find((u) => u.id === f.followerId))
        .filter((u): u is User => !!u);
      list.sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          (BigInt("0x" + b.id) > BigInt("0x" + a.id) ? 1 : -1),
      );
      const offset = params[1] || 0;
      const limit = params[2] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: hexToDec(u.id),
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        block_strangers: u.blockStrangers,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (
      sql.startsWith(
        "SELECT u.id, u.email, u.nickname, u.is_admin, u.block_strangers, u.snippet, u.avatar, u.ai_model, id_to_timestamp(u.id) AS created_at, u.updated_at, u.count_followers, u.count_followees, u.count_posts FROM user_follows f JOIN users u ON f.follower_id = u.id WHERE f.followee_id = $1",
      )
    ) {
      const followeeId = decToHex(params[0]);
      const list = this.follows
        .filter((f) => f.followeeId === followeeId)
        .map((f) => this.users.find((u) => u.id === f.followerId))
        .filter((u): u is User => !!u);
      list.sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          (BigInt("0x" + b.id) > BigInt("0x" + a.id) ? 1 : -1),
      );
      const offset = params[1] || 0;
      const limit = params[2] || 100;
      const rows = list.slice(offset, offset + limit).map((u) => ({
        id: hexToDec(u.id),
        email: u.email,
        nickname: u.nickname,
        is_admin: u.isAdmin,
        block_strangers: u.blockStrangers,
        snippet: u.snippet,
        avatar: u.avatar,
        ai_model: u.aiModel,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        count_followers: this.cntFollowers(u.id),
        count_followees: this.cntFollowees(u.id),
        count_posts: 0,
      }));
      return { rows };
    }

    if (sql.startsWith("INSERT INTO user_follows")) {
      const [followerIdDec, followeeIdDec] = params;
      const followerId = decToHex(followerIdDec);
      const followeeId = decToHex(followeeIdDec);
      if (!this.follows.some((f) => f.followerId === followerId && f.followeeId === followeeId)) {
        this.follows.push({ followerId, followeeId });
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }
    if (sql.startsWith("DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2")) {
      const followerId = decToHex(params[0]);
      const followeeId = decToHex(params[1]);
      const prev = this.follows.length;
      this.follows = this.follows.filter(
        (f) => !(f.followerId === followerId && f.followeeId === followeeId),
      );
      return { rowCount: prev - this.follows.length };
    }
    if (sql.startsWith("SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2")) {
      const followerId = decToHex(params[0]);
      const followeeId = decToHex(params[1]);
      const exists = this.follows.some(
        (f) => f.followerId === followerId && f.followeeId === followeeId,
      );
      return { rowCount: exists ? 1 : 0, rows: exists ? [{ ok: 1 }] : [] };
    }

    if (sql.startsWith("INSERT INTO user_blocks")) {
      const [blockerIdDec, blockeeIdDec] = params;
      const blockerId = decToHex(blockerIdDec);
      const blockeeId = decToHex(blockeeIdDec);
      if (!this.blocks.some((b) => b.blockerId === blockerId && b.blockeeId === blockeeId)) {
        this.blocks.push({ blockerId, blockeeId });
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }
    if (sql.startsWith("DELETE FROM user_blocks WHERE blocker_id = $1 AND blockee_id = $2")) {
      const blockerId = decToHex(params[0]);
      const blockeeId = decToHex(params[1]);
      const prev = this.blocks.length;
      this.blocks = this.blocks.filter(
        (b) => !(b.blockerId === blockerId && b.blockeeId === blockeeId),
      );
      return { rowCount: prev - this.blocks.length };
    }
    if (sql.startsWith("SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blockee_id = $2")) {
      const blockerId = decToHex(params[0]);
      const blockeeId = decToHex(params[1]);
      const exists = this.blocks.some(
        (b) => b.blockerId === blockerId && b.blockeeId === blockeeId,
      );
      return { rowCount: exists ? 1 : 0, rows: exists ? [{ ok: 1 }] : [] };
    }

    throw new Error("Unknown SQL: " + sql);
  }
}

class MockRedis {
  store: Record<string, any> = {};
  queue: { queue: string; val: string }[] = [];
  async hmset(key: string, obj: any) {
    this.store[key] = { ...obj };
  }
  async hgetall(key: string) {
    return this.store[key] ? { ...this.store[key] } : {};
  }
  async expire(_key: string, _ttl: number) {}
  async lpush(queue: string, val: string) {
    this.queue.push({ queue, val });
  }
  async del(key: string) {
    delete this.store[key];
  }
}

describe("UsersService", () => {
  let pg: MockPgClient;
  let redis: MockRedis;
  let service: UsersService;

  beforeEach(() => {
    pg = new MockPgClient();
    redis = new MockRedis();
    service = new UsersService(pg as any, redis as any);
  });

  test("countUsers (all/nickname/query)", async () => {
    expect(await service.countUsers()).toBe(3);
    expect(await service.countUsers({ nickname: "B" })).toBe(1);
    expect(await service.countUsers({ query: "intro" })).toBe(3);
    expect(await service.countUsers({ query: "introA" })).toBe(1);
  });

  test("getUserLite", async () => {
    const u = await service.getUserLite(ALICE);
    expect(u?.id).toBe(ALICE);
    expect(u?.email).toBe("alice@example.com");
    expect(u?.aiModel).toBe("gpt-4.1");
  });

  test("getUser (with focusUserId)", async () => {
    const user = await service.getUser(ALICE, BOB);
    expect(user?.id).toBe(ALICE);
    expect(user?.countFollowers).toBe(2);
    expect(user?.countFollowees).toBe(2);
    expect(user?.countPosts).toBe(0);
    expect(user?.isFollowedByFocusUser).toBe(true);
    expect(user?.isFollowingFocusUser).toBe(true);
    expect(user?.introduction).toBe("introA");
  });

  test("listUsers (with focusUserId)", async () => {
    const users = await service.listUsers({}, BOB);
    const alice = users.find((u) => u.id === ALICE)!;
    expect(alice.countFollowees).toBe(2);
    expect(alice.countPosts).toBe(0);
    expect(alice.isFollowedByFocusUser).toBe(true);
    expect(alice.isFollowingFocusUser).toBe(true);
    const bob = users.find((u) => u.id === BOB)!;
    expect(bob.countFollowers).toBe(1);
    expect(bob.countFollowees).toBe(1);
    expect(bob.countPosts).toBe(0);
    expect(bob.isFollowedByFocusUser).toBeUndefined();
    expect(bob.isFollowingFocusUser).toBeUndefined();
    const carol = users.find((u) => u.id === CAROL)!;
    expect(carol.countFollowers).toBe(1);
    expect(carol.countFollowees).toBe(1);
    expect(carol.countPosts).toBe(0);
    expect(carol.isFollowedByFocusUser).toBe(false);
    expect(carol.isFollowingFocusUser).toBe(false);
  });

  test("createUser", async () => {
    const user = await service.createUser({
      email: "dan@example.com",
      nickname: "Dan",
      password: "danpass",
      isAdmin: false,
      blockStrangers: false,
      introduction: "introD",
      avatar: null,
      aiModel: "gpt-4.1",
      aiPersonality: "D",
    });
    expect(user.email).toBe("dan@example.com");
    expect(pg.users.find((u) => u.email === "dan@example.com")).toBeDefined();
    expect(pg.passwords[user.id]).toBe(md5("danpass"));
    expect(pg.details[user.id]?.introduction).toBe("introD");
    expect(pg.details[user.id]?.aiPersonality).toBe("D");
  });

  test("updateUser (including details)", async () => {
    const user = await service.updateUser({
      id: ALICE,
      email: "alice2@example.com",
      nickname: "Alice2",
      isAdmin: true,
      blockStrangers: true,
      introduction: "introX",
      avatar: null,
      aiModel: "gpt-4.1-mini",
      aiPersonality: "X",
    });
    expect(user?.email).toBe("alice2@example.com");
    expect(user?.isAdmin).toBe(true);
    expect(user?.blockStrangers).toBe(true);
    const detail = await service.getUser(ALICE);
    expect(detail?.introduction).toBe("introX");
    expect(detail?.aiPersonality).toBe("X");
  });

  test("startUpdateEmail stores verification info in Redis and queues mail", async () => {
    const userId = ALICE;
    const newEmail = "alice_new@example.com";
    const result = await service.startUpdateEmail(userId, newEmail);
    expect(result).toHaveProperty("updateEmailId");
    const stored = redis.store[Object.keys(redis.store)[0]];
    expect(stored.userId).toBe(userId);
    expect(stored.newEmail).toBe(newEmail);
    expect(typeof stored.verificationCode).toBe("string");
    expect(redis.queue.some((q) => q.queue === "mail-queue" && q.val.includes(newEmail))).toBe(
      true,
    );
  });

  test("verifyUpdateEmail: updates email if code matches & email unused", async () => {
    await redis.hmset("updateEmail:xyz", {
      userId: ALICE,
      newEmail: "alice2@example.com",
      verificationCode: "123456",
      createdAt: new Date().toISOString(),
    });
    await new UsersService(pg as any, redis as any).verifyUpdateEmail(ALICE, "xyz", "123456");
    expect(pg.users.find((u) => u.id === ALICE)?.email).toBe("alice2@example.com");
    expect(await redis.hgetall("updateEmail:xyz")).toEqual({});
  });

  test("verifyUpdateEmail: throws if code mismatch", async () => {
    await redis.hmset("updateEmail:abc", {
      userId: ALICE,
      newEmail: "alice3@example.com",
      verificationCode: "654321",
      createdAt: new Date().toISOString(),
    });
    await expect(
      new UsersService(pg as any, redis as any).verifyUpdateEmail(ALICE, "abc", "wrongcode"),
    ).rejects.toThrow(/mismatch/i);
  });

  test("updateUserPassword", async () => {
    const id = pg.users[0].id;
    await service.updateUserPassword({ id, password: "newpass" });
    expect(pg.passwords[id]).toBe(md5("newpass"));
    await expect(
      service.updateUserPassword({ id: "00000000000000DD", password: "x" }),
    ).rejects.toThrow(/User not found/i);
  });

  test("startResetPassword stores verification info in Redis and queues mail", async () => {
    const userId = ALICE;
    const email = "alice@example.com";
    const { resetPasswordId, webCode } = await service.startResetPassword(email);
    const stored = redis.store[`resetPassword:${resetPasswordId}`];
    expect(stored.userId).toBe(userId);
    expect(stored.email).toBe(email);
    expect(typeof stored.mailCode).toBe("string");
    expect(stored.webCode).toBe(webCode);
    expect(stored.createdAt).toBeDefined();
    expect(
      redis.queue.some(
        (q) => q.queue === "mail-queue" && q.val.includes(email) && q.val.includes(stored.mailCode),
      ),
    ).toBe(true);
  });

  test("fakeResetPassword makes a dummy session object", async () => {
    const { resetPasswordId, webCode } = await service.fakeResetPassword();
    expect(typeof resetPasswordId).toBe("string");
    expect(typeof webCode).toBe("string");
  });

  test("verifyResetPassword: resets password if codes match", async () => {
    const email = "alice@example.com";
    const { resetPasswordId, webCode } = await service.startResetPassword(email);
    const stored = redis.store[`resetPassword:${resetPasswordId}`];
    const mailCode = stored.mailCode;
    await service.verifyResetPassword(email, resetPasswordId, webCode, mailCode, "newsecurepass");
    expect(pg.passwords[ALICE]).toBe(md5("newsecurepass"));
  });

  test("verifyResetPassword: throws if webCode does not match", async () => {
    const email = "alice@example.com";
    const { resetPasswordId } = await service.startResetPassword(email);
    const mailCode = redis.store[`resetPassword:${resetPasswordId}`].mailCode;
    await expect(
      service.verifyResetPassword(email, resetPasswordId, "wrongWebCode", mailCode, "pass1234"),
    ).rejects.toThrow(/web verification code mismatch/i);
  });

  test("verifyResetPassword: throws if mailCode does not match", async () => {
    const email = "alice@example.com";
    const { resetPasswordId, webCode } = await service.startResetPassword(email);
    await expect(
      service.verifyResetPassword(email, resetPasswordId, webCode, "wrongMailCode", "pass1234"),
    ).rejects.toThrow(/mail verification code mismatch/i);
  });

  test("deleteUser", async () => {
    const id = pg.users[0].id;
    await service.deleteUser(id);
    expect(pg.users.find((u) => u.id === id)).toBeUndefined();
    await expect(service.deleteUser("00000000000000DD")).rejects.toThrow(/User not found/i);
  });

  test("listFollowees (with focusUserId)", async () => {
    const res = await service.listFollowees({ followerId: ALICE }, BOB);
    expect(res.length).toBe(2);
    expect(res.some((u) => u.id === BOB)).toBe(true);
    expect(res.some((u) => u.id === CAROL)).toBe(true);
    expect(res.every((u) => typeof u.countFollowers === "number")).toBe(true);
    expect(res.every((u) => typeof u.countPosts === "number")).toBe(true);
  });

  test("listFollowers (with focusUserId)", async () => {
    const res = await service.listFollowers({ followeeId: ALICE }, BOB);
    expect(res.length).toBe(2);
    expect(res.some((u) => u.id === BOB)).toBe(true);
    expect(res.some((u) => u.id === CAROL)).toBe(true);
    expect(res.every((u) => typeof u.countFollowers === "number")).toBe(true);
    expect(res.every((u) => typeof u.countPosts === "number")).toBe(true);
  });

  test("addFollow/removeFollow", async () => {
    await service.addFollow({ followerId: BOB, followeeId: CAROL });
    expect(pg.follows.some((f) => f.followerId === BOB && f.followeeId === CAROL)).toBe(true);
    await service.removeFollow({ followerId: BOB, followeeId: CAROL });
    expect(pg.follows.some((f) => f.followerId === BOB && f.followeeId === CAROL)).toBe(false);
  });

  test("listFriendsByNicknamePrefix (typical)", async () => {
    const res = await service.listFriendsByNicknamePrefix({
      focusUserId: ALICE,
      nicknamePrefix: "b",
      offset: 0,
      limit: 20,
      omitSelf: false,
      omitOthers: false,
    });
    expect(res.length).toBe(1);
    expect(res[0].id).toBe(BOB);
  });

  test("addBlock/removeBlock and block flags in getUser/listUsers", async () => {
    await service.addBlock({ blockerId: BOB, blockeeId: CAROL });
    expect(pg.blocks.some((b) => b.blockerId === BOB && b.blockeeId === CAROL)).toBe(true);

    const u = await service.getUser(CAROL, BOB);
    expect(u?.isBlockedByFocusUser).toBe(true);
    expect(u?.isBlockingFocusUser).toBe(false);

    const list = await service.listUsers({}, BOB);
    const carol = list.find((x) => x.id === CAROL)!;
    expect(carol.isBlockedByFocusUser).toBe(true);
    expect(carol.isBlockingFocusUser).toBe(false);

    await service.removeBlock({ blockerId: BOB, blockeeId: CAROL });
    expect(pg.blocks.some((b) => b.blockerId === BOB && b.blockeeId === CAROL)).toBe(false);
  });

  test("checkBlock/checkFollow", async () => {
    expect(await service.checkFollow({ followerId: ALICE, followeeId: BOB })).toBe(true);
    expect(await service.checkFollow({ followerId: BOB, followeeId: CAROL })).toBe(false);

    await service.addBlock({ blockerId: ALICE, blockeeId: BOB });
    expect(await service.checkBlock({ blockerId: ALICE, blockeeId: BOB })).toBe(true);
    expect(await service.checkBlock({ blockerId: BOB, blockeeId: ALICE })).toBe(false);
  });
});
