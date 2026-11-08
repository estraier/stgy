import type { PanoramaAlignmentDirection } from "./panorama-options";

export type PanoramaProjection = "spherical" | "cylindrical-horizontal" | "cylindrical-vertical";

/** Sufficient dominance to infer a one-axis panorama without imposing explicit alignment constraints. */
export const PANORAMA_AUTO_AXIS_DOMINANCE = 1.5;
const PANORAMA_AUTO_MINIMUM_SPAN_RADIANS = 2 * Math.PI / 180;

export type PanoramaProjectionRotation = ArrayLike<number>;

function shortestLongitudeSpan(longitudes: readonly number[]): number {
  if (longitudes.length < 2) return 0;
  const sorted = [...longitudes].sort((a, b) => a - b);
  let largestGap = sorted[0]! + Math.PI * 2 - sorted[sorted.length - 1]!;
  for (let i = 1; i < sorted.length; i += 1) {
    largestGap = Math.max(largestGap, sorted[i]! - sorted[i - 1]!);
  }
  return Math.PI * 2 - largestGap;
}

/**
 * Use camera optical axes BEFORE wave correction. For mixed/diagonal grids,
 * keep the legacy spherical projection instead of inventing a preferred axis.
 * Each 3x3 R is camera-to-world, row-major, and its third column is the axis.
 */
export function selectPanoramaProjection(
  selection: PanoramaAlignmentDirection,
  rotations: readonly PanoramaProjectionRotation[],
): PanoramaProjection {
  if (selection === "horizontal") return "cylindrical-horizontal";
  if (selection === "vertical") return "cylindrical-vertical";
  if (selection === "spherical") return "spherical";
  if (selection !== "auto") throw new Error(`Unsupported panorama projection selection: ${String(selection)}`);
  if (rotations.length < 2) return "spherical";

  const longitudes: number[] = [];
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  for (const rotation of rotations) {
    if (rotation.length < 9) throw new Error("Invalid panorama camera rotation matrix.");
    const x = Number(rotation[2]);
    const y = Number(rotation[5]);
    const z = Number(rotation[8]);
    if (![x, y, z].every(Number.isFinite) || Math.hypot(x, y, z) < 1e-8) {
      throw new Error("Invalid panorama camera optical axis.");
    }
    const latitude = Math.atan2(y, Math.hypot(x, z));
    longitudes.push(Math.atan2(x, z));
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
  }
  const horizontal = shortestLongitudeSpan(longitudes);
  const vertical = maxLatitude - minLatitude;
  const threshold = PANORAMA_AUTO_MINIMUM_SPAN_RADIANS;
  if (horizontal >= threshold && horizontal >= vertical * PANORAMA_AUTO_AXIS_DOMINANCE) {
    return "cylindrical-horizontal";
  }
  if (vertical >= threshold && vertical >= horizontal * PANORAMA_AUTO_AXIS_DOMINANCE) {
    return "cylindrical-vertical";
  }
  return "spherical";
}

/**
 * Rotate the camera-to-world basis 90 degrees about the viewing (Z) axis.
 * With OpenCV's cylindrical projection this maps a vertical camera path onto
 * the horizontal cylinder. The resulting panorama pixels must be rotated 90
 * degrees counter-clockwise to restore their original upright orientation.
 * Source pixels and intrinsics are left untouched (no full-resolution copy).
 */
export function turnCameraForVerticalCylindrical(rotation: PanoramaProjectionRotation): Float32Array {
  if (rotation.length < 9) throw new Error("Invalid panorama camera rotation matrix.");
  const result = new Float32Array([
    -Number(rotation[3]), -Number(rotation[4]), -Number(rotation[5]),
    Number(rotation[0]), Number(rotation[1]), Number(rotation[2]),
    Number(rotation[6]), Number(rotation[7]), Number(rotation[8]),
  ]);
  if (!Array.from(result).every(Number.isFinite)) throw new Error("Invalid panorama camera rotation matrix.");
  return result;
}

/**
 * Turn a packed RGB image 90 degrees counter-clockwise in place, using one
 * bit per pixel rather than allocating a second full-resolution RGB buffer.
 * The returned dimensions are height x width.
 */
export function rotateGamma2RgbCounterClockwiseInPlace(rgb: Uint16Array, width: number, height: number): void {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || rgb.length !== pixels * 3) {
    throw new Error("Invalid panorama output dimensions for quarter-turn.");
  }
  const visited = new Uint8Array(Math.ceil(pixels / 8));
  const seen = (index: number): boolean => (visited[index >> 3]! & (1 << (index & 7))) !== 0;
  const mark = (index: number): void => { visited[index >> 3] = visited[index >> 3]! | (1 << (index & 7)); };
  // (x, y) -> (y, width-1-x), row stride becomes height.
  const destination = (index: number): number => {
    const x = index % width;
    const y = Math.floor(index / width);
    return (width - 1 - x) * height + y;
  };
  for (let start = 0; start < pixels; start += 1) {
    if (seen(start)) continue;
    let index = start;
    let r = rgb[start * 3]!;
    let g = rgb[start * 3 + 1]!;
    let b = rgb[start * 3 + 2]!;
    do {
      mark(index);
      const next = destination(index);
      const offset = next * 3;
      const nextR = rgb[offset]!;
      const nextG = rgb[offset + 1]!;
      const nextB = rgb[offset + 2]!;
      rgb[offset] = r;
      rgb[offset + 1] = g;
      rgb[offset + 2] = b;
      r = nextR;
      g = nextG;
      b = nextB;
      index = next;
    } while (index !== start);
  }
}

/** Crop and quarter-turn in one output allocation, with no intermediate image. */
export function cropGamma2RgbCounterClockwise(
  source: Uint16Array,
  canvasWidth: number,
  crop: { x: number; y: number; width: number; height: number },
): Uint16Array {
  const output = new Uint16Array(crop.width * crop.height * 3);
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const src = ((crop.y + y) * canvasWidth + crop.x + x) * 3;
      const dst = ((crop.width - 1 - x) * crop.height + y) * 3;
      output[dst] = source[src]!;
      output[dst + 1] = source[src + 1]!;
      output[dst + 2] = source[src + 2]!;
    }
  }
  return output;
}
