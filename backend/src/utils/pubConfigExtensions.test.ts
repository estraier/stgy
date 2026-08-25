import {
  PUB_CONFIG_EXTENSIONS_MAX_LENGTH,
  parsePubConfigExtensions,
  serializePubConfigExtensions,
  validatePubConfigExtensions,
} from "./pubConfigExtensions";

describe("pubConfigExtensions", () => {
  test("accepts current and unknown extension providers", () => {
    const extensions = {
      shareButtons: ["hatena", "x", "future_service"],
      analytics: {
        googleAnalytics: { measurementId: "G-TEST123" },
        futureAnalytics: { siteId: "abc" },
      },
      futureFeature: { enabled: true },
    };
    expect(validatePubConfigExtensions(extensions)).toBe(extensions);
    expect(parsePubConfigExtensions(serializePubConfigExtensions(extensions))).toEqual(
      extensions,
    );
  });

  test("rejects invalid known structures", () => {
    expect(() => validatePubConfigExtensions([])).toThrow("invalid extensions");
    expect(() => validatePubConfigExtensions({ shareButtons: "x" })).toThrow(
      "invalid extensions.shareButtons",
    );
    expect(() => validatePubConfigExtensions({ shareButtons: ["x", "x"] })).toThrow(
      "invalid extensions.shareButtons",
    );
    expect(() => validatePubConfigExtensions({ analytics: [] })).toThrow(
      "invalid extensions.analytics",
    );
    expect(() =>
      validatePubConfigExtensions({ analytics: { googleAnalytics: "G-TEST" } }),
    ).toThrow("invalid extensions.analytics");
  });

  test("enforces the 4096-character storage limit", () => {
    const prefixLength = '{"future":""}'.length;
    const exact = { future: "x".repeat(PUB_CONFIG_EXTENSIONS_MAX_LENGTH - prefixLength) };
    expect(Array.from(serializePubConfigExtensions(exact))).toHaveLength(
      PUB_CONFIG_EXTENSIONS_MAX_LENGTH,
    );
    expect(() =>
      serializePubConfigExtensions({
        future: "x".repeat(PUB_CONFIG_EXTENSIONS_MAX_LENGTH - prefixLength + 1),
      }),
    ).toThrow("extensions too long");
  });
});
