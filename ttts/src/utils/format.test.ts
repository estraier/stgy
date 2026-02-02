import { makeFtsQuery } from "./format";
import { Tokenizer } from "./tokenizer";

describe("makeFtsQuery", () => {
  beforeAll(async () => {
    await Tokenizer.getInstance();
  });

  test("combines words with AND and preserves phrases using implicit FTS5 syntax", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10);
    // クォートなし。FTS5は "hot dog" を隣接フレーズとして扱う
    expect(result).toBe('hop AND step AND hot dog');
  });

  test("joins tokenized parts of a single word with AND", async () => {
    const result = await makeFtsQuery("hot-dog", "en", 10);
    expect(result).toBe("hot AND dog");
  });

  test("mixed phrases and words result in flat AND structure without quotes", async () => {
    const result = await makeFtsQuery('"hot dog" jump', "en", 10);
    expect(result).toBe('hot dog AND jump');
  });

  test("handles maxTokens correctly for both types", async () => {
    const result = await makeFtsQuery('one "two three" four', "en", 3);
    expect(result).toBe('one AND two three');
  });

  test("returns empty string for empty input", async () => {
    expect(await makeFtsQuery("   ", "en", 10)).toBe("");
  });

  test("strips empty tokens within phrases", async () => {
    const result = await makeFtsQuery('"hot,,,dog"', "en", 10);
    expect(result).toBe('hot dog');
  });

  test("tokenizes Japanese compound words into AND query", async () => {
    const result = await makeFtsQuery("電子ピアノ", "ja", 10);
    expect(result).toBe("電子 AND ピアノ");
  });

  test("tokenizes Japanese phrases into space-separated tokens", async () => {
    const result = await makeFtsQuery('"電子ピアノ"', "ja", 10);
    expect(result).toBe('電子 ピアノ');
  });

  test("handles mixed Japanese and English with locale guessing", async () => {
    const result = await makeFtsQuery('ヤマハの "電子ピアノ"', "en", 10);
    expect(result).toBe('ヤマハ AND の AND 電子 ピアノ');
  });
});
