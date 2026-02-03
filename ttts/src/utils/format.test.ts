import { makeFtsQuery } from "./format";
import { Tokenizer } from "./tokenizer";

describe("makeFtsQuery", () => {
  beforeAll(async () => {
    await Tokenizer.getInstance();
  });

  test("flattens quoted phrases with AND when supportPhrase is false", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10, false);
    expect(result).toBe("hop AND step AND hot AND dog");
  });

  test("uses spaces for quoted phrases when supportPhrase is true", async () => {
    const result = await makeFtsQuery('hop step "hot dog"', "en", 10, true);
    expect(result).toBe("hop AND step AND hot dog");
  });

  test("normalizes symbols and letters", async () => {
    const result = await makeFtsQuery("a* AND (b% OR C's)", "en", 10, false);
    expect(result).toBe("a AND and AND b AND or AND c's");
  });

  test("tokenizes Japanese compound words into AND query", async () => {
    const result = await makeFtsQuery("電子ピアノ", "ja", 10, false);
    expect(result).toBe("電子 AND ピアノ");
  });

  test("handles Japanese phrases correctly based on supportPhrase flag", async () => {
    const q = '"電子ピアノ"';
    expect(await makeFtsQuery(q, "ja", 10, false)).toBe("電子 AND ピアノ");
    expect(await makeFtsQuery(q, "ja", 10, true)).toBe("電子 ピアノ");
  });

  test("respects maxTokens across mixed types", async () => {
    const result = await makeFtsQuery('one "two three four" five', "en", 3, false);
    expect(result).toBe("one AND two AND three");
  });

  test("returns empty string for empty input", async () => {
    expect(await makeFtsQuery("   ", "en", 10)).toBe("");
  });
});
