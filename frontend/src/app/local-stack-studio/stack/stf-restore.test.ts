import { planStfRestore, applyStfRestoreInPlace } from "./stf-restore";
import { rgbToHsv, hsvToRgb } from "@/image/tone";

function scene(width: number, height: number): Float32Array {
  const result = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const base = 0.15 + 0.35 * x / width + 0.25 * y / height;
      result[i] = base * (0.75 + Math.sin(x * 0.12) * 0.08);
      result[i + 1] = base;
      result[i + 2] = base * (0.85 + Math.cos(y * 0.2) * 0.07);
    }
  }
  return result;
}

describe("STF Restore LIS-style correction", () => {
  test("reports exact identity and does not modify identical samples", () => {
    const reference = scene(24, 24);
    const plan = planStfRestore(reference, reference.slice(), 24, 24);
    expect(plan.gain).toBe(1);
    expect(plan.scaledLog).toBe(0);
    expect(plan.sigmoid).toBe(0);
    expect(plan.saturation).toBe(0);
    expect(plan.vibrance).toBe(0);
    const corrected = reference.slice();
    applyStfRestoreInPlace(corrected, plan);
    expect(Array.from(corrected)).toEqual(Array.from(reference));
  });

  test("30-iteration tone planning converges to 20% original plus 80% STF", () => {
    const reference = scene(80, 60);
    // Test exposure adjustments in both directions: do not force the real frame
    // all the way to the composite, and do not change the solver relaxation.
    for (const multiplier of [0.92, 1.08]) {
      const target = reference.map((v) => v * multiplier);
      const plan = planStfRestore(reference, target, 80, 60);
      const corrected = reference.slice();
      applyStfRestoreInPlace(corrected, plan);
      let totalDifference = 0;
      let targetError = 0;
      let desiredError = 0;
      for (let i = 0; i < target.length; i++) {
        totalDifference += Math.abs(reference[i] - target[i]);
        targetError += Math.abs(corrected[i] - target[i]);
        const desired = 0.2 * reference[i] + 0.8 * target[i];
        desiredError += Math.abs(corrected[i] - desired);
      }
      expect(desiredError).toBeLessThan(totalDifference * 0.06);
      // It is intentional that 20% of the original difference remains.
      expect(targetError).toBeGreaterThan(totalDifference * 0.13);
      expect(targetError).toBeLessThan(totalDifference * 0.27);
    }
  });

  test("color matching modifies saturation without producing non-finite values", () => {
    const reference = scene(72, 44);
    const target = reference.slice();
    for (let i = 0; i < target.length; i += 3) {
      const middle = (target[i] + target[i + 1] + target[i + 2]) / 3;
      for (let c = 0; c < 3; c++) target[i + c] = middle + 1.15 * (target[i + c] - middle);
    }
    const plan = planStfRestore(reference, target, 72, 44);
    expect(plan.saturation).toBeGreaterThan(0);
    const corrected = reference.slice();
    applyStfRestoreInPlace(corrected, plan);
    for (const value of corrected) expect(Number.isFinite(value)).toBe(true);
  });

  test("can strongly reduce both saturation and vibrance when STF merge is less saturated", () => {
    const width = 100, height = 80;
    const reference = new Float32Array(width * height * 3);
    const target = new Float32Array(reference.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const hue = (Math.floor(x / 12) * 0.121 + Math.floor(y / 14) * 0.066) % 1;
        const saturation = 0.34 + 0.4 * (Math.floor(x / 14) % 5) / 4;
        const value = 0.25 + 0.5 * y / height;
        const input = hsvToRgb(hue, saturation, value);
        const merged = hsvToRgb(hue, saturation * 0.65, value);
        const offset = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) {
          reference[offset + c] = input[c];
          target[offset + c] = merged[c];
        }
      }
    }
    const plan = planStfRestore(reference, target, width, height);
    // Regression: the old -5 floor on both adjustments left a visible
    // chroma mismatch, even after 30 iterations had converged.
    expect(plan.saturation).toBeLessThan(-5);
    expect(plan.vibrance).toBeLessThan(-5);
    expect(plan.saturation).toBeGreaterThanOrEqual(-100);
    expect(plan.vibrance).toBeGreaterThanOrEqual(-100);
    const corrected = reference.slice();
    applyStfRestoreInPlace(corrected, plan);
    const sortedSaturation = (image: Float32Array) => {
      const result: number[] = [];
      for (let i = 0; i < image.length; i += 3) {
        result.push(rgbToHsv(image[i], image[i + 1], image[i + 2])[1]);
      }
      return result.sort((a, b) => a - b);
    };
    const center = (array: number[], p: number) => array[Math.floor(array.length * p)];
    const before = sortedSaturation(reference);
    const desired = sortedSaturation(target);
    const after = sortedSaturation(corrected);
    for (const p of [0.5, 0.95]) {
      const sourceStat = center(before, p);
      const mergedStat = center(desired, p);
      const blendedGoal = 0.2 * sourceStat + 0.8 * mergedStat;
      const beforeError = Math.abs(sourceStat - blendedGoal);
      const afterError = Math.abs(center(after, p) - blendedGoal);
      expect(afterError).toBeLessThan(beforeError * 0.10);
      // The corrected image should retain a deliberate fraction of the
      // original chroma difference rather than matching the STF 100%.
      expect(Math.abs(center(after, p) - mergedStat)).toBeGreaterThan(Math.abs(sourceStat - mergedStat) * 0.09);
    }
  });

  test("rejects mismatched correction samples", () => {
    expect(() => planStfRestore(new Float32Array(12), new Float32Array(9), 2, 2)).toThrow();
  });
});
