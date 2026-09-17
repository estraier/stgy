import type { LensfunCorrection } from "@/image/lensfun";
export type { ImageEditOutputColorProfile, ImageInputColorProfile } from "@/image/types";

// Shared data contracts for the image editor processing pipeline.


export type RawDevelopmentLuminanceSettings = {
  exposureEv: number;
  logarithm: number;
  sigmoid: number;
  toneSlopeAtWhite: number;
};

export type RawDevelopmentHeadroomStatistics = {
  step: number;
  histogramMax: number;
  bins: number[];
  overflowCount: number;
  pixelCount: number;
  maxRgb: number;
};

export type RawDevelopmentSaturationSettings = {
  saturation: number;
  vibrance: number;
};

export type RawDevelopmentLensfunSettings = {
  name: string;
  focal: number | null;
  aperture: number | null;
  cropFactor: number | null;
  distortionPercent: number | null;
  tcaRedPercent: number | null;
  tcaBluePercent: number | null;
  vignettingPercent: number | null;
  vignettingEv: number | null;
};

export type RawDenoiseSettings = {
  fbdd: "light" | "full";
  medPasses: number;
  smoothMean: number;
  smoothStddev: number;
  shadowMean: number;
  shadowStddev: number;
  weightMean: number;
  weightStddev: number;
  weightP50: number;
  weightP90: number;
  weightP99: number;
  elapsedSeconds: number;
};

export type RawDevelopmentTimingEntry = {
  name: string;
  elapsedMs: number;
};

export type RawDevelopmentTiming = {
  startedAtMs: number;
  runtimeMode: "single" | "threaded";
  openMpThreads: number;
  preview: RawDevelopmentTimingEntry[];
  master: RawDevelopmentTimingEntry[];
  denoise: RawDevelopmentTimingEntry[];
};

export type RawDevelopmentSettings = {
  mode: "thumbnail-match" | "fallback";
  iso: number | null;
  medPasses: number;
  luminance: RawDevelopmentLuminanceSettings | null;
  saturation: RawDevelopmentSaturationSettings;
  headroom?: RawDevelopmentHeadroomStatistics;
  lensfun?: RawDevelopmentLensfunSettings;
  runtimeMode?: "single" | "threaded";
  openMpThreads?: number;
  timing?: RawDevelopmentTiming;
  previewElapsedSeconds?: number;
  elapsedSeconds: number;
  denoise?: RawDenoiseSettings;
};

export type DecodedRgbImage16 = {
  colorSpace: "prophoto";
  transfer: "linear" | "gamma20";
  linearRangeMax: number;
  width: number;
  height: number;
  data: Uint16Array;
  lensCorrection?: LensfunCorrection;
  rawDevelopment?: RawDevelopmentSettings;
  rawMasterPromise?: Promise<DecodedRgbImage16>;
  rawDenoisePromise?: Promise<RawDenoiseDevelopmentResult>;
  cleanup: () => void;
};

export type RawDenoiseWeightMap = {
  width: number;
  height: number;
  data: Float32Array;
};

export type RawDenoiseDevelopmentResult = {
  decoded: DecodedRgbImage16;
  weightMap: RawDenoiseWeightMap;
};

export type DecodedImage = DecodedRgbImage16;


export type LinearRgbSample = {
  data: Float32Array;
  width: number;
  height: number;
  valid?: Uint8Array;
};

export type EditPoint = { x: number; y: number };

export type HistogramData = {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
  maxCount: number;
};

export type ToneAutoSample = {
  data: Float32Array;
  width: number;
  height: number;
  valid?: Uint8Array;
};
