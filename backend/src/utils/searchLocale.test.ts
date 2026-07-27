import { resolvePostIndexLocale } from "./searchLocale";

describe("resolvePostIndexLocale", () => {
  test("uses the post locale when it is set", () => {
    expect(resolvePostIndexLocale("fr-FR", "ja-JP", "en-US")).toBe("fr-FR");
  });

  test("uses the owner locale when the post locale is null", () => {
    expect(resolvePostIndexLocale(null, "ja-JP", "en-US")).toBe("ja-JP");
  });

  test("uses the default locale when both post and owner locales are null", () => {
    expect(resolvePostIndexLocale(null, null, "ja-JP")).toBe("ja-JP");
  });

  test("falls back to English when no locale is available", () => {
    expect(resolvePostIndexLocale(null, null, null)).toBe("en");
  });
});
