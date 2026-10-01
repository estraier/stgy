import { exactMedianUint16Tile } from "./median";

describe("exactMedianUint16Tile", () => {
  test("preserves a single image", () => {
    expect(Array.from(exactMedianUint16Tile([new Uint16Array([1, 5, 9])]))).toEqual([1, 5, 9]);
  });

  test("averages two images with the historical rounding rule", () => {
    const result = exactMedianUint16Tile([
      new Uint16Array([0, 10, 11]),
      new Uint16Array([1, 14, 20]),
    ]);
    expect(Array.from(result)).toEqual([1, 12, 16]);
  });

  test("uses the exact middle value for three images", () => {
    const result = exactMedianUint16Tile([
      new Uint16Array([9, 1, 7]),
      new Uint16Array([3, 8, 2]),
      new Uint16Array([5, 4, 6]),
    ]);
    expect(Array.from(result)).toEqual([5, 4, 6]);
  });

  test("averages the two middle values for an even image count", () => {
    const result = exactMedianUint16Tile([
      new Uint16Array([1, 100]),
      new Uint16Array([9, 10]),
      new Uint16Array([3, 30]),
      new Uint16Array([7, 20]),
    ]);
    expect(Array.from(result)).toEqual([5, 25]);
  });

  test("rejects inconsistent tile lengths", () => {
    expect(() => exactMedianUint16Tile([
      new Uint16Array([1, 2]),
      new Uint16Array([3]),
    ])).toThrow("inconsistent dimensions");
  });
});
