import {
  decodeStoredRgb16Channel,
  encodeStoredRgb16Channel,
} from "./rgb16-storage";

describe("RGB16 gamma-2 storage", () => {
  test.each([0, 0.01, 0.18, 1, 2, 4])("round-trips range-4 sample %p", (value) => {
    const stored = encodeStoredRgb16Channel(value, "gamma20", 4);
    const decoded = decodeStoredRgb16Channel(stored, "gamma20", 4);
    expect(decoded).toBeCloseTo(value, 4);
  });

  test("is monotonic across the extended range", () => {
    let previous = -1;
    for (let step = 0; step <= 4000; step += 1) {
      const value = step / 1000;
      const stored = encodeStoredRgb16Channel(value, "gamma20", 4);
      expect(stored).toBeGreaterThanOrEqual(previous);
      previous = stored;
    }
  });

  test("preserves the existing range-1 endpoints", () => {
    expect(encodeStoredRgb16Channel(0, "gamma20", 1)).toBe(0);
    expect(encodeStoredRgb16Channel(1, "gamma20", 1)).toBe(65535);
    expect(decodeStoredRgb16Channel(65535, "gamma20", 1)).toBe(1);
  });
});
