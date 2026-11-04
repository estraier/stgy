import { applyUnitScaledSigmoid, createUnitScaledSigmoid } from "./scaled-sigmoid";

describe("endpoint-normalized unit scaled sigmoid", () => {
  test("maps zero to zero and one to one exactly, with no special input midpoint", () => {
    for (const threshold of [0, 0.05, 0.27, 0.5, 0.83, 1]) {
      for (const scale of [0.001, 0.05, 0.5, 1]) {
        for (const strength of [0.75, 1.5, 7.5]) {
          const plan = createUnitScaledSigmoid(threshold, scale, strength);
          expect(applyUnitScaledSigmoid(0, plan)).toBe(0);
          expect(applyUnitScaledSigmoid(1, plan)).toBe(1);
          let last = 0;
          for (let i = 1; i < 100; i++) {
            const value = applyUnitScaledSigmoid(i / 100, plan);
            expect(value).toBeGreaterThanOrEqual(last);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
            last = value;
          }
        }
      }
    }
  });

  test("normalizes the logistic endpoints without forcing the threshold to 0.5", () => {
    const threshold = 0.1;
    const plan = createUnitScaledSigmoid(threshold, 1, 0.75);
    const f = (value: number) => 1 / (1 + Math.exp(-0.75 * (value - threshold)));
    const expected = (f(threshold) - f(0)) / (f(1) - f(0));
    expect(applyUnitScaledSigmoid(threshold, plan)).toBeCloseTo(expected, 12);
    expect(Math.abs(expected - 0.5)).toBeGreaterThan(0.1);
  });

  test("rejects invalid parameters and values", () => {
    expect(() => createUnitScaledSigmoid(1.5, 1, 1)).toThrow();
    expect(() => createUnitScaledSigmoid(0.5, 0, 1)).toThrow();
    expect(() => createUnitScaledSigmoid(0.5, 1, 0)).toThrow();
    const plan = createUnitScaledSigmoid(0.3, 1, 1);
    for (const value of [NaN, Infinity, -0.01, 1.01]) {
      expect(() => applyUnitScaledSigmoid(value, plan)).toThrow("[0,1]");
    }
  });
});
