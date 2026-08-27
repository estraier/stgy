import type { PubConfigExtensions } from "../models/user";
import {
  PUB_CONFIG_EXTENSIONS_MAX_LENGTH,
  getPubCommentsMode,
  parsePubConfigExtensions,
  serializePubConfigExtensions,
  validatePubConfigExtensions,
} from "./pubConfigExtensions";

describe("pubConfigExtensions", () => {
  test("accepts current and unknown extension providers", () => {
    const extensions: PubConfigExtensions = {
      shareButtons: ["x", "facebook", "line", "hatena", "future_service"],
      analytics: {
        googleAnalytics: { measurementId: "G-TEST123" },
        futureAnalytics: { siteId: "abc" },
      },
      comments: { mode: "moderated" },
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

  test("validates comment modes and defaults comments to none", () => {
    expect(getPubCommentsMode({})).toBe("none");
    expect(getPubCommentsMode({ comments: { mode: "none" } })).toBe("none");
    expect(getPubCommentsMode({ comments: { mode: "moderated" } })).toBe("moderated");
    expect(getPubCommentsMode({ comments: { mode: "open" } })).toBe("open");
    expect(() => validatePubConfigExtensions({ comments: [] })).toThrow(
      "invalid extensions.comments",
    );
    expect(() => validatePubConfigExtensions({ comments: { mode: "invalid" } })).toThrow(
      "invalid extensions.comments.mode",
    );
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
