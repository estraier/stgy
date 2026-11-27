import { blendStfRestoreStripe, chooseStfRestoreIndex, featherStfRestoreGate, resolveStfRestoreFeatherRadius, shapeStfRestoreGateValue } from "./stf-restore-blend";

describe("STF Restore", () => {
  test("chooses the middle logarithmic F value regardless of file order", () => {
    expect(chooseStfRestoreIndex([8, 2, 4])).toBe(2);
    expect(chooseStfRestoreIndex([2, 2.8, 4, 5.6, 8])).toBe(2);
    expect(chooseStfRestoreIndex([4])).toBe(0);
    expect(() => chooseStfRestoreIndex([2, Number.NaN, 8])).toThrow();
  });

  test("Gate 1 completely replaces all RGB channels", () => {
    const source = new Float32Array([0, 0.5, 1, 0.4, 0.5, 0.6]);
    const reference = new Float32Array([2, 3, 4, 1, 2, 3]);
    blendStfRestoreStripe(source, reference, new Float32Array([1, 1]), 2, 0);
    expect(Array.from(source)).toEqual(Array.from(reference));
  });

  test("Gate values directly control replacement without dividing by 0.8", () => {
    const input = new Float32Array(5 * 3).fill(0);
    const reference = new Float32Array(5 * 3).fill(4);
    const gate = new Float32Array([0, 0.2, 0.4, 0.6, 0.8]);
    blendStfRestoreStripe(input, reference, gate, 5, 0);
    for (let i = 0; i < 5; i++) {
      for (let c = 0; c < 3; c++) expect(input[i * 3 + c]).toBeCloseTo(i * 0.8, 5);
    }
    expect(gate[0]).toBe(0);
    expect(gate[4]).toBeCloseTo(0.8, 5);
  });

  test("stripe offset reads its own gate rows and does not change them", () => {
    const gate = new Float32Array([1, 1, 0, 0, 0.8, 0.4]);
    const source = new Float32Array(6).fill(1);
    const reference = new Float32Array(6).fill(3);
    blendStfRestoreStripe(source, reference, gate, 2, 2);
    for (const value of source.subarray(0, 3)) expect(value).toBeCloseTo(2.6, 6);
    for (const value of source.subarray(3)) expect(value).toBeCloseTo(1.8, 6);
    expect(Array.from(gate)).toEqual(Array.from(new Float32Array([1,1,0,0,0.8,0.4])));
  });

  test("overlapping blur halos and standalone stripes match whole-image replacement", () => {
    const width = 3, height = 6;
    const gate = new Float32Array(width * height);
    const original = new Float32Array(width * height * 3);
    const reference = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      gate[i] = [0, 0.2, 0.4, 0.6, 0.8, 1][i % 6];
      for (let c = 0; c < 3; c++) {
        original[3 * i + c] = i + c;
        reference[3 * i + c] = 10 + i - c;
      }
    }
    const full = original.slice();
    blendStfRestoreStripe(full, reference, gate, width, 0);
    for (const [y, rows] of [[0, 4], [2, 4], [4, 2]] as const) {
      const start = y * width * 3, end = start + rows * width * 3;
      const region = original.slice(start, end);
      blendStfRestoreStripe(region, reference.slice(start, end), gate, width, y);
      for (let i = 0; i < region.length; i++) expect(region[i]).toBeCloseTo(full[start + i], 5);
    }
  });

  test("feather radius uses image diagonal rather than the shorter side", () => {
    expect(resolveStfRestoreFeatherRadius(3000, 4000)).toBe(15);
    expect(resolveStfRestoreFeatherRadius(4000, 3000)).toBe(15);
    expect(resolveStfRestoreFeatherRadius(4000, 4000)).toBe(17);
    expect(resolveStfRestoreFeatherRadius(1, 1)).toBe(1);
    expect(() => resolveStfRestoreFeatherRadius(0, 4000)).toThrow();
  });

  test("centered feather smooths both sides of a boundary without shifting it", () => {
    const width = 11, height = 5;
    const gate = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 5; x < width; x++) gate[y * width + x] = 1;
    }
    const feathered = featherStfRestoreGate(gate, width, height, 2);
    expect(feathered[2 * width + 2]).toBe(0);
    expect(feathered[2 * width + 8]).toBe(1);
    expect(feathered[2 * width + 4]).toBeGreaterThan(0);
    expect(feathered[2 * width + 4]).toBeLessThan(0.5);
    expect(feathered[2 * width + 5]).toBeGreaterThan(0.5);
    expect(feathered[2 * width + 5]).toBeLessThan(1);
    expect(feathered[2 * width + 4] + feathered[2 * width + 5]).toBeCloseTo(1, 5);
    expect(gate[2 * width + 4]).toBe(0);
    expect(gate[2 * width + 5]).toBe(1);
  });

  test("feathering preserves constant masks and does not introduce stripe seams", () => {
    const width = 9, height = 7;
    const gate = Float32Array.from({length: width * height}, (_, i) => i % width < 4 ? 0.2 : 0.9);
    const feathered = featherStfRestoreGate(gate, width, height, 2);
    for (let y = 1; y < height; y++) {
      for (let x = 0; x < width; x++) {
        expect(feathered[y * width + x]).toBeCloseTo(feathered[x], 6);
      }
    }
    const constant = featherStfRestoreGate(new Float32Array(45).fill(0.6), 9, 5, 3);
    for (const value of constant) expect(value).toBeCloseTo(shapeStfRestoreGateValue(0.6), 6);
  });


  test("secondary sigmoid centers 0.7 while strongly rejecting weak restore coverage", () => {
    expect(shapeStfRestoreGateValue(0)).toBe(0);
    expect(shapeStfRestoreGateValue(1)).toBe(1);
    expect(shapeStfRestoreGateValue(0.7)).toBeCloseTo(0.5, 8);
    expect(shapeStfRestoreGateValue(0.6)).toBeCloseTo(0.119202, 5);
    expect(shapeStfRestoreGateValue(0.8)).toBeCloseTo(0.882690, 5);
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const shaped = shapeStfRestoreGateValue(i / 100);
      expect(shaped).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = shaped;
    }
    expect(() => shapeStfRestoreGateValue(NaN)).toThrow();
  });

  test("Restore gate is sigmoid-shaped before Gaussian, with unchanged source gate", () => {
    const width = 21, height = 3;
    const gate = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) gate[y * width + x] = x < 10 ? 0.6 : 0.8;
    }
    const original = gate.slice();
    const shaped = featherStfRestoreGate(gate, width, height, 0);
    expect(shaped[2]).toBeCloseTo(shapeStfRestoreGateValue(0.6), 6);
    expect(shaped[19]).toBeCloseTo(shapeStfRestoreGateValue(0.8), 6);
    const feathered = featherStfRestoreGate(gate, width, height, 2);
    expect(feathered[0]).toBeCloseTo(shaped[0], 6);
    expect(feathered[width - 1]).toBeCloseTo(shaped[width - 1], 6);
    expect(feathered[9]).toBeGreaterThan(shaped[9]);
    expect(feathered[10]).toBeLessThan(shaped[10]);
    expect(gate).toEqual(original);
  });

  test("rejects inconsistent gate and stripe geometry", () => {
    expect(() => blendStfRestoreStripe(new Float32Array(6), new Float32Array(3), new Float32Array(2), 2, 0)).toThrow();
  });
});
