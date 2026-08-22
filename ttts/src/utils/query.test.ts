import { makeFtsQuery } from "./query";
import { Tokenizer } from "./tokenizer";

describe("makeFtsQuery", () => {
  beforeAll(async () => {
    await Tokenizer.getInstance();
  });

  test("flattens quoted phrases with AND and extracts filter phrase when recordPositions is false", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10, false);
    expect(result.ftsQuery).toBe("hop AND step AND hot AND dog");
    expect(result.filteringPhrases).toEqual(["hot\ndog"]);
    expect(result.tokens).toEqual(["hop", "step", "hot", "dog"]);
    expect(result.phrases).toEqual(["hop", "step", "hot dog"]);
  });

  test("does NOT add single-token quoted words to filter phrases", async () => {
    const result = await makeFtsQuery('"脚本"', "ja", 10, false);
    expect(result.ftsQuery).toBe("脚本");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["脚本"]);
    expect(result.phrases).toEqual(["脚本"]);
  });

  test("adds multi-token quoted words to filter phrases", async () => {
    const result = await makeFtsQuery('"脚本家"', "ja", 10, false);
    expect(result.ftsQuery).toBe("脚本 AND 家");
    expect(result.filteringPhrases).toEqual(["脚本\n家"]);
    expect(result.tokens).toEqual(["脚本", "家"]);
    expect(result.phrases).toEqual(["脚本家"]);
  });

  test("splits quoted multi-token input when neither positions nor contents can enforce a phrase", async () => {
    const result = await makeFtsQuery('"脚本家"', "ja", 10, false, false);
    expect(result.ftsQuery).toBe("脚本 AND 家");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["脚本", "家"]);
    expect(result.phrases).toEqual(["脚本", "家"]);
  });

  test("uses positional phrases for quoted phrases when recordPositions is true", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10, true);
    expect(result.ftsQuery).toBe("hop AND step AND hot + dog");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["hop", "step", "hot", "dog"]);
    expect(result.phrases).toEqual(["hop", "step", "hot dog"]);
  });


  test("treats U+E000 as whitespace before parsing query units", async () => {
    const result = await makeFtsQuery("alpha\uE000beta", "en", 10, true);
    expect(result.ftsQuery).toBe("alpha AND beta");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["alpha", "beta"]);
    expect(result.phrases).toEqual(["alpha", "beta"]);
  });

  test("normalizes symbols and letters", async () => {
    const result = await makeFtsQuery("a* AND (b% OR C's)", "en", 10, false);
    expect(result.ftsQuery).toBe("a AND and AND b AND or AND \"c's\"");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["a", "and", "b", "or", "c's"]);
    expect(result.phrases).toEqual(["a", "and", "b", "or", "c's"]);
  });

  test("quotes technical terms that contain FTS5 syntax characters", async () => {
    const result = await makeFtsQuery("C++", "ja", 10, false);
    expect(result.ftsQuery).toBe('"c++"');
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["c++"]);
    expect(result.phrases).toEqual(["c++"]);
  });

  test("does not auto-check Japanese compound words when autoPhraseCheck is omitted", async () => {
    const result = await makeFtsQuery("電子ピアノ", "ja", 10, false);
    expect(result.ftsQuery).toBe("電子 AND ピアノ");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["電子", "ピアノ"]);
    expect(result.phrases).toEqual(["電子", "ピアノ"]);
  });

  test("auto-checks an unquoted multi-token CJK input as a phrase without positions", async () => {
    const result = await makeFtsQuery("脚本家", "ja", 10, false, true, true);
    expect(result.ftsQuery).toBe("脚本 AND 家");
    expect(result.filteringPhrases).toEqual(["脚本\n家"]);
    expect(result.tokens).toEqual(["脚本", "家"]);
    expect(result.phrases).toEqual(["脚本家"]);
  });

  test("does not auto-check CJK phrases when autoPhraseCheck is false", async () => {
    const result = await makeFtsQuery("脚本家", "ja", 10, false, true, false);
    expect(result.ftsQuery).toBe("脚本 AND 家");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["脚本", "家"]);
    expect(result.phrases).toEqual(["脚本", "家"]);
  });

  test("does not auto-check CJK phrases when recordContents is false", async () => {
    const result = await makeFtsQuery("脚本家", "ja", 10, false, false, true);
    expect(result.ftsQuery).toBe("脚本 AND 家");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["脚本", "家"]);
    expect(result.phrases).toEqual(["脚本", "家"]);
  });

  test("does not auto-check non-CJK unquoted multi-token input", async () => {
    const result = await makeFtsQuery("check-out", "en", 10, false, true, true);
    expect(result.ftsQuery).toBe("check AND out");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["check", "out"]);
    expect(result.phrases).toEqual(["check", "out"]);
  });

  test("keeps a Japanese input unit as one phrase when it tokenizes to one token", async () => {
    const result = await makeFtsQuery("管理者", "ja", 10, true);
    expect(result.ftsQuery).toBe("管理者");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["管理者"]);
    expect(result.phrases).toEqual(["管理者"]);
  });

  test("keeps separately space-delimited Japanese terms as separate phrases with positions", async () => {
    const result = await makeFtsQuery("インストール 設定", "ja", 10, true);
    expect(result.ftsQuery).toBe("インストール AND 設定");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["インストール", "設定"]);
    expect(result.phrases).toEqual(["インストール", "設定"]);
  });

  test("returns the actual Japanese tokens and the auto-checked KWIC phrase", async () => {
    const result = await makeFtsQuery("インストールや設定作業", "ja", 10, false, true, true);
    expect(result.ftsQuery).toBe("インストール AND や AND 設定 AND 作業");
    expect(result.filteringPhrases).toEqual(["インストール\nや\n設定\n作業"]);
    expect(result.tokens).toEqual(["インストール", "や", "設定", "作業"]);
    expect(result.phrases).toEqual(["インストールや設定作業"]);
  });

  test("returns an unquoted Japanese compound as one phrase when positions are available", async () => {
    const result = await makeFtsQuery("インストールや設定作業", "ja", 10, true);
    expect(result.ftsQuery).toBe("インストール + や + 設定 + 作業");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["インストール", "や", "設定", "作業"]);
    expect(result.phrases).toEqual(["インストールや設定作業"]);
  });

  test("tokenizes Japanese middle dots into separate query terms without positions", async () => {
    const result = await makeFtsQuery("ポール・ド・ヴィヴィ", "ja", 10, false);
    expect(result.ftsQuery).toBe("ポール AND ド AND ヴィヴィ");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["ポール", "ド", "ヴィヴィ"]);
    expect(result.phrases).toEqual(["ポール", "ド", "ヴィヴィ"]);
  });

  test("uses an unquoted middle-dot name as one positional phrase", async () => {
    const result = await makeFtsQuery("ポール・ド・ヴィヴィ", "ja", 10, true);
    expect(result.ftsQuery).toBe("ポール + ド + ヴィヴィ");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["ポール", "ド", "ヴィヴィ"]);
    expect(result.phrases).toEqual(["ポール・ド・ヴィヴィ"]);
  });

  test("preserves Japanese middle-dot names as filtered phrases without positions", async () => {
    const result = await makeFtsQuery('"ポール・ド・ヴィヴィ"', "ja", 10, false);
    expect(result.ftsQuery).toBe("ポール AND ド AND ヴィヴィ");
    expect(result.filteringPhrases).toEqual(["ポール\nド\nヴィヴィ"]);
    expect(result.tokens).toEqual(["ポール", "ド", "ヴィヴィ"]);
    expect(result.phrases).toEqual(["ポール・ド・ヴィヴィ"]);
  });

  test("preserves Japanese middle-dot names as FTS phrases with positions", async () => {
    const result = await makeFtsQuery('"ポール・ド・ヴィヴィ"', "ja", 10, true);
    expect(result.ftsQuery).toBe("ポール + ド + ヴィヴィ");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual(["ポール", "ド", "ヴィヴィ"]);
    expect(result.phrases).toEqual(["ポール・ド・ヴィヴィ"]);
  });

  test("preserves token and phrase order and duplicates", async () => {
    const result = await makeFtsQuery("foo foo bar", "en", 10, false);
    expect(result.ftsQuery).toBe("foo AND foo AND bar");
    expect(result.tokens).toEqual(["foo", "foo", "bar"]);
    expect(result.phrases).toEqual(["foo", "foo", "bar"]);
  });

  test("respects maxTokens across mixed types", async () => {
    const result = await makeFtsQuery('one "two three four" five', "en", 3, false);
    expect(result.ftsQuery).toBe("one AND two AND three");
    expect(result.filteringPhrases).toEqual(["two\nthree"]);
    expect(result.tokens).toEqual(["one", "two", "three"]);
    expect(result.phrases).toEqual(["one", "two three"]);
  });

  test("returns empty arrays for empty input", async () => {
    const result = await makeFtsQuery("    ", "en", 10);
    expect(result.ftsQuery).toBe("");
    expect(result.filteringPhrases).toEqual([]);
    expect(result.tokens).toEqual([]);
    expect(result.phrases).toEqual([]);
  });
});
