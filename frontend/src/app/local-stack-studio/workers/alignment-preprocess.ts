export type AlignmentExposureMatchSource = "metadata" | "image-statistics" | "none";

export type AlignmentExposurePair = {
  referenceBytes: Uint8Array;
  targetBytes: Uint8Array;
  referenceExposureGain: number;
  targetExposureGain: number;
  exposureMatchSource: AlignmentExposureMatchSource;
};

const ALIGNMENT_EXPOSURE_MAX_GAIN = 16;
const ALIGNMENT_EXPOSURE_SAMPLE_LIMIT = 65536;
const ALIGNMENT_EXPOSURE_ROLLOFF_A = 0.5;
const ALIGNMENT_EXPOSURE_ROLLOFF_OUTPUT_MAX = 1;
const ALIGNMENT_EXPOSURE_ROLLOFF_SAVING_LIMIT_FACTOR = 4;
const SRGB_TO_LINEAR_LUT = buildSrgbToLinearLut();

export function positiveExposureOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function prepareAlignmentExposurePair(
  referenceBytes: Uint8Array,
  targetBytes: Uint8Array,
  referenceExposure: unknown,
  targetExposure: unknown,
): AlignmentExposurePair {
  const exposure = resolvePairExposure(
    referenceBytes,
    targetBytes,
    referenceExposure,
    targetExposure,
  );
  return {
    referenceBytes: applyAlignmentExposureToGrayBytes(referenceBytes, exposure.referenceGain),
    targetBytes: applyAlignmentExposureToGrayBytes(targetBytes, exposure.targetGain),
    referenceExposureGain: exposure.referenceGain,
    targetExposureGain: exposure.targetGain,
    exposureMatchSource: exposure.source,
  };
}

type PairExposure = {
  referenceGain: number;
  targetGain: number;
  source: AlignmentExposureMatchSource;
};

function resolvePairExposure(
  referenceBytes: Uint8Array,
  targetBytes: Uint8Array,
  referenceExposure: unknown,
  targetExposure: unknown,
): PairExposure {
  const referenceMetadataExposure = positiveExposureOrNull(referenceExposure);
  const targetMetadataExposure = positiveExposureOrNull(targetExposure);
  let referenceLevel: number;
  let targetLevel: number;
  let source: AlignmentExposureMatchSource;

  if (referenceMetadataExposure && targetMetadataExposure) {
    referenceLevel = referenceMetadataExposure;
    targetLevel = targetMetadataExposure;
    source = "metadata";
  } else {
    referenceLevel = estimateRobustExposureLevel(referenceBytes);
    targetLevel = estimateRobustExposureLevel(targetBytes);
    source = "image-statistics";
  }

  if (!(referenceLevel > 0 && targetLevel > 0)) {
    return { referenceGain: 1, targetGain: 1, source: "none" };
  }

  const midpoint = Math.sqrt(referenceLevel * targetLevel);
  return {
    referenceGain: clampExposureGain(midpoint / referenceLevel),
    targetGain: clampExposureGain(midpoint / targetLevel),
    source,
  };
}

function clampExposureGain(gain: number): number {
  if (!(Number.isFinite(gain) && gain > 0)) return 1;
  return Math.max(1 / ALIGNMENT_EXPOSURE_MAX_GAIN, Math.min(ALIGNMENT_EXPOSURE_MAX_GAIN, gain));
}

function estimateRobustExposureLevel(bytes: Uint8Array): number {
  const histogram = buildSampledByteHistogram(bytes);
  let total = 0;
  for (let value = 1; value < 255; value += 1) total += histogram[value];
  if (total <= 0) return 0;

  const targetRank = Math.max(1, Math.ceil(total * 0.60));
  let cumulative = 0;
  for (let value = 1; value < 255; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= targetRank) {
      return Math.max(SRGB_TO_LINEAR_LUT[value], 1e-6);
    }
  }
  return Math.max(SRGB_TO_LINEAR_LUT[254], 1e-6);
}

function buildSampledByteHistogram(bytes: Uint8Array): Uint32Array {
  const histogram = new Uint32Array(256);
  const stride = Math.max(1, Math.ceil(bytes.length / ALIGNMENT_EXPOSURE_SAMPLE_LIMIT));
  const offset = Math.floor(stride / 2);
  for (let i = offset; i < bytes.length; i += stride) histogram[bytes[i]] += 1;
  return histogram;
}

function estimateScaledLinearPercentile(bytes: Uint8Array, gain: number, q: number): number {
  const histogram = buildSampledByteHistogram(bytes);
  let total = 0;
  for (let value = 0; value < 256; value += 1) total += histogram[value];
  if (total <= 0) return 0;
  const rank = Math.max(1, Math.ceil(total * Math.max(0, Math.min(1, q))));
  let cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= rank) return SRGB_TO_LINEAR_LUT[value] * gain;
  }
  return gain;
}

export function applyAlignmentExposureToGrayBytes(bytes: Uint8Array, gain: number): Uint8Array {
  const adjustedGain = clampExposureGain(gain);
  const maxVal = adjustedGain > 1
    ? estimateScaledLinearPercentile(bytes, adjustedGain, 0.998)
    : 0;
  const rolloff = alignmentExposureRolloffParams(maxVal);
  const lut = new Uint8Array(256);

  for (let value = 0; value < 256; value += 1) {
    let linear = SRGB_TO_LINEAR_LUT[value] * adjustedGain;
    if (rolloff) linear = applyAlignmentExposureRolloffScalar(linear, rolloff);
    lut[value] = linearToSrgbByte(linear);
  }

  const output = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) output[i] = lut[bytes[i]];
  return output;
}

type AlignmentExposureRolloff = {
  inflection: number;
  outputMax: number;
};

function alignmentExposureRolloffParams(maxVal: number): AlignmentExposureRolloff | null {
  if (!(Number.isFinite(maxVal) && maxVal > 1)) return null;
  const outputMax = ALIGNMENT_EXPOSURE_ROLLOFF_OUTPUT_MAX;
  const savingLimitValue = outputMax * ALIGNMENT_EXPOSURE_ROLLOFF_SAVING_LIMIT_FACTOR;
  let a = ALIGNMENT_EXPOSURE_ROLLOFF_A;
  if (maxVal > savingLimitValue) {
    a = Math.pow(a / outputMax, savingLimitValue / maxVal) * outputMax;
  }
  const inflection = a + (outputMax - a) * outputMax / maxVal;
  if (!(outputMax > inflection)) return null;
  return { inflection, outputMax };
}

function applyAlignmentExposureRolloffScalar(
  value: number,
  rolloff: AlignmentExposureRolloff,
): number {
  if (!Number.isFinite(value) || value <= rolloff.inflection) return value;
  const shoulder = rolloff.outputMax - rolloff.inflection;
  if (!(shoulder > 0)) return value;
  return rolloff.inflection
    + shoulder * (1 - Math.exp(-(value - rolloff.inflection) / shoulder));
}

function buildSrgbToLinearLut(): Float32Array {
  const lut = new Float32Array(256);
  for (let value = 0; value < 256; value += 1) {
    const encoded = value / 255;
    lut[value] = encoded <= 0.04045
      ? encoded / 12.92
      : Math.pow((encoded + 0.055) / 1.055, 2.4);
  }
  return lut;
}

function linearToSrgbByte(linear: number): number {
  if (!(Number.isFinite(linear) && linear > 0)) return 0;
  if (linear >= 1) return 255;
  const encoded = linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}
