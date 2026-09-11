import type { ImageEditOutputColorProfile, ImageInputColorProfile } from "./types";
import {
  PROPHOTO_TONE_LUMA_B,
  PROPHOTO_TONE_LUMA_G,
  PROPHOTO_TONE_LUMA_R,
  clamp01,
  srgbChannelToLinear,
} from "./tone";

// Fixed transforms between the editor's linear ProPhoto RGB working space and file/display spaces.

export const PROPHOTO_TO_SRGB_M00 = 2.03407582;
export const PROPHOTO_TO_SRGB_M01 = -0.72733415;
export const PROPHOTO_TO_SRGB_M02 = -0.30674161;
export const PROPHOTO_TO_SRGB_M10 = -0.22881318;
export const PROPHOTO_TO_SRGB_M11 = 1.23173011;
export const PROPHOTO_TO_SRGB_M12 = -0.00291696;
export const PROPHOTO_TO_SRGB_M20 = -0.00856980;
export const PROPHOTO_TO_SRGB_M21 = -0.15328665;
export const PROPHOTO_TO_SRGB_M22 = 1.16185645;
export const PROPHOTO_TO_DISPLAY_P3_M00 = 1.63250441;
export const PROPHOTO_TO_DISPLAY_P3_M01 = -0.37966939;
export const PROPHOTO_TO_DISPLAY_P3_M02 = -0.25283503;
export const PROPHOTO_TO_DISPLAY_P3_M10 = -0.15368049;
export const PROPHOTO_TO_DISPLAY_P3_M11 = 1.16669036;
export const PROPHOTO_TO_DISPLAY_P3_M12 = -0.01300987;
export const PROPHOTO_TO_DISPLAY_P3_M20 = 0.01039021;
export const PROPHOTO_TO_DISPLAY_P3_M21 = -0.06280507;
export const PROPHOTO_TO_DISPLAY_P3_M22 = 1.05241486;
export const SRGB_TO_PROPHOTO_M00 = 0.52934593;
export const SRGB_TO_PROPHOTO_M01 = 0.33007280;
export const SRGB_TO_PROPHOTO_M02 = 0.14058125;
export const SRGB_TO_PROPHOTO_M10 = 0.09837429;
export const SRGB_TO_PROPHOTO_M11 = 0.87346103;
export const SRGB_TO_PROPHOTO_M12 = 0.02816470;
export const SRGB_TO_PROPHOTO_M20 = 0.01688320;
export const SRGB_TO_PROPHOTO_M21 = 0.11767252;
export const SRGB_TO_PROPHOTO_M22 = 0.86544429;
export const DISPLAY_P3_TO_PROPHOTO_M00 = 0.63170772;
export const DISPLAY_P3_TO_PROPHOTO_M01 = 0.21388506;
export const DISPLAY_P3_TO_PROPHOTO_M02 = 0.15440722;
export const DISPLAY_P3_TO_PROPHOTO_M10 = 0.08319654;
export const DISPLAY_P3_TO_PROPHOTO_M11 = 0.88586510;
export const DISPLAY_P3_TO_PROPHOTO_M12 = 0.03093836;
export const DISPLAY_P3_TO_PROPHOTO_M20 = -0.00127175;
export const DISPLAY_P3_TO_PROPHOTO_M21 = 0.05075423;
export const DISPLAY_P3_TO_PROPHOTO_M22 = 0.95051752;
export const ADOBE_RGB_TO_PROPHOTO_M00 = 0.74021392;
export const ADOBE_RGB_TO_PROPHOTO_M01 = 0.11316980;
export const ADOBE_RGB_TO_PROPHOTO_M02 = 0.14661626;
export const ADOBE_RGB_TO_PROPHOTO_M10 = 0.13756225;
export const ADOBE_RGB_TO_PROPHOTO_M11 = 0.83306398;
export const ADOBE_RGB_TO_PROPHOTO_M12 = 0.02937378;
export const ADOBE_RGB_TO_PROPHOTO_M20 = 0.02360872;
export const ADOBE_RGB_TO_PROPHOTO_M21 = 0.07379435;
export const ADOBE_RGB_TO_PROPHOTO_M22 = 0.90259694;
export const REC_2020_TO_PROPHOTO_M00 = 0.83516439;
export const REC_2020_TO_PROPHOTO_M01 = 0.04879000;
export const REC_2020_TO_PROPHOTO_M02 = 0.11598029;
export const REC_2020_TO_PROPHOTO_M10 = 0.05401942;
export const REC_2020_TO_PROPHOTO_M11 = 0.92894837;
export const REC_2020_TO_PROPHOTO_M12 = 0.01705522;
export const REC_2020_TO_PROPHOTO_M20 = -0.00233881;
export const REC_2020_TO_PROPHOTO_M21 = 0.03632883;
export const REC_2020_TO_PROPHOTO_M22 = 0.96607458;
export const REC_2020_TRANSFER_ALPHA = 1.09929682680944;
export const REC_2020_TRANSFER_BETA = 0.018053968510807;
export const PROPHOTO_LUMA_R = PROPHOTO_TONE_LUMA_R;
export const PROPHOTO_LUMA_G = PROPHOTO_TONE_LUMA_G;
export const PROPHOTO_LUMA_B = PROPHOTO_TONE_LUMA_B;


export const D65_TO_D50 = [
  1.0479298, 0.0229468, -0.0501922,
  0.0296278, 0.9904345, -0.0170738,
  -0.0092430, 0.0150552, 0.7518743,
] as const;
export const D50_TO_D65 = [
  0.9554734, -0.0230985, 0.0632593,
  -0.0283697, 1.0099956, 0.0210414,
  0.0123140, -0.0205077, 1.3303659,
] as const;
export const PROPHOTO_TO_XYZ_D50 = [
  0.7976749, 0.1351917, 0.0313534,
  0.2880402, 0.7118741, 0.0000857,
  0.0, 0.0, 0.8252100,
] as const;
export const XYZ_D50_TO_PROPHOTO = [
  1.3457989731028281, -0.25558010007997534, -0.05110628506753401,
  -0.5446224939028347, 1.5082327413132781, 0.02053603239147973,
  0.0, 0.0, 1.2119675456389454,
] as const;
export const SRGB_TO_XYZ_D65 = [
  0.4123908, 0.35758434, 0.18048079,
  0.21263901, 0.71516868, 0.07219232,
  0.01933082, 0.11919478, 0.95053215,
] as const;
export const DISPLAY_P3_TO_XYZ_D65 = [
  0.48657095, 0.26566769, 0.19821729,
  0.22897456, 0.69173852, 0.07928691,
  0.0, 0.04511338, 1.04394437,
] as const;
export const ADOBE_RGB_TO_XYZ_D65 = [
  0.5767309, 0.1855540, 0.1881852,
  0.2973769, 0.6273491, 0.0752741,
  0.0270343, 0.0706872, 0.9911085,
] as const;
export const XYZ_D65_TO_SRGB = [
  3.24096994, -1.53738318, -0.49861076,
  -0.96924364, 1.8759675, 0.04155506,
  0.05563008, -0.20397696, 1.05697151,
] as const;
export const XYZ_D65_TO_DISPLAY_P3 = [
  2.493496911941425, -0.9313836179191239, -0.40271078445071684,
  -0.8294889695615747, 1.7626640603183463, 0.023624685841943577,
  0.03584583024378447, -0.07617238926804182, 0.9568845240076872,
] as const;
export const PROPHOTO_LINEAR_TO_SRGB_LINEAR = [
  PROPHOTO_TO_SRGB_M00, PROPHOTO_TO_SRGB_M01, PROPHOTO_TO_SRGB_M02,
  PROPHOTO_TO_SRGB_M10, PROPHOTO_TO_SRGB_M11, PROPHOTO_TO_SRGB_M12,
  PROPHOTO_TO_SRGB_M20, PROPHOTO_TO_SRGB_M21, PROPHOTO_TO_SRGB_M22,
] as const;

export function prophotoEncodedToLinear(encoded: number): number {
  const x = clamp01(encoded);
  return x <= 16 / 512 ? x / 16 : Math.pow(x, 1.8);
}

export function adobeRgbEncodedToLinear(encoded: number): number {
  return Math.pow(clamp01(encoded), 2.19921875);
}

export function rec2020EncodedToLinear(encoded: number): number {
  const x = clamp01(encoded);
  const threshold = 4.5 * REC_2020_TRANSFER_BETA;
  if (x < threshold) return x / 4.5;
  return Math.pow(
    (x + (REC_2020_TRANSFER_ALPHA - 1)) / REC_2020_TRANSFER_ALPHA,
    1 / 0.45,
  );
}

export type RgbTripletBuffer = [number, number, number] | Float32Array | number[];

export function normalizeImageInputColorProfile(profile: string): ImageInputColorProfile {
  switch (profile) {
    case "display-p3":
      return "display-p3";
    case "prophoto":
    case "prophoto-rgb":
      return "prophoto";
    case "adobe-rgb":
      return "adobe-rgb";
    case "rec2020":
      return "rec2020";
    case "srgb":
    default:
      return "srgb";
  }
}

export type Rgb8ToLinearProphotoConverter = (
  r: number,
  g: number,
  b: number,
  output: RgbTripletBuffer,
) => RgbTripletBuffer;

export function createRgb8ToLinearProphotoConverter(
  profile: ImageInputColorProfile | string,
): Rgb8ToLinearProphotoConverter {
  const normalizedProfile = normalizeImageInputColorProfile(profile);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const encoded = i / 255;
    lut[i] = normalizedProfile === "prophoto"
      ? prophotoEncodedToLinear(encoded)
      : normalizedProfile === "adobe-rgb"
        ? adobeRgbEncodedToLinear(encoded)
        : normalizedProfile === "rec2020"
          ? rec2020EncodedToLinear(encoded)
          : srgbChannelToLinear(i);
  }

  if (normalizedProfile === "prophoto") {
    return (r, g, b, output) => {
      output[0] = lut[r] ?? 0;
      output[1] = lut[g] ?? 0;
      output[2] = lut[b] ?? 0;
      return output;
    };
  }

  const matrix = normalizedProfile === "display-p3"
    ? [
        DISPLAY_P3_TO_PROPHOTO_M00, DISPLAY_P3_TO_PROPHOTO_M01, DISPLAY_P3_TO_PROPHOTO_M02,
        DISPLAY_P3_TO_PROPHOTO_M10, DISPLAY_P3_TO_PROPHOTO_M11, DISPLAY_P3_TO_PROPHOTO_M12,
        DISPLAY_P3_TO_PROPHOTO_M20, DISPLAY_P3_TO_PROPHOTO_M21, DISPLAY_P3_TO_PROPHOTO_M22,
      ]
    : normalizedProfile === "adobe-rgb"
      ? [
          ADOBE_RGB_TO_PROPHOTO_M00, ADOBE_RGB_TO_PROPHOTO_M01, ADOBE_RGB_TO_PROPHOTO_M02,
          ADOBE_RGB_TO_PROPHOTO_M10, ADOBE_RGB_TO_PROPHOTO_M11, ADOBE_RGB_TO_PROPHOTO_M12,
          ADOBE_RGB_TO_PROPHOTO_M20, ADOBE_RGB_TO_PROPHOTO_M21, ADOBE_RGB_TO_PROPHOTO_M22,
        ]
      : normalizedProfile === "rec2020"
        ? [
            REC_2020_TO_PROPHOTO_M00, REC_2020_TO_PROPHOTO_M01, REC_2020_TO_PROPHOTO_M02,
            REC_2020_TO_PROPHOTO_M10, REC_2020_TO_PROPHOTO_M11, REC_2020_TO_PROPHOTO_M12,
            REC_2020_TO_PROPHOTO_M20, REC_2020_TO_PROPHOTO_M21, REC_2020_TO_PROPHOTO_M22,
          ]
        : [
            SRGB_TO_PROPHOTO_M00, SRGB_TO_PROPHOTO_M01, SRGB_TO_PROPHOTO_M02,
            SRGB_TO_PROPHOTO_M10, SRGB_TO_PROPHOTO_M11, SRGB_TO_PROPHOTO_M12,
            SRGB_TO_PROPHOTO_M20, SRGB_TO_PROPHOTO_M21, SRGB_TO_PROPHOTO_M22,
          ];

  return (r, g, b, output) => {
    const lr = lut[r] ?? 0;
    const lg = lut[g] ?? 0;
    const lb = lut[b] ?? 0;
    output[0] = matrix[0] * lr + matrix[1] * lg + matrix[2] * lb;
    output[1] = matrix[3] * lr + matrix[4] * lg + matrix[5] * lb;
    output[2] = matrix[6] * lr + matrix[7] * lg + matrix[8] * lb;
    return output;
  };
}

export function encodedRgbToLinearProphotoInto(
  r: number,
  g: number,
  b: number,
  profile: ImageInputColorProfile | string,
  output: RgbTripletBuffer,
): RgbTripletBuffer {
  const normalizedProfile = normalizeImageInputColorProfile(profile);
  if (normalizedProfile === "prophoto") {
    output[0] = prophotoEncodedToLinear(r);
    output[1] = prophotoEncodedToLinear(g);
    output[2] = prophotoEncodedToLinear(b);
    return output;
  }
  if (normalizedProfile === "adobe-rgb") {
    const lr = adobeRgbEncodedToLinear(r);
    const lg = adobeRgbEncodedToLinear(g);
    const lb = adobeRgbEncodedToLinear(b);
    output[0] = ADOBE_RGB_TO_PROPHOTO_M00 * lr + ADOBE_RGB_TO_PROPHOTO_M01 * lg + ADOBE_RGB_TO_PROPHOTO_M02 * lb;
    output[1] = ADOBE_RGB_TO_PROPHOTO_M10 * lr + ADOBE_RGB_TO_PROPHOTO_M11 * lg + ADOBE_RGB_TO_PROPHOTO_M12 * lb;
    output[2] = ADOBE_RGB_TO_PROPHOTO_M20 * lr + ADOBE_RGB_TO_PROPHOTO_M21 * lg + ADOBE_RGB_TO_PROPHOTO_M22 * lb;
    return output;
  }
  if (normalizedProfile === "rec2020") {
    const lr = rec2020EncodedToLinear(r);
    const lg = rec2020EncodedToLinear(g);
    const lb = rec2020EncodedToLinear(b);
    output[0] = REC_2020_TO_PROPHOTO_M00 * lr + REC_2020_TO_PROPHOTO_M01 * lg + REC_2020_TO_PROPHOTO_M02 * lb;
    output[1] = REC_2020_TO_PROPHOTO_M10 * lr + REC_2020_TO_PROPHOTO_M11 * lg + REC_2020_TO_PROPHOTO_M12 * lb;
    output[2] = REC_2020_TO_PROPHOTO_M20 * lr + REC_2020_TO_PROPHOTO_M21 * lg + REC_2020_TO_PROPHOTO_M22 * lb;
    return output;
  }

  const lr = srgbChannelToLinear(clamp01(r) * 255);
  const lg = srgbChannelToLinear(clamp01(g) * 255);
  const lb = srgbChannelToLinear(clamp01(b) * 255);
  if (normalizedProfile === "display-p3") {
    output[0] = DISPLAY_P3_TO_PROPHOTO_M00 * lr + DISPLAY_P3_TO_PROPHOTO_M01 * lg + DISPLAY_P3_TO_PROPHOTO_M02 * lb;
    output[1] = DISPLAY_P3_TO_PROPHOTO_M10 * lr + DISPLAY_P3_TO_PROPHOTO_M11 * lg + DISPLAY_P3_TO_PROPHOTO_M12 * lb;
    output[2] = DISPLAY_P3_TO_PROPHOTO_M20 * lr + DISPLAY_P3_TO_PROPHOTO_M21 * lg + DISPLAY_P3_TO_PROPHOTO_M22 * lb;
    return output;
  }
  output[0] = SRGB_TO_PROPHOTO_M00 * lr + SRGB_TO_PROPHOTO_M01 * lg + SRGB_TO_PROPHOTO_M02 * lb;
  output[1] = SRGB_TO_PROPHOTO_M10 * lr + SRGB_TO_PROPHOTO_M11 * lg + SRGB_TO_PROPHOTO_M12 * lb;
  output[2] = SRGB_TO_PROPHOTO_M20 * lr + SRGB_TO_PROPHOTO_M21 * lg + SRGB_TO_PROPHOTO_M22 * lb;
  return output;
}

export function encodedRgbToLinearProphoto(
  r: number,
  g: number,
  b: number,
  profile: ImageInputColorProfile,
): [number, number, number] {
  const output: [number, number, number] = [0, 0, 0];
  encodedRgbToLinearProphotoInto(r, g, b, profile, output);
  return output;
}

export function convertLinearProPhotoToOutputRgbInto(
  r: number,
  g: number,
  b: number,
  outputColorProfile: ImageEditOutputColorProfile,
  output: RgbTripletBuffer,
): RgbTripletBuffer {
  const m00 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M00 : PROPHOTO_TO_SRGB_M00;
  const m01 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M01 : PROPHOTO_TO_SRGB_M01;
  const m02 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M02 : PROPHOTO_TO_SRGB_M02;
  const m10 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M10 : PROPHOTO_TO_SRGB_M10;
  const m11 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M11 : PROPHOTO_TO_SRGB_M11;
  const m12 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M12 : PROPHOTO_TO_SRGB_M12;
  const m20 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M20 : PROPHOTO_TO_SRGB_M20;
  const m21 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M21 : PROPHOTO_TO_SRGB_M21;
  const m22 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M22 : PROPHOTO_TO_SRGB_M22;
  output[0] = m00 * r + m01 * g + m02 * b;
  output[1] = m10 * r + m11 * g + m12 * b;
  output[2] = m20 * r + m21 * g + m22 * b;
  return output;
}

export function convertLinearProPhotoToOutputRgb(
  r: number,
  g: number,
  b: number,
  outputColorProfile: ImageEditOutputColorProfile,
): [number, number, number] {
  const output: [number, number, number] = [0, 0, 0];
  convertLinearProPhotoToOutputRgbInto(r, g, b, outputColorProfile, output);
  return output;
}
