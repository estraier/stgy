import {
  normalizePubCommentBody,
  normalizePubCommentNickname,
  PUB_COMMENT_BODY_MAX_LENGTH,
  PUB_COMMENT_NICKNAME_MAX_LENGTH,
} from "./pubCommentNormalize";

describe("pub comment normalization", () => {
  test("normalizes a nickname", () => {
    expect(normalizePubCommentNickname("  太郎\n  山田\tさん  ")).toBe("太郎 山田さん");
  });

  test("enforces the nickname length in application code", () => {
    const nickname = "x".repeat(PUB_COMMENT_NICKNAME_MAX_LENGTH);
    expect(normalizePubCommentNickname(nickname)).toBe(nickname);
    expect(() =>
      normalizePubCommentNickname("x".repeat(PUB_COMMENT_NICKNAME_MAX_LENGTH + 1)),
    ).toThrow(/30/);
  });

  test("normalizes body line endings and blank lines", () => {
    expect(normalizePubCommentBody("\r\n\r\nabc\r\n\r\n\r\ndef\r\n\r\n")).toBe(
      "abc\n\ndef\n",
    );
  });

  test("removes controls, lone surrogates, and Unicode noncharacters", () => {
    expect(normalizePubCommentBody("a\u0000b\ud800c\ufdd0d")).toBe("abcd\n");
  });

  test("allows 1000 visible characters plus the mandatory final LF", () => {
    const body = "x".repeat(PUB_COMMENT_BODY_MAX_LENGTH);
    expect(normalizePubCommentBody(body)).toBe(`${body}\n`);
  });

  test("rejects overlong body", () => {
    expect(() => normalizePubCommentBody("x".repeat(PUB_COMMENT_BODY_MAX_LENGTH + 1))).toThrow(
      /1000/,
    );
  });
});
