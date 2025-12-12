import { readPrompt } from "./prompt";

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
