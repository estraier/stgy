import type { PanoramaAlignmentDirection } from "./panorama-options";

export type PanoramaCameraPathAxis = "horizontal" | "vertical";

/** Match the Panorama alignment choice to OpenCV's wave correction enum. */
export function panoramaWaveCorrectionKind(
  direction: PanoramaAlignmentDirection,
  kinds: Readonly<Record<PanoramaAlignmentDirection, number>>,
): number {
  const kind = kinds[direction];
  if (!Number.isFinite(kind)) {
    throw new Error(`Panorama wave correction kind for ${direction} is unavailable.`);
  }
  return kind;
}

/** The rotations and focal lengths are estimated at OpenCV's registration work scale. */
export type PanoramaDirectionCamera = {
  rotation: ArrayLike<number>;
  focal: number;
  aspect: number;
};

export type PanoramaDirectionImageSize = { width: number; height: number };

export const PANORAMA_MIN_PRIMARY_MOVE_FRACTION = 0.05;
export const PANORAMA_MAX_CROSS_MOVE_RATIO = 0.25;

export type PanoramaDirectionResult = { accepted: true } | { accepted: false; reason: string };

/**
 * Check the estimated *upright panorama* camera trajectory, not the input
 * aspect ratio or original file order. A camera's optical axis is column 3
 * of OpenCV's un-wave-corrected camera-to-world rotation. Spherical angular
 * coordinates let us compare images on the same panorama axes regardless of
 * whether an individual upright image is landscape or portrait.
 *
 * The 5% threshold is translated from the upright image width/height to an
 * angle using each camera's work-scale intrinsics. Both neighbors must clear
 * the threshold. A 25% cross-axis allowance is measured in angular panorama
 * coordinates. The stitcher's full connectivity check runs separately.
 */
export function checkPanoramaDirection(
  direction: PanoramaAlignmentDirection,
  cameras: readonly PanoramaDirectionCamera[],
  imageSizes: readonly PanoramaDirectionImageSize[],
  workScale: number,
): PanoramaDirectionResult {
  if (direction === "auto") return { accepted: true };
  if (direction !== "horizontal" && direction !== "vertical") {
    throw new Error(`Unsupported panorama alignment direction: ${String(direction)}.`);
  }
  if (cameras.length !== imageSizes.length || cameras.length < 2 || !(workScale > 0) || !Number.isFinite(workScale)) {
    throw new Error("Panorama direction check requires matching cameras, image sizes and a valid work scale.");
  }

  const positions = cameras.map((camera, index) => {
    assertRotation(camera.rotation, `Panorama camera ${index + 1} rotation`);
    const { focal, aspect } = camera;
    const size = imageSizes[index]!;
    if (!(focal > 0) || !(aspect > 0) || !Number.isFinite(focal) || !Number.isFinite(aspect)
        || !(size.width > 0) || !(size.height > 0) || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
      throw new Error(`Panorama camera ${index + 1} has invalid intrinsics or upright image size.`);
    }
    const x = Number(camera.rotation[2]);
    const y = Number(camera.rotation[5]);
    const z = Number(camera.rotation[8]);
    if (!(Math.hypot(x, y, z) > 0)) {
      throw new Error(`Panorama camera ${index + 1} has an invalid optical axis.`);
    }
    const primaryDimension = direction === "horizontal" ? size.width : size.height;
    const primaryFocal = direction === "horizontal" ? focal : focal * aspect;
    return {
      index,
      longitude: Math.atan2(x, z),
      latitude: Math.atan2(y, Math.hypot(x, z)),
      minAngle: Math.atan(PANORAMA_MIN_PRIMARY_MOVE_FRACTION * primaryDimension * workScale / primaryFocal),
    };
  });

  // For a horizontal panorama choose the shortest covering longitude arc.
  // This also handles pans that cross the longitude wrap at +/-180 degrees.
  const longitudes = positions.map((position) => position.longitude).sort((a, b) => a - b);
  let largestGapIndex = 0;
  let largestGap = -1;
  for (let index = 0; index < longitudes.length; index += 1) {
    const next = index + 1 < longitudes.length ? longitudes[index + 1]! : longitudes[0]! + Math.PI * 2;
    const gap = next - longitudes[index]!;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }
  const start = longitudes[(largestGapIndex + 1) % longitudes.length]!;
  const ordered = positions.map((position) => ({
    ...position,
    unwrappedLongitude: position.longitude < start ? position.longitude + Math.PI * 2 : position.longitude,
  })).sort((a, b) => {
    const delta = direction === "horizontal"
      ? a.unwrappedLongitude - b.unwrappedLongitude
      : a.latitude - b.latitude;
    return delta || a.index - b.index;
  });

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const deltaLongitude = direction === "horizontal"
      ? current.unwrappedLongitude - previous.unwrappedLongitude
      : Math.abs(Math.atan2(
        Math.sin(current.longitude - previous.longitude),
        Math.cos(current.longitude - previous.longitude),
      ));
    const deltaLatitude = Math.abs(current.latitude - previous.latitude);
    const primary = direction === "horizontal" ? deltaLongitude : deltaLatitude;
    const cross = direction === "horizontal" ? deltaLatitude : deltaLongitude;
    const minimum = Math.max(previous.minAngle, current.minAngle);
    const pairLabel = `${previous.index + 1} and ${current.index + 1}`;
    if (primary + 1e-12 < minimum) {
      return {
        accepted: false,
        reason: `images ${pairLabel} move only ${(primary / minimum * (PANORAMA_MIN_PRIMARY_MOVE_FRACTION * 100)).toFixed(1)}% of the required image dimension (minimum ${PANORAMA_MIN_PRIMARY_MOVE_FRACTION * 100}%) along ${direction}`,
      };
    }
    if (cross > primary * PANORAMA_MAX_CROSS_MOVE_RATIO + 1e-12) {
      return {
        accepted: false,
        reason: `images ${pairLabel} drift ${(cross / primary * 100).toFixed(1)}% across the ${direction} path (maximum 25%)`,
      };
    }
  }
  return { accepted: true };
}


type RotationLike = ArrayLike<number>;

const MATRIX_SIZE = 9;
function assertRotation(rotation: RotationLike, label: string): void {
  if (rotation.length < MATRIX_SIZE) {
    throw new Error(`${label} must contain a 3x3 rotation matrix.`);
  }
  for (let index = 0; index < MATRIX_SIZE; index += 1) {
    if (!Number.isFinite(Number(rotation[index]))) {
      throw new Error(`${label} contains a non-finite rotation value.`);
    }
  }
}

/**
 * Matches OpenCV detail::autoDetectWaveCorrectKind(): compare the image-axis
 * spans of the estimated camera optical axes before wave correction.
 */
export function panoramaCameraPathAxis(rotations: readonly RotationLike[]): PanoramaCameraPathAxis {
  if (rotations.length <= 1) return "horizontal";

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  rotations.forEach((rotation, index) => {
    assertRotation(rotation, `Panorama camera ${index + 1} rotation`);
    const forwardZ = Number(rotation[8]);
    const x = Number(rotation[2]) / forwardZ;
    const y = Number(rotation[5]) / forwardZ;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  return maxY - minY > maxX - minX ? "vertical" : "horizontal";
}

function quarterTurnLeft(rotation: RotationLike, direction: 1 | -1): Float32Array {
  assertRotation(rotation, "Panorama wave-corrected rotation");
  const result = new Float32Array(MATRIX_SIZE);

  if (direction === 1) {
    // Rz(+90 deg) * R: row0 = -row1, row1 = row0, row2 = row2.
    result[0] = -Number(rotation[3]);
    result[1] = -Number(rotation[4]);
    result[2] = -Number(rotation[5]);
    result[3] = Number(rotation[0]);
    result[4] = Number(rotation[1]);
    result[5] = Number(rotation[2]);
  } else {
    // Rz(-90 deg) * R: row0 = row1, row1 = -row0, row2 = row2.
    result[0] = Number(rotation[3]);
    result[1] = Number(rotation[4]);
    result[2] = Number(rotation[5]);
    result[3] = -Number(rotation[0]);
    result[4] = -Number(rotation[1]);
    result[5] = -Number(rotation[2]);
  }
  result[6] = Number(rotation[6]);
  result[7] = Number(rotation[7]);
  result[8] = Number(rotation[8]);
  return result;
}

function orientationSimilarity(reference: readonly RotationLike[], candidate: readonly RotationLike[]): number {
  let score = 0;
  for (let cameraIndex = 0; cameraIndex < reference.length; cameraIndex += 1) {
    const expected = reference[cameraIndex]!;
    const actual = candidate[cameraIndex]!;
    for (let matrixIndex = 0; matrixIndex < MATRIX_SIZE; matrixIndex += 1) {
      score += Number(expected[matrixIndex]) * Number(actual[matrixIndex]);
    }
  }
  return score;
}

/**
 * OpenCV WAVE_CORRECT_VERT deliberately chooses a panorama basis whose first
 * image axis becomes the vertical correction axis. For a normal upright
 * vertical pan this introduces a global +/-90 degree roll. Keep OpenCV's wave
 * correction, but rotate the corrected camera basis back by one quarter turn.
 * The sign that best preserves the pre-correction camera orientation is used,
 * so the panorama remains upright rather than becoming upside-down. With an
 * explicit direction, honor that choice rather than re-detecting the camera axis.
 * Auto preserves the previous inferred-axis behavior.
 */
export function restoreVerticalWaveCorrectionRoll(
  estimatedRotations: readonly RotationLike[],
  correctedRotations: readonly RotationLike[],
  direction: PanoramaAlignmentDirection = "auto",
): Float32Array[] {
  if (estimatedRotations.length !== correctedRotations.length) {
    throw new Error("Panorama camera counts differ before and after wave correction.");
  }
  const shouldRestoreVertical = direction === "vertical"
    || (direction === "auto" && panoramaCameraPathAxis(estimatedRotations) === "vertical");
  if (estimatedRotations.length <= 1 || !shouldRestoreVertical) {
    return correctedRotations.map((rotation, index) => {
      assertRotation(rotation, `Panorama wave-corrected camera ${index + 1} rotation`);
      return new Float32Array(Array.from(rotation).slice(0, MATRIX_SIZE));
    });
  }

  const positive = correctedRotations.map((rotation) => quarterTurnLeft(rotation, 1));
  const negative = correctedRotations.map((rotation) => quarterTurnLeft(rotation, -1));
  return orientationSimilarity(estimatedRotations, positive) >= orientationSimilarity(estimatedRotations, negative)
    ? positive
    : negative;
}
