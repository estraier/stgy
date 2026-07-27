import { parseCachedRecommendationIds, parseCachedSeedPool } from "./aiPosts";

describe("AI posts routes", () => {
  describe("recommendation cache parsing", () => {
    test("accepts an empty cached search-seed array", () => {
      expect(parseCachedSeedPool("[]")).toEqual([]);
    });

    test("accepts an empty cached recommendation array", () => {
      expect(parseCachedRecommendationIds("[]")).toEqual([]);
    });

    test("rejects invalid cached arrays", () => {
      expect(parseCachedSeedPool("{}")).toBeNull();
      expect(parseCachedRecommendationIds("{}")).toBeNull();
      expect(parseCachedRecommendationIds("[1, false]")).toBeNull();
    });

    test("preserves usable recommendation IDs from a cached array", () => {
      expect(parseCachedRecommendationIds('["a", 1, "b"]')).toEqual(["a", "b"]);
    });
  });
});
