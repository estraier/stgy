import { applySigmoidLinear, clamp01, toneLinearIntensity } from "@/image/tone";

const MULTI_SHOT_HDR2_SIGMOID_GAIN = 4;

/**
 * Prepare an owned, newly-read aligned Float32 RGB image for HDR1 in place.
 * AlignedImageReader.readLinearImage() returns a fresh buffer, so callers can
 * transfer this array directly to the HDR Worker without preserving a copy.
 * Do not use this on a shared Canonical Source buffer or a borrowed view.
 */
export function linearProPhotoFloatsToHdr1AndBrightness(floats: Float32Array): {
  floats: Float32Array;
  brightness: number;
} {
  let brightnessSum = 0;
  const pixels = floats.length / 3;
  for (let i = 0; i < floats.length; i += 3) {
    const r = clamp01(floats[i]);
    const g = clamp01(floats[i + 1]);
    const b = clamp01(floats[i + 2]);
    floats[i] = r;
    floats[i + 1] = g;
    floats[i + 2] = b;
    brightnessSum += toneLinearIntensity(r, g, b);
  }
  return { floats, brightness: pixels > 0 ? brightnessSum / pixels : 0 };
}

/** Prepare an owned, newly-read aligned Float32 RGB image for HDR2 in place. */
export function linearProPhotoFloatsToHdr2AndBrightness(floats: Float32Array): {
  floats: Float32Array;
  brightness: number;
} {
  if (!(floats instanceof Float32Array)) {
    throw new Error("Expected a linear ProPhoto RGB Float32Array.");
  }
  let brightnessSum = 0;
  const pixelCount = floats.length / 3;
  for (let i = 0; i < floats.length; i += 3) {
    let r = floats[i];
    let g = floats[i + 1];
    let b = floats[i + 2];
    const sourceLuminance = toneLinearIntensity(r, g, b);
    if (sourceLuminance > 1e-12) {
      const targetLuminance = applySigmoidLinear(sourceLuminance, MULTI_SHOT_HDR2_SIGMOID_GAIN);
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
