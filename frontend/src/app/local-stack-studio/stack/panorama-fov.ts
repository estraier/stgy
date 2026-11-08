/** Convert diagonal lens angle to pixel intrinsics, independent of EXIF Orientation. */
import type { PanoramaFoVOption } from "./panorama-options";

export const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);
export type PanoramaExifOptics = {
  focalLength35mm?: number | null;
  focalLength?: number | null;
  sensorDiagonalMm?: number | null;
};
export type PanoramaImageOptics = PanoramaExifOptics & { width: number; height: number };
export type ResolvedPanoramaFoV = {
  source: "exif" | "estimate" | "manual";
  diagonalFoVDegrees: number | null;
  focalPixels: number[] | null;
};

export function focalPixelsFromDiagonalFoV(width: number, height: number, degrees: number): number {
  if (!(width > 0 && height > 0) || !Number.isFinite(width) || !Number.isFinite(height)
      || !(degrees > 0 && degrees < 180)) throw new Error("Invalid panorama FoV or image dimensions.");
  return Math.hypot(width, height) / (2 * Math.tan(degrees * Math.PI / 360));
}

export function diagonalFoVFromExif(optics: PanoramaExifOptics): number | null {
  const equiv = Number(optics.focalLength35mm);
  const focal = Number(optics.focalLength);
  const sensorDiagonal = Number(optics.sensorDiagonalMm);
  const diagonal = equiv > 0 && Number.isFinite(equiv) ? FULL_FRAME_DIAGONAL_MM / equiv
    : focal > 0 && Number.isFinite(focal) && sensorDiagonal > 0 && Number.isFinite(sensorDiagonal)
      ? sensorDiagonal / focal
      : NaN;
  const angle = Math.atan(diagonal / 2) * 360 / Math.PI;
  // A pinhole / rectilinear model is not meaningful for extreme fisheyes.
  return Number.isFinite(angle) && angle > 5 && angle < 150 ? angle : null;
}

export function resolvePanoramaFoV(
  option: PanoramaFoVOption,
  images: readonly PanoramaImageOptics[],
): ResolvedPanoramaFoV {
  if (option === "estimate") return { source: "estimate", diagonalFoVDegrees: null, focalPixels: null };
  if (!images.length) throw new Error("Panorama FoV requires image metadata.");
  const angles = option === "exif" ? images.map(diagonalFoVFromExif) : images.map(() => option);
  if (angles.some((angle) => angle === null)) {
    return { source: "estimate", diagonalFoVDegrees: null, focalPixels: null };
  }
  const pixels = images.map((image, index) => focalPixelsFromDiagonalFoV(image.width, image.height, angles[index]!));
  const ordered = angles as number[];
  return {
    source: option === "exif" ? "exif" : "manual",
    diagonalFoVDegrees: option === "exif" ? ordered.reduce((sum, angle) => sum + angle, 0) / ordered.length : option,
    focalPixels: pixels,
  };
}
