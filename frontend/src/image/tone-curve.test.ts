import {
  buildToneCurveSpline,
  normalizeToneCurvePoints,
  sampleToneCurveSpline,
  toneCurveDisplayToLinear,
  toneCurveLinearToDisplay,
} from "./tone";

describe("tone curve", () => {
  test("uses gamma 2.4 for graph display coordinates", () => {
    const display = toneCurveLinearToDisplay(0.25);
    expect(display).toBeCloseTo(Math.pow(0.25, 1 / 2.4), 8);
    expect(toneCurveDisplayToLinear(display)).toBeCloseTo(0.25, 8);
    expect(toneCurveLinearToDisplay(0)).toBe(0);
    expect(toneCurveLinearToDisplay(1)).toBe(1);
  });

  test("uses identity with no control points and above display white", () => {
    expect(buildToneCurveSpline([])).toBeNull();
    expect(sampleToneCurveSpline(null, 0.4)).toBeCloseTo(0.4, 8);
    expect(sampleToneCurveSpline(null, 1.5)).toBeCloseTo(1.5, 8);
  });

  test("passes exactly through fixed endpoints and user control points", () => {
    const points = normalizeToneCurvePoints([
      { x: 0.0008, y: 0.05 },
      { x: 0.05, y: 0.12 },
      { x: 0.5, y: 0.7 },
    ]);
    const spline = buildToneCurveSpline(points);
    expect(spline).not.toBeNull();
    expect(sampleToneCurveSpline(spline, 0)).toBeCloseTo(0, 12);
    for (const point of points) {
      expect(sampleToneCurveSpline(spline, point.x)).toBeCloseTo(point.y, 12);
    }
    expect(sampleToneCurveSpline(spline, 1)).toBeCloseTo(1, 12);
    expect(sampleToneCurveSpline(spline, 1.2)).toBeCloseTo(1.2, 12);
  });

  test("does not overshoot low-Y intervals or stick to zero", () => {
    const spline = buildToneCurveSpline([
      { x: 0.01, y: 0.05 },
      { x: 0.08, y: 0.06 },
      { x: 0.3, y: 0.35 },
    ]);
    expect(spline).not.toBeNull();
    for (let i = 1; i < 80; i += 1) {
      const x = 0.01 + (0.08 - 0.01) * i / 80;
      const y = sampleToneCurveSpline(spline, x);
      expect(y).toBeGreaterThanOrEqual(0.05 - 1e-12);
      expect(y).toBeLessThanOrEqual(0.06 + 1e-12);
      expect(y).toBeGreaterThan(0);
    }
  });

  test("preserves descending intervals without overshoot", () => {
    const spline = buildToneCurveSpline([
      { x: 0.2, y: 0.7 },
      { x: 0.5, y: 0.3 },
      { x: 0.8, y: 0.9 },
    ]);
    expect(spline).not.toBeNull();
    for (let i = 0; i <= 100; i += 1) {
      const x = 0.2 + 0.3 * i / 100;
      const y = sampleToneCurveSpline(spline, x);
      expect(y).toBeGreaterThanOrEqual(0.3 - 1e-12);
      expect(y).toBeLessThanOrEqual(0.7 + 1e-12);
    }
  });

  test("sorts control points by x and clamps y", () => {
    expect(normalizeToneCurvePoints([
      { x: 0.8, y: 2 },
      { x: 0.2, y: -1 },
    ])).toEqual([
      { x: 0.2, y: 0 },
      { x: 0.8, y: 1 },
    ]);
  });
});
