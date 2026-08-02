import { AgreementTermsService, validateAgreementTermContents } from "./agreementTerms";

jest.mock("../utils/servers", () => ({
  pgQuery: jest.fn(async (pool: any, text: string, params?: any[]) => pool.query(text, params)),
}));

class MockPgPool {
  rows = new Map<string, string>();
  userAgreementTermIds = new Map<string, string | null>();

  async query(sql: string, params: any[] = []) {
    if (sql.includes("UPDATE user_secrets") && sql.includes("user_agreement_term_id")) {
      const userId = String(params[0]);
      const agreementTermId = String(params[1]);
      const latestId = [...this.rows.keys()].sort((a, b) =>
        BigInt(a) < BigInt(b) ? 1 : -1,
      )[0];
      if (!this.userAgreementTermIds.has(userId) || latestId !== agreementTermId) {
        return { rows: [], rowCount: 0 };
      }
      this.userAgreementTermIds.set(userId, agreementTermId);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("ORDER BY id DESC") && sql.includes("LIMIT 1")) {
      const ids = [...this.rows.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? 1 : -1);
      const id = ids[0];
      const out = id === undefined ? [] : [{ id, contents: this.rows.get(id)! }];
      return { rows: out, rowCount: out.length };
    }
    if (sql.includes("SELECT id, contents") && sql.includes("WHERE id = $1")) {
      const id = String(params[0]);
      const contents = this.rows.get(id);
      const out = contents === undefined ? [] : [{ id, contents }];
      return { rows: out, rowCount: out.length };
    }
    if (sql.includes("SELECT id") && sql.includes("ORDER BY id DESC")) {
      const out = [...this.rows.keys()]
        .sort((a, b) => BigInt(a) < BigInt(b) ? 1 : -1)
        .map((id) => ({ id }));
      return { rows: out, rowCount: out.length };
    }
    if (sql.includes("INSERT INTO user_agreement_terms")) {
      const id = String(params[0]);
      const contents = String(params[1]);
      this.rows.set(id, contents);
      return { rows: [{ id, contents }], rowCount: 1 };
    }
    if (sql.includes("DELETE FROM user_agreement_terms")) {
      const deleted = this.rows.delete(String(params[0]));
      return { rows: [], rowCount: deleted ? 1 : 0 };
    }
    throw new Error(`unsupported SQL: ${sql}`);
  }
}

describe("AgreementTermsService", () => {
  let pgPool: MockPgPool;
  let service: AgreementTermsService;

  beforeEach(() => {
    pgPool = new MockPgPool();
    service = new AgreementTermsService(pgPool as any);
  });

  it("puts, gets, lists, and replaces agreement terms", async () => {
    const id1 = "19F3FC04CB800000";
    const id2 = "19F4FC04CB800000";
    const contents1 = [
      { locale: "en", text: "hello world" },
      { locale: "ja_jp", text: "こんにちは" },
    ];
    const contents2 = [{ locale: "en", text: "new version" }];

    expect(await service.putAgreementTerm(id1, contents1)).toStrictEqual({
      id: id1,
      contents: [
        { locale: "en", text: "hello world" },
        { locale: "ja-JP", text: "こんにちは" },
      ],
    });
    await service.putAgreementTerm(id2, contents2);

    expect(await service.listAgreementTermIds()).toStrictEqual([id2, id1]);
    expect(await service.getLatestAgreementTerm()).toStrictEqual({ id: id2, contents: contents2 });
    expect(await service.getAgreementTerm(id1)).toStrictEqual({
      id: id1,
      contents: [
        { locale: "en", text: "hello world" },
        { locale: "ja-JP", text: "こんにちは" },
      ],
    });

    const replacement = [{ locale: "en", text: "replacement" }];
    expect(await service.putAgreementTerm(id1, replacement)).toStrictEqual({
      id: id1,
      contents: replacement,
    });
    expect(await service.getAgreementTerm(id1)).toStrictEqual({
      id: id1,
      contents: replacement,
    });
  });

  it("returns null for missing terms and reports deletion", async () => {
    const id = "19F3FC04CB800000";
    expect(await service.getLatestAgreementTerm()).toBeNull();
    expect(await service.getAgreementTerm(id)).toBeNull();
    expect(await service.deleteAgreementTerm(id)).toBe(false);

    await service.putAgreementTerm(id, [{ locale: "en", text: "hello" }]);
    expect(await service.deleteAgreementTerm(id)).toBe(true);
    expect(await service.getAgreementTerm(id)).toBeNull();
  });

  it("records agreement only for the latest term", async () => {
    const userId = "0001000000000001";
    const id1 = "19F3FC04CB800000";
    const id2 = "19F4FC04CB800000";
    const userIdDec = BigInt(`0x${userId}`).toString(10);
    const id1Dec = BigInt(`0x${id1}`).toString(10);
    const id2Dec = BigInt(`0x${id2}`).toString(10);
    pgPool.userAgreementTermIds.set(userIdDec, null);

    await service.putAgreementTerm(id1, [{ locale: "en", text: "version 1" }]);
    expect(await service.agreeToLatestAgreementTerm(userId, id1)).toBe(true);
    expect(pgPool.userAgreementTermIds.get(userIdDec)).toBe(id1Dec);

    await service.putAgreementTerm(id2, [{ locale: "en", text: "version 2" }]);
    expect(await service.agreeToLatestAgreementTerm(userId, id1)).toBe(false);
    expect(pgPool.userAgreementTermIds.get(userIdDec)).toBe(id1Dec);
    expect(await service.agreeToLatestAgreementTerm(userId, id2)).toBe(true);
    expect(pgPool.userAgreementTermIds.get(userIdDec)).toBe(id2Dec);
  });

  it("rejects invalid IDs", async () => {
    await expect(service.getAgreementTerm("not-an-id")).rejects.toThrow("invalid hex string");
    await expect(
      service.putAgreementTerm("not-an-id", [{ locale: "en", text: "hello" }]),
    ).rejects.toThrow("invalid hex string");
    await expect(service.deleteAgreementTerm("not-an-id")).rejects.toThrow(
      "invalid hex string",
    );
    await expect(
      service.agreeToLatestAgreementTerm("not-an-id", "19F3FC04CB800000"),
    ).rejects.toThrow("invalid hex string");
    await expect(
      service.agreeToLatestAgreementTerm("0001000000000001", "not-an-id"),
    ).rejects.toThrow("invalid hex string");
  });
});

describe("validateAgreementTermContents", () => {
  it("accepts multilingual plain text and normalizes locales", () => {
    expect(
      validateAgreementTermContents([
        { locale: "en", text: "hello\nworld" },
        { locale: "ja_jp", text: "こんにちは" },
      ]),
    ).toStrictEqual([
      { locale: "en", text: "hello\nworld" },
      { locale: "ja-JP", text: "こんにちは" },
    ]);
  });

  it.each([
    ["a non-array", { locale: "en", text: "hello" }],
    ["an empty array", []],
    ["an invalid item", ["hello"]],
    ["missing properties", [{ locale: "en" }]],
    ["extra properties", [{ locale: "en", text: "hello", html: false }]],
    ["an invalid locale", [{ locale: "bad locale", text: "hello" }]],
    [
      "duplicate normalized locales",
      [
        { locale: "en", text: "hello" },
        { locale: "EN", text: "hello again" },
      ],
    ],
    ["empty text", [{ locale: "en", text: "   " }]],
    ["no English fallback", [{ locale: "ja", text: "こんにちは" }]],
  ])("rejects %s", (_label, input) => {
    expect(() => validateAgreementTermContents(input)).toThrow();
  });

  it("rejects contents that exceed the database column limit", () => {
    expect(() =>
      validateAgreementTermContents([{ locale: "en", text: "x".repeat(262144) }]),
    ).toThrow("contents exceeds 262144 characters");
  });
});
