import {
  buildToneCurveSpline,
  normalizeToneCurvePoints,
  sampleToneCurveSpline,
  toneCurveDisplayToLinear,
  toneCurveLinearToDisplay,
  toneLinearIntensity,
  applyToneLinearToRgb,
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

describe("tone RGB intensity", () => {
  test("uses the 3:5:2 model and preserves the neutral axis", () => {
    expect(toneLinearIntensity(1, 0, 0)).toBeCloseTo(0.3, 12);
    expect(toneLinearIntensity(0, 1, 0)).toBeCloseTo(0.5, 12);
    expect(toneLinearIntensity(0, 0, 1)).toBeCloseTo(0.2, 12);
    expect(toneLinearIntensity(0.42, 0.42, 0.42)).toBeCloseTo(0.42, 12);
  });

  test("drives nonlinear Tone gain from 3:5:2 intensity while preserving RGB ratios", () => {
    const source: [number, number, number] = [0.1, 0.2, 0.9];
    const sourceTone = toneLinearIntensity(...source);
    const shadow = 100;
    const gamma = 1 / 2.5;
    const targetTone = Math.pow(sourceTone, gamma);
    const expectedGain = targetTone / sourceTone;
    const adjusted = applyToneLinearToRgb(
      ...source,
      { r: 1, g: 1, b: 1 },
      false,
      1,
      shadow,
      0,
      0,
      0,
      {
        hasExposure: false,
        hasShadow: true,
        hasHighlight: false,
        hasScaledLog: false,
        hasSigmoid: false,
      },
    );
    expect(adjusted[0]).toBeCloseTo(source[0] * expectedGain, 12);
    expect(adjusted[1]).toBeCloseTo(source[1] * expectedGain, 12);
    expect(adjusted[2]).toBeCloseTo(source[2] * expectedGain, 12);
    expect(adjusted[1] / adjusted[0]).toBeCloseTo(source[1] / source[0], 12);
    expect(adjusted[2] / adjusted[0]).toBeCloseTo(source[2] / source[0], 12);
  });
});
