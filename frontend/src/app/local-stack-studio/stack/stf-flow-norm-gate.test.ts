import { buildStfFlowNormGate, stfFlowNormGateFactor } from "./stf-flow-norm-gate";

function fromNorms(norms: readonly number[]): Float32Array {
  const result = new Float32Array(norms.length * 2);
  norms.forEach((norm, i) => { result[i * 2] = norm; });
  return result;
}

describe("STF extrapolation P5-P10 Flow norm gate", () => {
  test("computes native-resolution P5 and P10 over the entire field", () => {
    const norms = Array.from({ length: 100 }, (_, index) => index / 10);
    // Scramble spatial order; percentiles must depend only on the distribution.
    const shuffled = norms.map((_, index) => norms[(index * 37) % 100]);
    const flow = fromNorms(shuffled);
    const gate = buildStfFlowNormGate(flow);
    expect(gate).not.toBeNull();
    expect(gate!.p5).toBeCloseTo(0.4, 5);
    expect(gate!.p10).toBeCloseTo(0.9, 5);
    expect(Array.from(flow)).toEqual(Array.from(fromNorms(shuffled))); // Never modify the cached Flow.
  });

  test("suppresses low magnitudes, smoothly transitions between P5/P10 and leaves larger Flow unchanged", () => {
    const gate = buildStfFlowNormGate(fromNorms(Array.from({ length: 100 }, (_, i) => i / 10)));
    expect(gate).not.toBeNull();
    expect(stfFlowNormGateFactor(0, 0, gate!)).toBe(0);
    expect(stfFlowNormGateFactor(0.3, 0, gate!)).toBe(0);
    expect(stfFlowNormGateFactor(0.65, 0, gate!)).toBeCloseTo(0.5, 5);
    expect(stfFlowNormGateFactor(0.9, 0, gate!)).toBe(1);
    expect(stfFlowNormGateFactor(4, 5, gate!)).toBe(1);
    // Gate uses norm, not vector orientation; direction is retained.
    expect(stfFlowNormGateFactor(0, -0.65, gate!)).toBeCloseTo(0.5, 5);
  });

  test("skips identical or near-identical P5/P10 thresholds without creating a hard cutoff", () => {
    expect(buildStfFlowNormGate(fromNorms(new Array(100).fill(0)))).toBeNull();
    expect(buildStfFlowNormGate(fromNorms(new Array(100).fill(2)))).toBeNull();
    expect(buildStfFlowNormGate(fromNorms(Array.from({ length: 100 }, (_, i) => i < 99 ? 0 : 5)))).toBeNull();
    expect(buildStfFlowNormGate(fromNorms(Array.from({ length: 100 }, (_, i) => i / 1e9)))).toBeNull();
  });

  test("large outliers do not move the small-magnitude percentile thresholds", () => {
    const ordinary = Array.from({ length: 100 }, (_, i) => i / 10);
    const first = buildStfFlowNormGate(fromNorms(ordinary));
    const last = ordinary.slice();
    last[99] = 100000;
    const second = buildStfFlowNormGate(fromNorms(last));
    expect(second?.p5).toBe(first?.p5);
    expect(second?.p10).toBe(first?.p10);
  });

  test("rejects non-finite Flow rather than hiding corrupted vectors", () => {
    expect(() => buildStfFlowNormGate(new Float32Array([0, 0, Number.NaN, 1]))).toThrow(/non-finite/);
    expect(() => buildStfFlowNormGate(new Float32Array([0, 0, 1, Number.POSITIVE_INFINITY]))).toThrow(/non-finite/);
  });
});
