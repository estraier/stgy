import { getFiniteNumberRange } from "./numeric";

describe("getFiniteNumberRange", () => {
  it("handles arrays larger than the JavaScript function argument limit", () => {
    const values = Array.from({ length: 200000 }, (_, index) => index - 100000);

    expect(getFiniteNumberRange(values)).toEqual({
      min: -100000,
      max: 99999,
    });
  });

  it("ignores non-finite values", () => {
    expect(getFiniteNumberRange([NaN, Infinity, 3, -2, -Infinity])).toEqual({
      min: -2,
      max: 3,
    });
    expect(getFiniteNumberRange([NaN, Infinity, -Infinity])).toBeUndefined();
  });
});
