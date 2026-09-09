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

export type RawDevelopmentSettings = {
  mode: "thumbnail-match" | "fallback";
  iso: number | null;
  medPasses: number;
  luminance: RawDevelopmentLuminanceSettings | null;
  saturation: RawDevelopmentSaturationSettings;
  headroom?: RawDevelopmentHeadroomStatistics;
  lensfun?: RawDevelopmentLensfunSettings;
  elapsedSeconds: number;
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
  cleanup: () => void;
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
