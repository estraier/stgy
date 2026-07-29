import { getBrowserLocale, getLocaleCandidates, normalizeLocale } from "./locale";

describe("locale utilities", () => {
  test("normalizes separators and casing", () => {
    expect(normalizeLocale(" ja_JP ")).toBe("ja-JP");
    expect(normalizeLocale("EN-us")).toBe("en-US");
  });

  test("returns exact and base-language candidates", () => {
    expect(getLocaleCandidates("ja-JP")).toEqual(["ja-JP", "ja"]);
    expect(getLocaleCandidates("en")).toEqual(["en"]);
    expect(getLocaleCandidates("not a locale")).toEqual([]);
  });

  test("uses the first browser locale", () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        languages: ["ja-JP", "en-US"],
        language: "en-US",
      },
    });

    try {
      expect(getBrowserLocale()).toBe("ja-JP");
    } finally {
      if (originalNavigator) {
        Object.defineProperty(globalThis, "navigator", originalNavigator);
      } else {
        delete (globalThis as { navigator?: Navigator }).navigator;
      }
    }
  });
});
