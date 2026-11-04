import { buildStfGraphCutMask, applyStfGraphCutBoost } from "./stf-graph-cut";

describe("STF area-guard Graph Cut production", () => {
  test("binary mask is computed separately from guard strength", () => {
    const w = 20, h = 12;
    const gate = Float32Array.from(Array.from({ length: w * h }, (_, i) => i % w < 8 ? 0.9 : 0.1));
    const { mask, info } = buildStfGraphCutMask(gate, w, h, 0.6);
    expect(mask).toHaveLength(w * h);
    expect(info.targetWhiteFraction).toBeCloseTo(0.4);
    expect(info.cuts).toBeLessThanOrEqual(12);
    expect(info.achievedWhiteFraction).toBeGreaterThan(0);
    const w0 = applyStfGraphCutBoost(gate, w, h, mask, info.workingWidth, info.workingHeight, 0.95);
    const w1 = applyStfGraphCutBoost(gate, w, h, mask, info.workingWidth, info.workingHeight, 0.85);
    const w2 = applyStfGraphCutBoost(gate, w, h, mask, info.workingWidth, info.workingHeight, 0.75);
    for (let i = 0; i < gate.length; i++) {
      expect(w0[i]).toBeGreaterThanOrEqual(gate[i] - 1e-7);
      expect(w1[i]).toBeGreaterThanOrEqual(w0[i] - 1e-7);
      expect(w2[i]).toBeGreaterThanOrEqual(w1[i] - 1e-7);
      if (mask[i] === 0) expect(w2[i]).toBeCloseTo(gate[i], 6);
    }
  });
  test("large source is downsampled to no more than 32768 work pixels", () => {
    const w = 300, h = 150;
    const gate = Float32Array.from({ length: w * h }, (_, i) => ((i * 17) % 127) / 126);
    const { mask, info } = buildStfGraphCutMask(gate, w, h, 0.5);
    expect(mask.length).toBeLessThanOrEqual(32_768);
    expect(info.workingWidth * info.workingHeight).toBeLessThanOrEqual(32_768);
  });
  test("invalid confidence values are rejected", () => {
    expect(() => buildStfGraphCutMask(Float32Array.from([0.5, NaN]), 2, 1, 0.5)).toThrow();
  });
});
