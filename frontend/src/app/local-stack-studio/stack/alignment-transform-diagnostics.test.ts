import { affineDisplacement } from "./alignment-transform-diagnostics";

const identity = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

describe("alignment transform diagnostics", () => {
  test("reports zero displacement when ORB leaves ECC unchanged", () => {
    const d = affineDisplacement(identity, new Float64Array(identity), 4000, 3000);
    for (const value of Object.values(d)) expect(value).toBe(0);
  });

  test("reports a uniform translation in full-resolution pixels", () => {
    const next = new Float64Array([1, 0, 3, 0, 1, -4, 0, 0, 1]);
    const d = affineDisplacement(identity, next, 4000, 3000);
    expect(d.centerPx).toBeCloseTo(5, 12);
    expect(d.maxCornerPx).toBeCloseTo(5, 12);
    expect(d.topLeftPx).toBeCloseTo(5, 12);
  });

  test("captures corner drift caused by rotation or scale around origin", () => {
    const next = new Float64Array([1.001, 0, 0, 0, 1, 0, 0, 0, 1]);
    const d = affineDisplacement(identity, next, 4000, 3000);
    expect(d.topLeftPx).toBe(0);
    expect(d.topRightPx).toBeCloseTo(4, 10);
    expect(d.bottomRightPx).toBeCloseTo(4, 10);
    expect(d.centerPx).toBeCloseTo(2, 10);
    expect(d.maxCornerPx).toBeCloseTo(4, 10);
  });

  test("rejects invalid dimensions and transform numbers", () => {
    expect(() => affineDisplacement(identity, identity, 0, 100)).toThrow("Invalid affine");
    const invalid = new Float64Array(identity);
    invalid[2] = Number.NaN;
    expect(() => affineDisplacement(identity, invalid, 100, 100)).toThrow("Non-finite");
  });
});
