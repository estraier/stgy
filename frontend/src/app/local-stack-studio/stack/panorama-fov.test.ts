import {
  FULL_FRAME_DIAGONAL_MM,
  focalPixelsFromDiagonalFoV,
  diagonalFoVFromExif,
  resolvePanoramaFoV,
} from "./panorama-fov";
import { parsePanoramaFoVOption } from "./panorama-options";

const original = { width: 5184, height: 3888, focalLength35mm: 30 };
const rotated = { width: 3888, height: 5184, focalLength35mm: 30 };

describe("Panorama diagonal FoV", () => {
  test("manual options are exactly 20 through 120 degrees in 5-degree increments", () => {
    expect(parsePanoramaFoVOption("EXIF")).toBe("exif");
    expect(parsePanoramaFoVOption("Estimate")).toBe("estimate");
    for (let degrees = 20; degrees <= 120; degrees += 5) {
      expect(parsePanoramaFoVOption(String(degrees))).toBe(degrees);
    }
    expect(parsePanoramaFoVOption("15")).toBeUndefined();
    expect(parsePanoramaFoVOption("121")).toBeUndefined();
  });

  test("35mm equivalent is converted to diagonal, not long-edge angle", () => {
    const angle = diagonalFoVFromExif({ focalLength35mm: 30 });
    expect(angle).not.toBeNull();
    expect(angle!).toBeCloseTo(2 * Math.atan(FULL_FRAME_DIAGONAL_MM / 60) * 180 / Math.PI, 9);
    expect(angle!).toBeGreaterThan(70);
  });

  test("physical focal length and sensor diagonal produce identical FoV", () => {
    const fromPhysical = diagonalFoVFromExif({ focalLength: 15, sensorDiagonalMm: FULL_FRAME_DIAGONAL_MM / 2 });
    const fromEquivalent = diagonalFoVFromExif({ focalLength35mm: 30 });
    expect(fromPhysical).toBeCloseTo(fromEquivalent!, 9);
  });

  test("portrait and landscape rotation preserve manual and EXIF focal length", () => {
    for (const option of ["exif" as const, 70]) {
      const result = resolvePanoramaFoV(option, [original, rotated]);
      expect(result.focalPixels).not.toBeNull();
      expect(result.focalPixels![0]).toBeCloseTo(result.focalPixels![1], 9);
    }
  });

  test("different EXIF focal lengths can be fixed independently", () => {
    const result = resolvePanoramaFoV("exif", [original, { ...original, focalLength35mm: 60 }]);
    expect(result.source).toBe("exif");
    expect(result.focalPixels![1]).toBeCloseTo(result.focalPixels![0] * 2, 9);
  });

  test("EXIF is an all-or-nothing selection and falls back to Estimate", () => {
    const result = resolvePanoramaFoV("exif", [original, { width: 5184, height: 3888 }]);
    expect(result).toEqual({ source: "estimate", diagonalFoVDegrees: null, focalPixels: null });
  });

  test("Estimate leaves intrinsics entirely to OpenCV", () => {
    const result = resolvePanoramaFoV("estimate", [original, rotated]);
    expect(result).toEqual({ source: "estimate", diagonalFoVDegrees: null, focalPixels: null });
  });

  test("manual FoV is diagonal, not tied to EXIF", () => {
    const result = resolvePanoramaFoV(120, [original, { width: 4000, height: 3000 }]);
    expect(result.source).toBe("manual");
    expect(result.diagonalFoVDegrees).toBe(120);
    expect(result.focalPixels![0]).toBeCloseTo(focalPixelsFromDiagonalFoV(5184, 3888, 120), 10);
    expect(result.focalPixels![1]).toBeCloseTo(focalPixelsFromDiagonalFoV(4000, 3000, 120), 10);
  });

  test("invalid dimensions, angles, and optical metadata are rejected", () => {
    expect(() => focalPixelsFromDiagonalFoV(0, 3000, 70)).toThrow();
    expect(() => focalPixelsFromDiagonalFoV(4000, 3000, 180)).toThrow();
    expect(diagonalFoVFromExif({ focalLength: 0, sensorDiagonalMm: 21.6 })).toBeNull();
    expect(diagonalFoVFromExif({ focalLength35mm: -1 })).toBeNull();
  });
});
