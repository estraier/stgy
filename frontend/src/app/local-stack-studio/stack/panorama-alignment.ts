export type PanoramaAlignmentPass = {
  id: string;
  label: string;
  useClahe: boolean;
  useDetailBoost: boolean;
  registrationMegapixels: number;
  panoConfidence: number;
  rngSeed: number;
};

export const PANORAMA_ALIGNMENT_CLAHE_CLIP_LIMIT = 1.0;
export const PANORAMA_ALIGNMENT_CLAHE_TILE_GRID = 8;

// Keep the normal pass conservative enough to reject accidental matches, then
// progressively spend more work and accept weaker-but-still-geometrically-
// verified links only when the preceding pass cannot connect every input.
export const PANORAMA_ALIGNMENT_PASSES: readonly PanoramaAlignmentPass[] = [
  {
    id: "gamma2-orb",
    label: "gamma-2 ORB",
    useClahe: false,
    useDetailBoost: false,
    registrationMegapixels: 1.5,
    panoConfidence: 0.70,
    rngSeed: 0x13579bdf,
  },
  {
    id: "clahe-orb",
    label: "CLAHE ORB",
    useClahe: true,
    useDetailBoost: false,
    registrationMegapixels: 2.0,
    panoConfidence: 0.55,
    rngSeed: 0x2468ace1,
  },
  {
    id: "clahe-detail-orb",
    label: "CLAHE + detail ORB",
    useClahe: true,
    useDetailBoost: true,
    registrationMegapixels: 3.0,
    panoConfidence: 0.40,
    rngSeed: 0x31415926,
  },
  {
    id: "clahe-detail-orb-relaxed",
    label: "CLAHE + detail ORB relaxed",
    useClahe: true,
    useDetailBoost: true,
    registrationMegapixels: 4.0,
    panoConfidence: 0.25,
    rngSeed: 0x5a17c0de,
  },
] as const;

export function boostPanoramaAlignmentDetailInPlace(
  gray: Uint8Array,
  width: number,
  height: number,
): void {
  if (!(width > 0 && height > 0) || gray.length !== width * height) {
    throw new Error("Panorama alignment detail buffer dimensions are invalid.");
  }
  if (width < 3 || height < 3) return;
  const source = gray.slice();
  const strength = 1.35;
  for (let y = 1; y + 1 < height; y += 1) {
    const row = y * width;
    for (let x = 1; x + 1 < width; x += 1) {
      const index = row + x;
      const center = source[index] ?? 0;
      const localMean = (
        center * 4
        + (source[index - 1] ?? center)
        + (source[index + 1] ?? center)
        + (source[index - width] ?? center)
        + (source[index + width] ?? center)
      ) / 8;
      const boosted = center + (center - localMean) * strength;
      gray[index] = Math.max(0, Math.min(255, Math.round(boosted)));
    }
  }
}

const STORED_UINT16_MAX = 65535;
const OUTPUT_BYTE_MAX = 255;
const LUMA_R = 0.2927;
const LUMA_G = 0.5368;
const LUMA_B = 0.1705;
const EXPOSURE_PERCENTILE = 0.95;
const EXPOSURE_TARGET_BYTE = 224;
const EXPOSURE_GAIN_MIN = 0.5;
const EXPOSURE_GAIN_MAX = 3.0;

export function appendGamma2PanoramaAlignmentGray(
  storedRgb: Uint16Array,
  destination: Uint8Array,
  destinationPixelOffset: number,
  linearRangeMax: number,
  histogram?: Uint32Array,
): number {
  if (storedRgb.length % 3 !== 0) {
    throw new Error("Panorama alignment RGB buffer length must be divisible by 3.");
  }
  const pixelCount = storedRgb.length / 3;
  if (destinationPixelOffset < 0 || destinationPixelOffset + pixelCount > destination.length) {
    throw new Error("Panorama alignment grayscale destination is out of bounds.");
  }
  const range = Number.isFinite(linearRangeMax) && linearRangeMax > 0 ? linearRangeMax : 1;
  let destinationIndex = destinationPixelOffset;
  for (let source = 0; source < storedRgb.length; source += 3, destinationIndex += 1) {
    const er = (storedRgb[source] ?? 0) / STORED_UINT16_MAX;
    const eg = (storedRgb[source + 1] ?? 0) / STORED_UINT16_MAX;
    const eb = (storedRgb[source + 2] ?? 0) / STORED_UINT16_MAX;
    // Canonical storage is gamma-2.0: encoded = sqrt(linear / range).
    // Reconstruct luminance directly from the encoded channels, then return it
    // to gamma-2.0 for an ORB/SIFT-friendly perceptual 8-bit proxy.
    const linearLuma = range * (LUMA_R * er * er + LUMA_G * eg * eg + LUMA_B * eb * eb);
    const encodedLuma = Math.sqrt(Math.min(1, Math.max(0, linearLuma)));
    const value = Math.max(0, Math.min(OUTPUT_BYTE_MAX, Math.round(encodedLuma * OUTPUT_BYTE_MAX)));
    destination[destinationIndex] = value;
    if (histogram && histogram.length >= 256) histogram[value] = (histogram[value] ?? 0) + 1;
  }
  return pixelCount;
}

export function panoramaAlignmentExposureGain(histogram: Uint32Array): number {
  if (histogram.length < 256) return 1;
  let total = 0;
  for (let index = 0; index < 256; index += 1) total += histogram[index] ?? 0;
  if (total <= 0) return 1;
  const targetCount = Math.max(1, Math.ceil(total * EXPOSURE_PERCENTILE));
  let cumulative = 0;
  let percentile = 0;
  for (let index = 0; index < 256; index += 1) {
    cumulative += histogram[index] ?? 0;
    if (cumulative >= targetCount) {
      percentile = index;
      break;
    }
  }
  if (percentile <= 0) return 1;
  return Math.min(EXPOSURE_GAIN_MAX, Math.max(EXPOSURE_GAIN_MIN, EXPOSURE_TARGET_BYTE / percentile));
}

export function applyPanoramaAlignmentExposureGain(gray: Uint8Array, gain: number): void {
  if (!Number.isFinite(gain) || gain <= 0 || Math.abs(gain - 1) < 1e-6) return;
  for (let index = 0; index < gray.length; index += 1) {
    gray[index] = Math.max(0, Math.min(OUTPUT_BYTE_MAX, Math.round((gray[index] ?? 0) * gain)));
  }
}
