import { applySigmoidLinear, clamp01, toneLinearIntensity } from "@/image/tone";
import {
  linearProPhotoFloatsToHdr1AndBrightness,
  linearProPhotoFloatsToHdr2AndBrightness,
} from "./hdr-input";

// Keep the pre-optimization copy-based algorithms here as an independent
// reference: the HDR Worker must receive identical Float32 samples and brightness.
function historicalHdr1(linear: Float32Array): { floats: Float32Array; brightness: number } {
  const floats = new Float32Array(linear.length);
  let brightnessSum = 0;
  const pixels = linear.length / 3;
  for (let i = 0; i < linear.length; i += 3) {
    const r = clamp01(linear[i]), g = clamp01(linear[i + 1]), b = clamp01(linear[i + 2]);
    floats[i] = r; floats[i + 1] = g; floats[i + 2] = b;
    brightnessSum += toneLinearIntensity(r, g, b);
  }
  return { floats, brightness: pixels > 0 ? brightnessSum / pixels : 0 };
}

function historicalHdr2(linear: Float32Array): { floats: Float32Array; brightness: number } {
  const floats = new Float32Array(linear.length);
  let brightnessSum = 0;
  const pixelCount = linear.length / 3;
  for (let i = 0; i < linear.length; i += 3) {
    let r = linear[i];
    let g = linear[i + 1];
    let b = linear[i + 2];
    const sourceLuminance = toneLinearIntensity(r, g, b);
    if (sourceLuminance > 1e-12) {
      const targetLuminance = applySigmoidLinear(sourceLuminance, 4);
      const scale = targetLuminance / sourceLuminance;
      r *= scale;
      g *= scale;
      b *= scale;
    }
    r = Math.max(0, r);
    g = Math.max(0, g);
    b = Math.max(0, b);
    const maxChannel = Math.max(r, g, b);
    if (maxChannel > 1) {
      const fitScale = 1 / maxChannel;
      r *= fitScale;
      g *= fitScale;
      b *= fitScale;
    }
    brightnessSum += toneLinearIntensity(r, g, b);
    floats[i] = r;
    floats[i + 1] = g;
    floats[i + 2] = b;
  }
  return { floats, brightness: pixelCount > 0 ? brightnessSum / pixelCount : 0 };
}

function samples(pixelCount: number, seed: number): Float32Array {
  const output = new Float32Array(pixelCount * 3);
  let state = seed >>> 0;
  for (let i = 0; i < output.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // Includes underexposure, negative samples and values beyond scene white.
    output[i] = ((state / 0xffffffff) * 6 - 1.5);
  }
  return output;
}

const edgeValues = new Float32Array([
  0, 0, 0,
  1, 1, 1,
  -1, 0.0000000001, 4,
  0.12, 0.24, 0.72,
  Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
]);

for (const [name, prepare, reference] of [
  ["HDR1", linearProPhotoFloatsToHdr1AndBrightness, historicalHdr1],
  ["HDR2", linearProPhotoFloatsToHdr2AndBrightness, historicalHdr2],
] as const) {
  test(`${name}: transforms an owned Float32Array in place without allocating another full image`, () => {
    const input = samples(97, 42);
    const ownedBuffer = input.buffer;
    const expected = reference(new Float32Array(input));
    const actual = prepare(input);
    expect(actual.floats).toBe(input);
    expect(actual.floats.buffer).toBe(ownedBuffer);
    expect(actual.floats).toEqual(expected.floats);
    expect(actual.brightness).toBe(expected.brightness);
  });

  test(`${name}: remains exactly equivalent to the old algorithm over all input ranges`, () => {
    for (const source of [new Float32Array(0), edgeValues, ...[1, 2, 3, 17, 1024, 8192].map(
      (count, i) => samples(count, 0x1234 + i * 53),
    )]) {
      const actual = prepare(new Float32Array(source));
      const expected = reference(source);
      expect(actual.floats).toEqual(expected.floats);
      expect(actual.brightness).toBe(expected.brightness);
    }
  });
}

test("HDR2 preserves its existing Float32Array type contract", () => {
  expect(() => linearProPhotoFloatsToHdr2AndBrightness([] as unknown as Float32Array))
    .toThrow("Expected a linear ProPhoto RGB Float32Array.");
});
