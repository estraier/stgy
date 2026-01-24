import { Tokenizer } from "./tokenizer";

describe("Tokenizer", () => {
  let tokenizer: Tokenizer;

  beforeAll(async () => {
    tokenizer = await Tokenizer.create();
  });

  describe("guessLocale", () => {
    test("returns ja if hiragana is present", () => {
      const text = "こんにちは世界";
      expect(tokenizer.guessLocale(text, "en")).toBe("ja");
    });

    test("returns ja if katakana is present", () => {
      const text = "ラーメン食べたい";
      expect(tokenizer.guessLocale(text, "zh")).toBe("ja");
    });

    test("returns ko if hangul is present", () => {
      const text = "안녕하세요";
      expect(tokenizer.guessLocale(text, "en")).toBe("ko");
    });

    test("returns zh if han is present and input locale is zh", () => {
      const text = "你好世界";
      expect(tokenizer.guessLocale(text, "zh-CN")).toBe("zh");
    });

    test("returns ja if han is present and input locale is not zh", () => {
      const text = "海鸥";
      expect(tokenizer.guessLocale(text, "en")).toBe("ja");
    });

    test("returns input locale for other characters", () => {
      const text = "Hello World 123";
      expect(tokenizer.guessLocale(text, "fr")).toBe("fr");
    });
  });

  describe("tokenize", () => {
    describe("Japanese (ja)", () => {
      test("tokenizes using kuromoji", () => {
        const text = "私はカモメです";
        const tokens = tokenizer.tokenize(text, "ja");
        expect(tokens).toEqual(["私", "は", "カモメ", "です"]);
      });

      test("applies normalization", () => {
        const text = "1㌘のｳﾞｧｲｵﾘﾝＡＢＣ";
        const tokens = tokenizer.tokenize(text, "ja");
        expect(tokens).toEqual(["1", "グラム", "の", "ヴァイオリン", "abc"]);
      });
    });

    describe("Chinese (zh)", () => {
      test("tokenizes using intl segmenter", () => {
        const text = "我是海鸥";
        const tokens = tokenizer.tokenize(text, "zh");
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens).toContain("海鸥");
      });
    });

    describe("Korean (ko)", () => {
      test("tokenizes using intl segmenter", () => {
        const text = "나는 갈매기입니다";
        const tokens = tokenizer.tokenize(text, "ko");
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens).toContain("나는");
      });
    });

    describe("English/Other (en)", () => {
      test("splits by space and removes symbols", () => {
        const text = "We check-out 24/7!";
        const tokens = tokenizer.tokenize(text, "en");
        expect(tokens).toEqual(["we", "check", "out", "24", "7"]);
      });

      test("removes diacritics", () => {
        const text = "crème brûlée";
        const tokens = tokenizer.tokenize(text, "en");
        expect(tokens).toEqual(["creme", "brulee"]);
      });
    });

    describe("Edge Cases", () => {
      test("returns empty array for symbol only strings", () => {
        const text = "!!! ??? ***";
        const tokens = tokenizer.tokenize(text, "en");
        expect(tokens).toEqual([]);
      });

      test("returns empty array for empty string", () => {
        expect(tokenizer.tokenize("", "en")).toEqual([]);
      });
    });
  });
});
