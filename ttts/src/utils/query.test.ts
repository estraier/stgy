import { makeFtsQuery } from "./query";
import { Tokenizer } from "./tokenizer";

describe("makeFtsQuery", () => {
  beforeAll(async () => {
    await Tokenizer.getInstance();
  });

  test("flattens quoted phrases with AND and extracts filter phrase when supportPhrase is false", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10, false);
    expect(result.ftsQuery).toBe("hop AND step AND hot AND dog");
    expect(result.filteringPhrases).toEqual(["hot\ndog"]);
    expect(result.tokens).toEqual(["hop", "step", "hot", "dog"]);
  });

  test("does NOT add single-token quoted words to filter phrases", async () => {
    const result = await makeFtsQuery('"脚本"', "ja", 10, false);
    expect(result.ftsQuery).toBe("脚本");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["脚本"]);
  });

  test("adds multi-token quoted words to filter phrases", async () => {
    const result = await makeFtsQuery('"脚本家"', "ja", 10, false);
    expect(result.ftsQuery).toBe("脚本 AND 家");
    expect(result.filteringPhrases).toEqual(["脚本\n家"]);
    expect(result.tokens).toEqual(["脚本", "家"]);
  });

  test("uses quotes for quoted phrases and empty filter list when supportPhrase is true", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10, true);
    expect(result.ftsQuery).toBe("hop AND step AND hot + dog");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["hop", "step", "hot", "dog"]);
  });

  test("normalizes symbols and letters", async () => {
    const result = await makeFtsQuery("a* AND (b% OR C's)", "en", 10, false);
    expect(result.ftsQuery).toBe("a AND and AND b AND or AND \"c's\"");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["a", "and", "b", "or", "c's"]);
  });

  test("quotes technical terms that contain FTS5 syntax characters", async () => {
    const result = await makeFtsQuery("C++", "ja", 10, false);
    expect(result.ftsQuery).toBe('"c++"');
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["c++"]);
  });

  test("tokenizes Japanese compound words into AND query", async () => {
    const result = await makeFtsQuery("電子ピアノ", "ja", 10, false);
    expect(result.ftsQuery).toBe("電子 AND ピアノ");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["電子", "ピアノ"]);
  });

  test("returns the actual Japanese tokens used by the search", async () => {
    const result = await makeFtsQuery("インストールや設定作業", "ja", 10, false);
    expect(result.ftsQuery).toBe("インストール AND や AND 設定 AND 作業");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["インストール", "や", "設定", "作業"]);
  });

  test("tokenizes Japanese middle dots into separate query terms", async () => {
    const result = await makeFtsQuery("ポール・ド・ヴィヴィ", "ja", 10, false);
    expect(result.ftsQuery).toBe("ポール AND ド AND ヴィヴィ");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["ポール", "ド", "ヴィヴィ"]);
  });

  test("preserves Japanese middle-dot names as filtered phrases without positions", async () => {
    const result = await makeFtsQuery('"ポール・ド・ヴィヴィ"', "ja", 10, false);
    expect(result.ftsQuery).toBe("ポール AND ド AND ヴィヴィ");
    expect(result.filteringPhrases).toEqual(["ポール\nド\nヴィヴィ"]);
    expect(result.tokens).toEqual(["ポール", "ド", "ヴィヴィ"]);
  });

  test("preserves Japanese middle-dot names as FTS phrases with positions", async () => {
    const result = await makeFtsQuery('"ポール・ド・ヴィヴィ"', "ja", 10, true);
    expect(result.ftsQuery).toBe("ポール + ド + ヴィヴィ");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["ポール", "ド", "ヴィヴィ"]);
  });

  test("preserves token order and duplicates in returned tokens", async () => {
    const result = await makeFtsQuery("foo foo bar", "en", 10, false);
    expect(result.ftsQuery).toBe("foo AND foo AND bar");
    expect(result.tokens).toEqual(["foo", "foo", "bar"]);
  });

  test("respects maxTokens across mixed types", async () => {
    const result = await makeFtsQuery('one "two three four" five', "en", 3, false);
    expect(result.ftsQuery).toBe("one AND two AND three");
    expect(result.filteringPhrases).toEqual(["two\nthree"]);
    expect(result.tokens).toEqual(["one", "two", "three"]);
  });

  test("returns empty string for empty input", async () => {
    const result = await makeFtsQuery("    ", "en", 10);
    expect(result.ftsQuery).toBe("");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual([]);
  });
});
