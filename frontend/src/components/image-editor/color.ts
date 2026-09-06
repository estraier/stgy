import type { ImageEditOutputColorProfile, ImageInputColorProfile } from "./types";
import { clamp01, srgbChannelToLinear } from "./tone";

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
export const PROPHOTO_LUMA_R = 0.2880402;
export const PROPHOTO_LUMA_G = 0.7118741;
export const PROPHOTO_LUMA_B = 0.0000857;

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

export function encodedRgbToLinearProphoto(
  r: number,
  g: number,
  b: number,
  profile: ImageInputColorProfile,
): [number, number, number] {
  if (profile === "prophoto") {
    return [
      prophotoEncodedToLinear(r),
      prophotoEncodedToLinear(g),
      prophotoEncodedToLinear(b),
    ];
  }
  if (profile === "adobe-rgb") {
    const lr = adobeRgbEncodedToLinear(r);
    const lg = adobeRgbEncodedToLinear(g);
    const lb = adobeRgbEncodedToLinear(b);
    return [
      ADOBE_RGB_TO_PROPHOTO_M00 * lr + ADOBE_RGB_TO_PROPHOTO_M01 * lg + ADOBE_RGB_TO_PROPHOTO_M02 * lb,
      ADOBE_RGB_TO_PROPHOTO_M10 * lr + ADOBE_RGB_TO_PROPHOTO_M11 * lg + ADOBE_RGB_TO_PROPHOTO_M12 * lb,
      ADOBE_RGB_TO_PROPHOTO_M20 * lr + ADOBE_RGB_TO_PROPHOTO_M21 * lg + ADOBE_RGB_TO_PROPHOTO_M22 * lb,
    ];
  }
  if (profile === "rec2020") {
    const lr = rec2020EncodedToLinear(r);
    const lg = rec2020EncodedToLinear(g);
    const lb = rec2020EncodedToLinear(b);
    return [
      REC_2020_TO_PROPHOTO_M00 * lr + REC_2020_TO_PROPHOTO_M01 * lg + REC_2020_TO_PROPHOTO_M02 * lb,
      REC_2020_TO_PROPHOTO_M10 * lr + REC_2020_TO_PROPHOTO_M11 * lg + REC_2020_TO_PROPHOTO_M12 * lb,
      REC_2020_TO_PROPHOTO_M20 * lr + REC_2020_TO_PROPHOTO_M21 * lg + REC_2020_TO_PROPHOTO_M22 * lb,
    ];
  }

  const lr = srgbChannelToLinear(clamp01(r) * 255);
  const lg = srgbChannelToLinear(clamp01(g) * 255);
  const lb = srgbChannelToLinear(clamp01(b) * 255);
  if (profile === "display-p3") {
    return [
      DISPLAY_P3_TO_PROPHOTO_M00 * lr + DISPLAY_P3_TO_PROPHOTO_M01 * lg + DISPLAY_P3_TO_PROPHOTO_M02 * lb,
      DISPLAY_P3_TO_PROPHOTO_M10 * lr + DISPLAY_P3_TO_PROPHOTO_M11 * lg + DISPLAY_P3_TO_PROPHOTO_M12 * lb,
      DISPLAY_P3_TO_PROPHOTO_M20 * lr + DISPLAY_P3_TO_PROPHOTO_M21 * lg + DISPLAY_P3_TO_PROPHOTO_M22 * lb,
    ];
  }
  return [
    SRGB_TO_PROPHOTO_M00 * lr + SRGB_TO_PROPHOTO_M01 * lg + SRGB_TO_PROPHOTO_M02 * lb,
    SRGB_TO_PROPHOTO_M10 * lr + SRGB_TO_PROPHOTO_M11 * lg + SRGB_TO_PROPHOTO_M12 * lb,
    SRGB_TO_PROPHOTO_M20 * lr + SRGB_TO_PROPHOTO_M21 * lg + SRGB_TO_PROPHOTO_M22 * lb,
  ];
}

export function convertLinearProPhotoToOutputRgb(
  r: number,
  g: number,
  b: number,
  outputColorProfile: ImageEditOutputColorProfile,
): [number, number, number] {
  const m00 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M00 : PROPHOTO_TO_SRGB_M00;
  const m01 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M01 : PROPHOTO_TO_SRGB_M01;
  const m02 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M02 : PROPHOTO_TO_SRGB_M02;
  const m10 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M10 : PROPHOTO_TO_SRGB_M10;
  const m11 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M11 : PROPHOTO_TO_SRGB_M11;
  const m12 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M12 : PROPHOTO_TO_SRGB_M12;
  const m20 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M20 : PROPHOTO_TO_SRGB_M20;
  const m21 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M21 : PROPHOTO_TO_SRGB_M21;
  const m22 = outputColorProfile === "display-p3" ? PROPHOTO_TO_DISPLAY_P3_M22 : PROPHOTO_TO_SRGB_M22;
  return [
    m00 * r + m01 * g + m02 * b,
    m10 * r + m11 * g + m12 * b,
    m20 * r + m21 * g + m22 * b,
  ];
}
