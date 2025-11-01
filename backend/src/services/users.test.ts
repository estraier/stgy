import { UsersService } from "./users";
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

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

function md5(s: string) {
  return crypto.createHash("md5").update(s).digest("hex");
}

const ALICE = "00000000000000A1";
const BOB = "00000000000000B0";
const CAROL = "00000000000000C0";

type DetailRow = {
  locale: string;
  timezone: string;
  introduction: string;
  aiPersonality: string | null;
};

type MockUser = {
  id: string;
  nickname: string;
  isAdmin: boolean;
  blockStrangers: boolean;
  snippet: string;
  avatar: string | null;
  aiModel: string | null;
  createdAt: string;
  updatedAt: string | null;
  countFollowers: number;
  countFollowees: number;
  countPosts: number;
};

const SQL_FLAGS =
  "SELECT EXISTS ( SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2 ) AS is_followed_by_focus_user, EXISTS ( SELECT 1 FROM user_follows WHERE follower_id = $2 AND followee_id = $1 ) AS is_following_focus_user, EXISTS ( SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blockee_id = $2 ) AS is_blocked_by_focus_user, EXISTS ( SELECT 1 FROM user_blocks WHERE blocker_id = $2 AND blockee_id = $1 ) AS is_blocking_focus_user";

const SQL_INSERT_USERS_PREFIX =
  "INSERT INTO users ( id, nickname, is_admin, block_strangers, snippet, avatar, ai_model, updated_at ) VALUES";

const SQL_UPSERT_DETAILS_OVERWRITE =
  "INSERT INTO user_details (user_id, locale, timezone, introduction, ai_personality) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO UPDATE SET locale = EXCLUDED.locale, timezone = EXCLUDED.timezone, introduction = EXCLUDED.introduction, ai_personality = EXCLUDED.ai_personality";

const SQL_UPSERT_DETAILS_LOCALE_TZ =
  "INSERT INTO user_details (user_id, locale, timezone) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET locale = EXCLUDED.locale, timezone = EXCLUDED.timezone";

const SQL_UPSERT_DETAILS =
  "INSERT INTO user_details (user_id, introduction, ai_personality) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET introduction = COALESCE(EXCLUDED.introduction, user_details.introduction), ai_personality = COALESCE(EXCLUDED.ai_personality, user_details.ai_personality)";

const SQL_UPSERT_PUBCONFIG =
  "INSERT INTO user_pub_configs ( user_id, site_name, subtitle, author, introduction, design_theme, show_service_header, show_site_name, show_pagenation, show_side_profile, show_side_recent ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (user_id) DO UPDATE SET site_name = EXCLUDED.site_name, subtitle = EXCLUDED.subtitle, author = EXCLUDED.author, introduction = EXCLUDED.introduction, design_theme = EXCLUDED.design_theme, show_service_header = EXCLUDED.show_service_header, show_site_name = EXCLUDED.show_site_name, show_pagenation = EXCLUDED.show_pagenation, show_side_profile = EXCLUDED.show_side_profile, show_side_recent = EXCLUDED.show_side_recent RETURNING site_name, subtitle, author, introduction, design_theme, show_service_header, show_site_name, show_pagenation, show_side_profile, show_side_recent";

const SQL_SELECT_PUBCONFIG =
  "SELECT upc.site_name, upc.subtitle, upc.author, upc.introduction, upc.design_theme, upc.show_service_header, upc.show_site_name, upc.show_pagenation, upc.show_side_profile, upc.show_side_recent, u.locale FROM user_pub_configs upc LEFT JOIN users u ON u.id = upc.user_id WHERE upc.user_id = $1 LIMIT 1";

class MockPgClient {
  users: MockUser[];
  details: Record<string, DetailRow>;
  follows: { followerId: string; followeeId: string }[];
  blocks: { blockerId: string; blockeeId: string }[];
  passwords: Record<string, string>;
  userSecrets: Record<string, { email: string; password: string }>;
  pubConfigs: Record<
    string,
    {
      site_name: string;
      subtitle: string;
      author: string;
      introduction: string;
      design_theme: string;
      show_service_header: boolean;
      show_site_name: boolean;
      show_pagenation: boolean;
      show_side_profile: boolean;
      show_side_recent: boolean;
    }
  >;

  constructor() {
    this.users = [
      {
        id: ALICE,
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
      [ALICE]: {
        locale: "ja-JP",
        timezone: "Asia/Tokyo",
        introduction: "introA",
        aiPersonality: "A",
      },
      [BOB]: {
        locale: "en-US",
        timezone: "America/Los_Angeles",
        introduction: "introB",
        aiPersonality: "B",
      },
      [CAROL]: {
        locale: "en-GB",
        timezone: "Europe/London",
        introduction: "introC",
        aiPersonality: "C",
      },
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
    this.userSecrets = {
      [ALICE]: { email: "alice@example.com", password: this.passwords[ALICE] },
      [BOB]: { email: "bob@example.com", password: this.passwords[BOB] },
      [CAROL]: { email: "carol@example.com", password: this.passwords[CAROL] },
    };
    this.pubConfigs = {};
  }

  private cntFollowers(idHex: string) {
    return this.follows.filter((f) => f.followeeId === idHex).length;
  }

  private cntFollowees(idHex: string) {
    return this.follows.filter((f) => f.followerId === idHex).length;
  }

  private rowFromUser(u: MockUser, includeEmail: boolean) {
    const base: any = {
      id: hexToDec(u.id),
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
    };
    if (includeEmail) base.email = this.userSecrets[u.id]?.email ?? null;
    return base;
  }

  async query(sql: string, params: any[] = []) {
    const n = normalizeSql(sql);

    if (n === "BEGIN" || n === "COMMIT" || n === "ROLLBACK") return { rows: [] };

    if (n === "SELECT user_id AS id FROM user_secrets WHERE email = $1") {
      const email = params[0];
      const found = Object.entries(this.userSecrets).find(([, v]) => v.email === email);
      return found ? { rows: [{ id: hexToDec(found[0]) }] } : { rows: [] };
    }

    if (n === "SELECT 1 FROM user_details WHERE user_id = $1 LIMIT 1") {
      const userId = decToHex(params[0]);
      const exists = !!this.details[userId];
      return { rowCount: exists ? 1 : 0, rows: exists ? [{ ok: 1 }] : [] };
    }

    if (n === "SELECT locale FROM user_details WHERE user_id = $1 LIMIT 1") {
      const userId = decToHex(params[0]);
      const d = this.details[userId];
      return d ? { rows: [{ locale: d.locale }] } : { rows: [] };
    }

    if (n === "SELECT timezone FROM user_details WHERE user_id = $1 LIMIT 1") {
      const userId = decToHex(params[0]);
      const d = this.details[userId];
      return d ? { rows: [{ timezone: d.timezone }] } : { rows: [] };
    }

    if (n === "SELECT locale FROM users WHERE id = $1 LIMIT 1") {
      const userId = decToHex(params[0]);
      const d = this.details[userId];
      return d ? { rows: [{ locale: d.locale }] } : { rows: [] };
    }

    if (n === "SELECT timezone FROM users WHERE id = $1 LIMIT 1") {
      const userId = decToHex(params[0]);
      const d = this.details[userId];
      return d ? { rows: [{ timezone: d.timezone }] } : { rows: [] };
    }

    if (n.startsWith("SELECT COUNT(*) FROM users u")) {
      if (n.includes("WHERE (u.nickname ILIKE $1 OR d.introduction ILIKE $1)")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        const count = this.users.filter(
          (u) =>
            u.nickname.toLowerCase().includes(pat) ||
            (this.details[u.id]?.introduction ?? "").toLowerCase().includes(pat),
        ).length;
        return { rows: [{ count }] };
      }
      if (n.includes("WHERE u.nickname ILIKE $1")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        const count = this.users.filter((u) => u.nickname.toLowerCase().includes(pat)).length;
        return { rows: [{ count }] };
      }
      if (n.includes("WHERE LOWER(u.nickname) LIKE $1")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        const count = this.users.filter((u) => u.nickname.toLowerCase().startsWith(pat)).length;
        return { rows: [{ count }] };
      }
      return { rows: [{ count: this.users.length }] };
    }

    if (
      n.includes("FROM users u") &&
      n.includes("WHERE u.id = $1") &&
      !n.includes("JOIN LATERAL")
    ) {
      const idHex = decToHex(params[0]);
      const u = this.users.find((x) => x.id === idHex);
      if (!u) return { rows: [] };
      const includeDetails = n.includes("LEFT JOIN user_details d ON d.user_id = u.id");
      const includeEmail = n.includes("LEFT JOIN user_secrets s ON s.user_id = u.id");
      const base = this.rowFromUser(u, includeEmail);
      if (includeDetails) {
        const d = this.details[u.id] ?? {
          locale: "en-US",
          timezone: "UTC",
          introduction: "",
          aiPersonality: null,
        };
        (base as any).locale = d.locale;
        (base as any).timezone = d.timezone;
        (base as any).introduction = d.introduction;
        (base as any).ai_personality = d.aiPersonality;
      }
      return { rows: [base] };
    }

    if (n === SQL_FLAGS) {
      const [aDec, bDec] = params;
      const a = decToHex(aDec);
      const b = decToHex(bDec);
      const isFollowed = this.follows.some((f) => f.followerId === a && f.followeeId === b);
      const isFollowing = this.follows.some((f) => f.followerId === b && f.followeeId === a);
      const isBlocked = this.blocks.some((bl) => bl.blockerId === a && bl.blockeeId === b);
      const isBlocking = this.blocks.some((bl) => bl.blockerId === b && bl.blockeeId === a);
      return {
        rows: [
          {
            is_followed_by_focus_user: isFollowed,
            is_following_focus_user: isFollowing,
            is_blocked_by_focus_user: isBlocked,
            is_blocking_focus_user: isBlocking,
          },
        ],
      };
    }

    if (
      n ===
      "SELECT u.id, u.updated_at, u.nickname, u.avatar, u.locale, u.timezone, u.ai_model, u.snippet, u.is_admin, u.block_strangers, id_to_timestamp(u.id) AS created_at, COALESCE(uc.follower_count, 0) AS count_followers, COALESCE(uc.followee_count, 0) AS count_followees, COALESCE(uc.post_count, 0) AS count_posts FROM user_follows f JOIN users u ON f.followee_id = u.id LEFT JOIN user_counts uc ON uc.user_id = u.id WHERE f.follower_id = $1 ORDER BY f.created_at DESC, f.followee_id DESC OFFSET $2 LIMIT $3"
    ) {
      const followerId = decToHex(params[0]);
      const offset = params[1] || 0;
      const limit = params[2] || 100;
      const list = this.follows
        .filter((f) => f.followerId === followerId)
        .map((f) => this.users.find((u) => u.id === f.followeeId))
        .filter((u): u is MockUser => !!u)
        .slice(offset, offset + limit)
        .map((u) => this.rowFromUser(u, false));
      return { rows: list };
    }

    if (
      n ===
      "SELECT u.id, u.updated_at, u.nickname, u.avatar, u.locale, u.timezone, u.ai_model, u.snippet, u.is_admin, u.block_strangers, id_to_timestamp(u.id) AS created_at, COALESCE(uc.follower_count, 0) AS count_followers, COALESCE(uc.followee_count, 0) AS count_followees, COALESCE(uc.post_count, 0) AS count_posts FROM user_follows f JOIN users u ON f.follower_id = u.id LEFT JOIN user_counts uc ON uc.user_id = u.id WHERE f.followee_id = $1 ORDER BY f.created_at DESC, f.follower_id DESC OFFSET $2 LIMIT $3"
    ) {
      const followeeId = decToHex(params[0]);
      const offset = params[1] || 0;
      const limit = params[2] || 100;
      const list = this.follows
        .filter((f) => f.followeeId === followeeId)
        .map((f) => this.users.find((u) => u.id === f.followerId))
        .filter((u): u is MockUser => !!u)
        .slice(offset, offset + limit)
        .map((u) => this.rowFromUser(u, false));
      return { rows: list };
    }

    if (n.includes("FROM users u") && !n.includes("WHERE u.id = $1") && !n.startsWith("WITH")) {
      let list = [...this.users];
      if (n.includes("WHERE (u.nickname ILIKE $1 OR d.introduction ILIKE $1)")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter(
          (u) =>
            u.nickname.toLowerCase().includes(pat) ||
            (this.details[u.id]?.introduction ?? "").toLowerCase().includes(pat),
        );
      } else if (n.includes("WHERE u.nickname ILIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().includes(pat));
      } else if (n.includes("WHERE LOWER(u.nickname) LIKE")) {
        const pat = params[0].toLowerCase().replace(/%/g, "");
        list = list.filter((u) => u.nickname.toLowerCase().startsWith(pat));
      }
      const offset = params[params.length - 2] || 0;
      const limit = params[params.length - 1] || 100;
      const asc = n.includes("ORDER BY u.id ASC");
      list.sort((a, b) =>
        BigInt("0x" + a.id) > BigInt("0x" + b.id) ? (asc ? 1 : -1) : asc ? -1 : 1,
      );
      const rows = list.slice(offset, offset + limit).map((u) => this.rowFromUser(u, false));
      return { rows };
    }

    if (
      n === "SELECT followee_id FROM user_follows WHERE follower_id = $1 AND followee_id = ANY($2)"
    ) {
      const focus = decToHex(params[0]);
      const targets: string[] = (params[1] as any[]).map(decToHex);
      return {
        rows: this.follows
          .filter((f) => f.followerId === focus && targets.includes(f.followeeId))
          .map((f) => ({ followee_id: hexToDec(f.followeeId) })),
      };
    }

    if (
      n === "SELECT follower_id FROM user_follows WHERE follower_id = ANY($1) AND followee_id = $2"
    ) {
      const sources: string[] = (params[0] as any[]).map(decToHex);
      const focus = decToHex(params[1]);
      return {
        rows: this.follows
          .filter((f) => sources.includes(f.followerId) && f.followeeId === focus)
          .map((f) => ({ follower_id: hexToDec(f.followerId) })),
      };
    }

    if (n === "SELECT blockee_id FROM user_blocks WHERE blocker_id = $1 AND blockee_id = ANY($2)") {
      const focus = decToHex(params[0]);
      const targets: string[] = (params[1] as any[]).map(decToHex);
      return {
        rows: this.blocks
          .filter((b) => b.blockerId === focus && targets.includes(b.blockeeId))
          .map((b) => ({ blockee_id: hexToDec(b.blockeeId) })),
      };
    }

    if (n === "SELECT blocker_id FROM user_blocks WHERE blocker_id = ANY($1) AND blockee_id = $2") {
      const sources: string[] = (params[0] as any[]).map(decToHex);
      const focus = decToHex(params[1]);
      return {
        rows: this.blocks
          .filter((b) => sources.includes(b.blockerId) && b.blockeeId === focus)
          .map((b) => ({ blocker_id: hexToDec(b.blockerId) })),
      };
    }

    if (n === "SELECT 1 FROM user_secrets WHERE email = $1") {
      const email = params[0];
      const exists = Object.values(this.userSecrets).some((s) => s.email === email);
      return { rows: exists ? [1] : [] };
    }

    if (
      n ===
      "INSERT INTO users ( id, updated_at, nickname, snippet, avatar, locale, timezone, ai_model, is_admin, block_strangers ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)"
    ) {
      const [idDec, nickname, snippet, avatar, locale, timezone, aiModel, isAdmin, blockStrangers] =
        params;
      const idHex = decToHex(idDec);
      const createdAt = new Date().toISOString();
      const user: MockUser = {
        id: idHex,
        nickname,
        isAdmin: !!isAdmin,
        blockStrangers: !!blockStrangers,
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
      this.details[idHex] = {
        locale: locale ?? "en-US",
        timezone: timezone ?? "UTC",
        introduction: "",
        aiPersonality: null,
      };
      return { rowCount: 1, rows: [] };
    }

    if (
      n ===
      "INSERT INTO users ( id, updated_at, nickname, avatar, locale, timezone, ai_model, snippet, is_admin, block_strangers ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)"
    ) {
      const [idDec, nickname, avatar, locale, timezone, aiModel, snippet, isAdmin, blockStrangers] =
        params;
      const idHex = decToHex(idDec);
      const createdAt = new Date().toISOString();
      const user: MockUser = {
        id: idHex,
        nickname,
        isAdmin: !!isAdmin,
        blockStrangers: !!blockStrangers,
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
      this.details[idHex] = {
        locale: locale ?? "en-US",
        timezone: timezone ?? "UTC",
        introduction: "",
        aiPersonality: null,
      };
      return { rowCount: 1, rows: [] };
    }

    if (n.startsWith(SQL_INSERT_USERS_PREFIX)) {
      const [idDec, nickname, isAdmin, blockStrangers, snippet, avatar, aiModel] = params;
      const idHex = decToHex(idDec);
      const createdAt = new Date().toISOString();
      const user: MockUser = {
        id: idHex,
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
      return { rowCount: 1, rows: [] };
    }

    if (n === "INSERT INTO user_secrets (user_id, email, password) VALUES ($1, $2, $3)") {
      const [idDec, email, password] = params;
      const idHex = decToHex(idDec);
      const pwHex = Buffer.isBuffer(password)
        ? password.toString("hex")
        : typeof password === "string"
          ? password
          : String(password);
      this.userSecrets[idHex] = { email, password: pwHex };
      this.passwords[idHex] = pwHex;
      return { rowCount: 1, rows: [] };
    }

    if (n === SQL_UPSERT_DETAILS_OVERWRITE) {
      const [userIdDec, locale, timezone, introduction, aiPersonality] = params;
      const userId = decToHex(userIdDec);
      this.details[userId] = {
        locale: locale ?? "en-US",
        timezone: timezone ?? "UTC",
        introduction: introduction ?? "",
        aiPersonality: aiPersonality ?? null,
      };
      return { rowCount: 1, rows: [] };
    }

    if (
      n ===
      "INSERT INTO user_details (user_id, introduction, ai_personality) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET introduction = EXCLUDED.introduction, ai_personality = EXCLUDED.ai_personality"
    ) {
      const [userIdDec, introduction, aiPersonality] = params;
      const userId = decToHex(userIdDec);
      const prev = this.details[userId] ?? {
        locale: "en-US",
        timezone: "UTC",
        introduction: "",
        aiPersonality: null,
      };
      this.details[userId] = {
        locale: prev.locale,
        timezone: prev.timezone,
        introduction: introduction ?? "",
        aiPersonality: aiPersonality ?? null,
      };
      return { rowCount: 1, rows: [] };
    }

    if (n === SQL_UPSERT_DETAILS_LOCALE_TZ) {
      const [userIdDec, locale, timezone] = params;
      const userId = decToHex(userIdDec);
      const prev = this.details[userId] ?? {
        locale: "en-US",
        timezone: "UTC",
        introduction: "",
        aiPersonality: null,
      };
      this.details[userId] = {
        ...prev,
        locale: locale ?? prev.locale,
        timezone: timezone ?? prev.timezone,
      };
      return { rowCount: 1, rows: [] };
    }

    if (n === SQL_UPSERT_DETAILS) {
      const [userIdDec, introduction, aiPersonality] = params;
      const userId = decToHex(userIdDec);
      const prev = this.details[userId] ?? {
        locale: "en-US",
        timezone: "UTC",
        introduction: "",
        aiPersonality: null,
      };
      this.details[userId] = {
        locale: prev.locale,
        timezone: prev.timezone,
        introduction: introduction ?? prev.introduction,
        aiPersonality: aiPersonality ?? prev.aiPersonality,
      };
      return { rowCount: 1, rows: [] };
    }

    if (
      n ===
      "UPDATE user_details SET locale = COALESCE($2, locale), timezone = COALESCE($3, timezone) WHERE user_id = $1"
    ) {
      const [userIdDec, locale, timezone] = params;
      const userId = decToHex(userIdDec);
      const prev = this.details[userId] ?? {
        locale: "en-US",
        timezone: "UTC",
        introduction: "",
        aiPersonality: null,
      };
      this.details[userId] = {
        ...prev,
        locale: locale ?? prev.locale,
        timezone: timezone ?? prev.timezone,
      };
      return { rowCount: 1, rows: [] };
    }

    if (
      n ===
      "UPDATE user_details SET introduction = COALESCE($2, introduction), ai_personality = COALESCE($3, ai_personality) WHERE user_id = $1"
    ) {
      const [userIdDec, introduction, aiPersonality] = params;
      const userId = decToHex(userIdDec);
      const prev = this.details[userId] ?? {
        locale: "en-US",
        timezone: "UTC",
        introduction: "",
        aiPersonality: null,
      };
      this.details[userId] = {
        ...prev,
        introduction: introduction ?? prev.introduction,
        aiPersonality: aiPersonality ?? prev.aiPersonality,
      };
      return { rowCount: 1, rows: [] };
    }

    if (n === "UPDATE user_secrets SET email = $1 WHERE user_id = $2") {
      const [email, idDec] = params;
      const idHex = decToHex(idDec);
      if (!this.userSecrets[idHex]) return { rowCount: 0 };
      this.userSecrets[idHex].email = email;
      return { rowCount: 1 };
    }

    if (n === "UPDATE user_secrets SET password = $1 WHERE user_id = $2") {
      const [password, idDec] = params;
      const idHex = decToHex(idDec);
      if (!this.userSecrets[idHex]) return { rowCount: 0 };
      const pwHex = Buffer.isBuffer(password)
        ? password.toString("hex")
        : typeof password === "string"
          ? password
          : String(password);
      this.userSecrets[idHex].password = pwHex;
      this.passwords[idHex] = pwHex;
      return { rowCount: 1 };
    }

    if (n.startsWith("UPDATE users SET ")) {
      const idHex = decToHex(params[params.length - 1]);
      const u = this.users.find((x) => x.id === idHex);
      if (!u) return { rowCount: 0, rows: [] };
      const setSeg = n.slice("UPDATE users SET ".length, n.indexOf(" WHERE id = $")).trim();
      const parts = setSeg.split(",").map((s) => s.trim());
      let idx = 0;
      for (const p of parts) {
        if (p.startsWith("nickname = $")) u.nickname = params[idx++] as string;
        else if (p.startsWith("is_admin = $")) u.isAdmin = !!params[idx++];
        else if (p.startsWith("block_strangers = $")) u.blockStrangers = !!params[idx++];
        else if (p.startsWith("avatar = $")) u.avatar = params[idx++] ?? null;
        else if (p.startsWith("ai_model = $")) u.aiModel = params[idx++] ?? null;
        else if (p.startsWith("snippet = $")) u.snippet = params[idx++] as string;
        else if (p.startsWith("updated_at = now()")) {
        } else {
          idx++;
        }
      }
      u.updatedAt = new Date().toISOString();
      return { rowCount: 1, rows: [] };
    }

    if (n === "DELETE FROM users WHERE id = $1") {
      const idHex = decToHex(params[0]);
      const i = this.users.findIndex((x) => x.id === idHex);
      if (i === -1) return { rowCount: 0 };
      this.users.splice(i, 1);
      delete this.details[idHex];
      delete this.userSecrets[idHex];
      delete this.passwords[idHex];
      this.follows = this.follows.filter((f) => f.followerId !== idHex && f.followeeId !== idHex);
      this.blocks = this.blocks.filter((b) => b.blockerId !== idHex && b.blockeeId !== idHex);
      return { rowCount: 1 };
    }

    if (n.startsWith("INSERT INTO user_follows (follower_id, followee_id, created_at) VALUES")) {
      const [fDec, eDec] = params;
      const followerId = decToHex(fDec);
      const followeeId = decToHex(eDec);
      if (!this.follows.some((f) => f.followerId === followerId && f.followeeId === followeeId)) {
        this.follows.push({ followerId, followeeId });
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    if (n === "DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2") {
      const followerId = decToHex(params[0]);
      const followeeId = decToHex(params[1]);
      const prev = this.follows.length;
      this.follows = this.follows.filter(
        (f) => !(f.followerId === followerId && f.followeeId === followeeId),
      );
      return { rowCount: prev - this.follows.length };
    }

    if (n === "SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2 LIMIT 1") {
      const followerId = decToHex(params[0]);
      const followeeId = decToHex(params[1]);
      const exists = this.follows.some(
        (f) => f.followerId === followerId && f.followeeId === followeeId,
      );
      return { rowCount: exists ? 1 : 0, rows: exists ? [{ ok: 1 }] : [] };
    }

    if (n.startsWith("SELECT u.id, u.nickname")) {
      if (n.includes("FROM user_follows f JOIN users u ON f.followee_id = u.id")) {
        const followerId = decToHex(params[0]);
        const offset = params[1] || 0;
        const limit = params[2] || 100;
        const list = this.follows
          .filter((f) => f.followerId === followerId)
          .map((f) => this.users.find((u) => u.id === f.followeeId))
          .filter((u): u is MockUser => !!u)
          .slice(offset, offset + limit)
          .map((u) => this.rowFromUser(u, false));
        return { rows: list };
      }
      if (n.includes("FROM user_follows f JOIN users u ON f.follower_id = u.id")) {
        const followeeId = decToHex(params[0]);
        const offset = params[1] || 0;
        const limit = params[2] || 100;
        const list = this.follows
          .filter((f) => f.followeeId === followeeId)
          .map((f) => this.users.find((u) => u.id === f.followerId))
          .filter((u): u is MockUser => !!u)
          .slice(offset, offset + limit)
          .map((u) => this.rowFromUser(u, false));
        return { rows: list };
      }
    }

    if (n.startsWith("INSERT INTO user_blocks (blocker_id, blockee_id, created_at) VALUES")) {
      const [bDec, eDec] = params;
      const blockerId = decToHex(bDec);
      const blockeeId = decToHex(eDec);
      if (!this.blocks.some((b) => b.blockerId === blockerId && b.blockeeId === blockeeId)) {
        this.blocks.push({ blockerId, blockeeId });
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }

    if (n === "DELETE FROM user_blocks WHERE blocker_id = $1 AND blockee_id = $2") {
      const blockerId = decToHex(params[0]);
      const blockeeId = decToHex(params[1]);
      const prev = this.blocks.length;
      this.blocks = this.blocks.filter(
        (b) => !(b.blockerId === blockerId && b.blockeeId === blockeeId),
      );
      return { rowCount: prev - this.blocks.length };
    }

    if (n === "SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blockee_id = $2 LIMIT 1") {
      const blockerId = decToHex(params[0]);
      const blockeeId = decToHex(params[1]);
      const exists = this.blocks.some(
        (b) => b.blockerId === blockerId && b.blockeeId === blockeeId,
      );
      return { rowCount: exists ? 1 : 0, rows: exists ? [{ ok: 1 }] : [] };
    }

    if (n === SQL_SELECT_PUBCONFIG) {
      const userId = decToHex(params[0]);
      const cfg = this.pubConfigs[userId];
      const locale = this.details[userId]?.locale ?? null;
      if (cfg) {
        return {
          rows: [
            {
              ...cfg,
              locale,
            },
          ],
        };
      }
      return { rows: [] };
    }

    if (n === SQL_UPSERT_PUBCONFIG) {
      const [
        userIdDec,
        siteName,
        subtitle,
        author,
        introduction,
        designTheme,
        showServiceHeader,
        showSiteName,
        showPagenation,
        showSideProfile,
        showSideRecent,
      ] = params;
      const userId = decToHex(userIdDec);
      const row = {
        site_name: siteName ?? "",
        subtitle: subtitle ?? "",
        author: author ?? "",
        introduction: introduction ?? "",
        design_theme: designTheme ?? "",
        show_service_header: !!showServiceHeader,
        show_site_name: !!showSiteName,
        show_pagenation: !!showPagenation,
        show_side_profile: !!showSideProfile,
        show_side_recent: !!showSideRecent,
      };
      this.pubConfigs[userId] = row;
      return { rows: [row] };
    }

    if (
      n.startsWith("WITH self AS (") &&
      n.includes("candidates AS (") &&
      n.includes("JOIN users u ON u.id = p.id") &&
      n.includes("ORDER BY p.prio, p.nkey, u.id")
    ) {
      const likePattern: string = params[0];
      const focusUserIdHex: string = decToHex(params[1]);
      const offset: number = params[2] ?? 0;
      const limit: number = params[3] ?? 20;
      const k: number = params[4] ?? offset + limit;
      const prefix = likePattern.toLowerCase().replace(/%+$/g, "");
      const match = (u: MockUser) => u.nickname.toLowerCase().startsWith(prefix);
      const hasSelf = n.includes("self AS (");
      const hasOthers = n.includes("others AS (");
      const candidates: Array<{ prio: number; id: string; nkey: string }> = [];
      if (hasSelf) {
        const selfUser = this.users.find((u) => u.id === focusUserIdHex && match(u));
        if (selfUser)
          candidates.push({ prio: 0, id: selfUser.id, nkey: selfUser.nickname.toLowerCase() });
      }
      const followeeIds = this.follows
        .filter((f) => f.followerId === focusUserIdHex)
        .map((f) => f.followeeId);
      const followees = this.users
        .filter((u) => followeeIds.includes(u.id) && match(u))
        .sort(
          (a, b) =>
            a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase()) ||
            (BigInt("0x" + a.id) > BigInt("0x" + b.id) ? 1 : -1),
        )
        .slice(0, k);
      for (const u of followees)
        candidates.push({ prio: 1, id: u.id, nkey: u.nickname.toLowerCase() });
      if (hasOthers) {
        const others = this.users
          .filter((u) => match(u))
          .sort(
            (a, b) =>
              a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase()) ||
              (BigInt("0x" + a.id) > BigInt("0x" + b.id) ? 1 : -1),
          )
          .slice(0, k);
        for (const u of others)
          candidates.push({ prio: 3, id: u.id, nkey: u.nickname.toLowerCase() });
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
        .filter((u): u is MockUser => !!u)
        .map((u) => this.rowFromUser(u, false));
      return { rows };
    }

    throw new Error("Unknown SQL: " + n);
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
    expect(u?.aiModel).toBe("gpt-4.1");
    expect((u as any).email).toBeUndefined();
  });

  test("getUserLocale", async () => {
    const locale = await service.getUserLocale(ALICE);
    expect(locale).toBe("ja-JP");
  });

  test("getUserTimezone", async () => {
    const tz = await service.getUserTimezone(ALICE);
    expect(tz).toBe("Asia/Tokyo");
  });

  test("getUser (with focusUserId) returns email in detail", async () => {
    const user = await service.getUser(ALICE, BOB);
    expect(user?.id).toBe(ALICE);
    expect(user?.countFollowers).toBe(2);
    expect(user?.countFollowees).toBe(2);
    expect(user?.countPosts).toBe(0);
    expect(user?.isFollowedByFocusUser).toBe(true);
    expect(user?.isFollowingFocusUser).toBe(true);
    expect(user?.introduction).toBe("introA");
    expect((user as any).email).toBe("alice@example.com");
  });

  test("listUsers (with focusUserId) does not include email", async () => {
    const users = await service.listUsers({}, BOB);
    const alice = users.find((u) => u.id === ALICE)!;
    expect(alice.countFollowees).toBe(2);
    expect(alice.countPosts).toBe(0);
    expect(alice.isFollowedByFocusUser).toBe(true);
    expect(alice.isFollowingFocusUser).toBe(true);
    expect((alice as any).email).toBeUndefined();
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

  test("createUser and getUser (detail includes email/locale/timezone)", async () => {
    const user = await service.createUser({
      email: "dan@example.com",
      nickname: "Dan",
      password: "danpass",
      isAdmin: false,
      blockStrangers: false,
      locale: "en-US",
      timezone: "America/Los_Angeles",
      introduction: "introD",
      avatar: null,
      aiModel: "gpt-4.1",
      aiPersonality: "D",
    });
    expect(pg.userSecrets[user.id]?.email).toBe("dan@example.com");
    const detail = await service.getUser(user.id);
    expect((detail as any).email).toBe("dan@example.com");
    expect(detail?.locale).toBe("en-US");
    expect(detail?.timezone).toBe("America/Los_Angeles");
    expect(pg.passwords[user.id]).toBe(md5("danpass"));
    expect(pg.details[user.id]?.introduction).toBe("introD");
    expect(pg.details[user.id]?.aiPersonality).toBe("D");
  });

  test("updateUser (including details) and verify email via detail", async () => {
    const updated = await service.updateUser({
      id: ALICE,
      email: "alice2@example.com",
      nickname: "Alice2",
      isAdmin: true,
      blockStrangers: true,
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
      introduction: "introX",
      avatar: null,
      aiModel: "gpt-4.1-mini",
      aiPersonality: "X",
    });
    expect(updated?.isAdmin).toBe(true);
    expect(updated?.blockStrangers).toBe(true);
    const detail = await service.getUser(ALICE);
    expect((detail as any).email).toBe("alice2@example.com");
    expect(detail?.locale).toBe("ja-JP");
    expect(detail?.timezone).toBe("Asia/Tokyo");
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
    expect(pg.userSecrets[ALICE].email).toBe("alice2@example.com");
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
    const email = "alice@example.com";
    const { resetPasswordId, webCode } = await service.startResetPassword(email);
    const stored = redis.store[`resetPassword:${resetPasswordId}`];
    expect(stored.userId).toBe(ALICE);
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

  test("getPubConfig returns defaults when not set", async () => {
    const cfg = await service.getPubConfig(ALICE);
    expect(cfg).toEqual({
      siteName: "",
      subtitle: "",
      author: "",
      introduction: "",
      designTheme: "",
      showServiceHeader: true,
      showSiteName: true,
      showPagenation: true,
      showSideProfile: true,
      showSideRecent: true,
      locale: "ja-JP",
    });
  });

  test("setPubConfig upserts and subsequent get returns saved values", async () => {
    const cfg1 = {
      siteName: "My Site",
      subtitle: "Go Wild",
      author: "Alice",
      introduction: "Hello",
      designTheme: "default",
      showServiceHeader: true,
      showSiteName: true,
      showPagenation: true,
      showSideProfile: true,
      showSideRecent: false,
    };
    const saved1 = await service.setPubConfig(ALICE, cfg1);
    expect(saved1).toEqual(cfg1);
    const got1 = await service.getPubConfig(ALICE);
    expect(got1).toEqual({ ...cfg1, locale: "ja-JP" });
    expect(pg.pubConfigs[ALICE]).toEqual({
      site_name: "My Site",
      subtitle: "Go Wild",
      author: "Alice",
      introduction: "Hello",
      design_theme: "default",
      show_service_header: true,
      show_site_name: true,
      show_pagenation: true,
      show_side_profile: true,
      show_side_recent: false,
    });
    const cfg2 = {
      siteName: "My Awesome Site",
      subtitle: "Go East",
      author: "Alice T.",
      introduction: "Updated intro",
      designTheme: "dark",
      showServiceHeader: false,
      showSiteName: false,
      showPagenation: false,
      showSideProfile: false,
      showSideRecent: true,
    };
    const saved2 = await service.setPubConfig(ALICE, cfg2);
    expect(saved2).toEqual(cfg2);
    const got2 = await service.getPubConfig(ALICE);
    expect(got2).toEqual({ ...cfg2, locale: "ja-JP" });
    expect(pg.pubConfigs[ALICE]).toEqual({
      site_name: "My Awesome Site",
      subtitle: "Go East",
      author: "Alice T.",
      introduction: "Updated intro",
      design_theme: "dark",
      show_service_header: false,
      show_site_name: false,
      show_pagenation: false,
      show_side_profile: false,
      show_side_recent: true,
    });
  });
});
