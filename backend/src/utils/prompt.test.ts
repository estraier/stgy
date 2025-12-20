import { readPrompt, evaluateChatResponseAsJson } from "./prompt";

describe("readPrompt with existing test prompt files", () => {
  test("ja_JP → prefers test-ja-JP.txt", () => {
    const text = readPrompt("test", "ja_JP");
    expect(text.trim()).toBe("ja-JP");
  });

  test("ja → uses test-ja.txt", () => {
    const text = readPrompt("test", "ja");
    expect(text.trim()).toBe("ja");
  });

  test("unknown locale → falls back to defaultLocale=en (test-en.txt)", () => {
    const text = readPrompt("test", "fr_FR");
    expect(text.trim()).toBe("en");
  });

  test("defaultLocale can be overridden (falls back to ja)", () => {
    const text = readPrompt("test", "fr_FR", "ja");
    expect(text.trim()).toBe("ja");
  });

  test("throws if no matching prompt file exists for any candidate", () => {
    expect(() => readPrompt("missing-prefix", "ja_JP")).toThrow();
  });
});

describe("evaluateChatResponseAsJson", () => {
  describe("Basic Parsing", () => {
    test("should parse valid simple JSON", () => {
      const input = '{"key": "value", "num": 123}';
      const result = evaluateChatResponseAsJson(input);
      expect(result).toEqual({ key: "value", num: 123 });
    });

    test("should parse JSON array", () => {
      const input = '[1, 2, "three"]';
      const result = evaluateChatResponseAsJson(input);
      expect(result).toEqual([1, 2, "three"]);
    });
  });

  describe("Format Cleaning (Markdown & Noise)", () => {
    test("should extract JSON from markdown code blocks", () => {
      const input = `
        Here is the data:
        \`\`\`json
        {
          "hello": "world"
        }
        \`\`\`
      `;
      const result = evaluateChatResponseAsJson(input);
      expect(result).toEqual({ hello: "world" });
    });

    test("should extract JSON from code blocks without language tag", () => {
      const input = '```\n{"a": 1}\n```';
      const result = evaluateChatResponseAsJson(input);
      expect(result).toEqual({ a: 1 });
    });

    test("should ignore text outside of JSON braces", () => {
      const input = 'Sure, here is it: {"foo": "bar"} hope this helps.';
      const result = evaluateChatResponseAsJson(input);
      expect(result).toEqual({ foo: "bar" });
    });

    test("should remove trailing commas in objects and arrays", () => {
      const inputObj = '{"a": 1, "b": 2, }';
      expect(evaluateChatResponseAsJson(inputObj)).toEqual({ a: 1, b: 2 });

      const inputArr = "[1, 2, 3, ]";
      expect(evaluateChatResponseAsJson(inputArr)).toEqual([1, 2, 3]);
    });
  });

  describe("Recovery Strategy (Unescaped Quotes)", () => {
    test("should fix unescaped quotes inside a value (The User Case)", () => {
      const input = `{
        "interest": "...対象の"実在"に直接向かう言葉の質を...",
        "tags": ["philosophy"]
      }`;

      const result = evaluateChatResponseAsJson<{ interest: string }>(input);
      expect(result.interest).toContain('対象の"実在"に直接向かう');
    });

    test("should fix multiple unescaped quotes in one line", () => {
      const input = `{
        "dialogue": "He said "Hello" and then "Goodbye"."
      }`;
      const result = evaluateChatResponseAsJson<{ dialogue: string }>(input);
      expect(result.dialogue).toBe('He said "Hello" and then "Goodbye".');
    });

    test("should NOT double-escape already escaped quotes", () => {
      const input = `{
        "valid": "This is \\"correctly\\" escaped."
      }`;
      const result = evaluateChatResponseAsJson<{ valid: string }>(input);
      expect(result.valid).toBe('This is "correctly" escaped.');
    });

    test("should handle mixed valid and invalid quotes", () => {
      const input = `{
        "mixed": "Valid \\"quote\\", but invalid "quote"."
      }`;
      const result = evaluateChatResponseAsJson<{ mixed: string }>(input);
      expect(result.mixed).toBe('Valid "quote", but invalid "quote".');
    });

    test("should work even with comma at the end of line", () => {
      const input = `{
        "key1": "value with "quote"",
        "key2": 123
      }`;
      const result = evaluateChatResponseAsJson<any>(input);
      expect(result.key1).toBe('value with "quote"');
      expect(result.key2).toBe(123);
    });
  });

  describe("Failure Cases", () => {
    test("should throw error for truly broken JSON", () => {
      const input = "{ broken json ";
      expect(() => evaluateChatResponseAsJson(input)).toThrow(SyntaxError);
    });
  });
});
