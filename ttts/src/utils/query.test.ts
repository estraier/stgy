import { makeFtsQuery } from "./query";
import { Tokenizer } from "./tokenizer";

describe("makeFtsQuery", () => {
  beforeAll(async () => {
    await Tokenizer.getInstance();
  });

  test("flattens quoted phrases with AND and extracts filter phrase when supportPhrase is false", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10, false);
    expect(result.ftsQuery).toBe("hop AND step AND hot AND dog");
    expect(result.filteringPhrases).toEqual(["hot dog"]);
  });

  test("does NOT add single-token quoted words to filter phrases", async () => {
    const result = await makeFtsQuery('"脚本"', "ja", 10, false);
    expect(result.ftsQuery).toBe("脚本");
    expect(result.filteringPhrases).toEqual([]);
  });

  test("adds multi-token quoted words to filter phrases", async () => {
    const result = await makeFtsQuery('"脚本家"', "ja", 10, false);
    expect(result.ftsQuery).toBe("脚本 AND 家");
    expect(result.filteringPhrases).toEqual(["脚本 家"]);
  });

  test("uses quotes for quoted phrases and empty filter list when supportPhrase is true", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10, true);
    expect(result.ftsQuery).toBe('hop AND step AND "hot dog"');
    expect(result.filteringPhrases).toEqual([]);
  });

  test("normalizes symbols and letters", async () => {
    const result = await makeFtsQuery("a* AND (b% OR C's)", "en", 10, false);
    expect(result.ftsQuery).toBe("a AND and AND b AND or AND c's");
    expect(result.filteringPhrases).toEqual([]);
  });

  test("tokenizes Japanese compound words into AND query", async () => {
    const result = await makeFtsQuery("電子ピアノ", "ja", 10, false);
    expect(result.ftsQuery).toBe("電子 AND ピアノ");
    expect(result.filteringPhrases).toEqual([]);
  });

  test("respects maxTokens across mixed types", async () => {
    const result = await makeFtsQuery('one "two three four" five', "en", 3, false);
    expect(result.ftsQuery).toBe("one AND two AND three");
    expect(result.filteringPhrases).toEqual(["two three"]);
  });

  test("returns empty string for empty input", async () => {
    const result = await makeFtsQuery("    ", "en", 10);
    expect(result.ftsQuery).toBe("");
    expect(result.filteringPhrases).toEqual([]);
  });
});
