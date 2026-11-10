import type { PanoramaAlignmentDirection } from "./panorama-options";

export type PanoramaCameraPathAxis = "horizontal" | "vertical";

/** Match the Panorama alignment choice to OpenCV's wave correction enum. */
export function panoramaWaveCorrectionKind(
  direction: "auto" | "horizontal" | "vertical",
  kinds: Readonly<Record<"auto" | "horizontal" | "vertical", number>>,
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
/** Limits apply only to explicit horizontal/vertical panorama alignment. */
export const PANORAMA_MAX_ADJACENT_ROLL_DEGREES = 30;
export const PANORAMA_MAX_FOCAL_DEVIATION_FRACTION = 0.05;

export type PanoramaGeometryMetrics = {
  minPrimaryMovePercent: number;
  maxCrossMovePercent: number;
  maxAdjacentRollDegrees: number;
  maxRollPair: readonly [number, number] | null;
  medianFocal: number;
  maxFocalDeviationPercent: number;
  maxFocalDeviationImage: number;
};
export type PanoramaGeometryResult = {
  accepted: boolean;
  reason: string | null;
  metrics: PanoramaGeometryMetrics;
};

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
  if (direction === "auto" || direction === "spherical") return { accepted: true };
  if (direction !== "horizontal" && direction !== "vertical") {
    throw new Error(`Unsupported panorama alignment direction: ${String(direction)}.`);
  }
  if (cameras.length !== imageSizes.length || cameras.length < 2 || !(workScale > 0) || !Number.isFinite(workScale)) {
    throw new Error("Panorama direction check requires matching cameras, image sizes and a valid work scale.");
  }

  return checkOrderedPanoramaDirection(direction, orderedPanoramaPositions(direction, cameras, imageSizes, workScale));
}

type OrderedPanoramaPosition = {
  index: number;
  longitude: number;
  latitude: number;
  minAngle: number;
  unwrappedLongitude: number;
  rotation: ArrayLike<number>;
};

function orderedPanoramaPositions(
  direction: "horizontal" | "vertical",
  cameras: readonly PanoramaDirectionCamera[],
  imageSizes: readonly PanoramaDirectionImageSize[],
  workScale: number,
): OrderedPanoramaPosition[] {
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
      rotation: camera.rotation,
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

  return ordered;
}

function checkOrderedPanoramaDirection(
  direction: "horizontal" | "vertical", ordered: readonly OrderedPanoramaPosition[],
): PanoramaDirectionResult {
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

/**
 * Validate bundle-adjusted camera geometry without modifying the rotations or
 * intrinsics. A minimal 3-D rotation transports each camera's image-up vector
 * between the two optical axes, so ordinary yaw/pitch is not mistaken for roll.
 * Relative roll is measured between spatial neighbors along the panorama path,
 * not between successive files (input file order need not be spatial order).
 */
export function checkPanoramaCameraGeometry(
  direction: PanoramaAlignmentDirection,
  cameras: readonly PanoramaDirectionCamera[],
  imageSizes: readonly PanoramaDirectionImageSize[],
  workScale: number,
): PanoramaGeometryResult | null {
  if (direction === "auto" || direction === "spherical") return null;
  if (direction !== "horizontal" && direction !== "vertical") {
    throw new Error(`Unsupported panorama alignment direction: ${String(direction)}.`);
  }
  if (cameras.length !== imageSizes.length || cameras.length < 2 || !(workScale > 0) || !Number.isFinite(workScale)) {
    throw new Error("Panorama geometry check requires matching cameras, image sizes and a valid work scale.");
  }
  const ordered = orderedPanoramaPositions(direction, cameras, imageSizes, workScale);
  let minPrimaryMovePercent = Number.POSITIVE_INFINITY;
  let maxCrossMovePercent = 0;
  let maxAdjacentRollDegrees = 0;
  let maxRollPair: [number, number] | null = null;
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;
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
    minPrimaryMovePercent = Math.min(minPrimaryMovePercent,
      primary / minimum * PANORAMA_MIN_PRIMARY_MOVE_FRACTION * 100);
    maxCrossMovePercent = Math.max(maxCrossMovePercent,
      primary > 0 ? cross / primary * 100 : cross > 0 ? Number.POSITIVE_INFINITY : 0);
    const rollDegrees = relativePanoramaRollDegrees(previous.rotation, current.rotation);
    if (rollDegrees > maxAdjacentRollDegrees) {
      maxAdjacentRollDegrees = rollDegrees;
      maxRollPair = [previous.index + 1, current.index + 1];
    }
  }

  const focals = cameras.map((camera) => camera.focal).sort((a, b) => a - b);
  const middle = Math.floor(focals.length / 2);
  const medianFocal = focals.length % 2 === 1 ? focals[middle]! : (focals[middle - 1]! + focals[middle]!) / 2;
  let maxFocalDeviationPercent = 0;
  let maxFocalDeviationImage = 1;
  cameras.forEach((camera, index) => {
    const deviation = 100 * Math.abs(camera.focal / medianFocal - 1);
    if (deviation > maxFocalDeviationPercent) {
      maxFocalDeviationPercent = deviation;
      maxFocalDeviationImage = index + 1;
    }
  });
  const metrics: PanoramaGeometryMetrics = {
    minPrimaryMovePercent, maxCrossMovePercent, maxAdjacentRollDegrees, maxRollPair,
    medianFocal, maxFocalDeviationPercent, maxFocalDeviationImage,
  };
  const directionCheck = checkOrderedPanoramaDirection(direction, ordered);
  if (!directionCheck.accepted) return { accepted: false, reason: directionCheck.reason, metrics };
  if (maxAdjacentRollDegrees > PANORAMA_MAX_ADJACENT_ROLL_DEGREES + 1e-4) {
    const pair = maxRollPair!;
    return {
      accepted: false,
      reason: `images ${pair[0]} and ${pair[1]} have ${maxAdjacentRollDegrees.toFixed(1)}° relative roll (maximum ±${PANORAMA_MAX_ADJACENT_ROLL_DEGREES}°)`,
      metrics,
    };
  }
  if (maxFocalDeviationPercent > PANORAMA_MAX_FOCAL_DEVIATION_FRACTION * 100 + 1e-9) {
    return {
      accepted: false,
      reason: `image ${maxFocalDeviationImage} focal length differs ${maxFocalDeviationPercent.toFixed(1)}% from the camera median (maximum ±${PANORAMA_MAX_FOCAL_DEVIATION_FRACTION * 100}%)`,
      metrics,
    };
  }
  return { accepted: true, reason: null, metrics };
}

type Vector3 = readonly [number, number, number];
function cross3(a: Vector3, b: Vector3): Vector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalized3(a: Vector3, label: string): Vector3 {
  const magnitude = Math.hypot(a[0], a[1], a[2]);
  if (!(magnitude > 1e-8) || !Number.isFinite(magnitude)) {
    throw new Error(`Panorama ${label} is degenerate.`);
  }
  return [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude];
}
function cameraForwardAndUp(rotation: ArrayLike<number>): { forward: Vector3; up: Vector3 } {
  assertRotation(rotation, "Panorama roll-check rotation");
  const forward = normalized3([Number(rotation[2]), Number(rotation[5]), Number(rotation[8])], "camera optical axis");
  const upRaw: Vector3 = [Number(rotation[1]), Number(rotation[4]), Number(rotation[7])];
  const parallel = dot3(upRaw, forward);
  const up = normalized3([
    upRaw[0] - forward[0] * parallel,
    upRaw[1] - forward[1] * parallel,
    upRaw[2] - forward[2] * parallel,
  ], "camera image-up axis");
  return { forward, up };
}

/** Absolute twist in degrees after parallel-transporting camera up vectors. */
export function relativePanoramaRollDegrees(firstRotation: ArrayLike<number>, secondRotation: ArrayLike<number>): number {
  const first = cameraForwardAndUp(firstRotation);
  const second = cameraForwardAndUp(secondRotation);
  const rawAxis = cross3(first.forward, second.forward);
  const sinAngle = Math.hypot(...rawAxis);
  const cosine = Math.max(-1, Math.min(1, dot3(first.forward, second.forward)));
  if (sinAngle < 1e-8 && cosine < 0) {
    throw new Error("Panorama adjacent camera axes are antipodal; relative roll is undefined.");
  }
  let transported = first.up;
  if (sinAngle >= 1e-8) {
    const axis = normalized3(rawAxis, "camera rotation axis");
    // Rodrigues' formula: rotate first image-up by the shortest optical-axis arc.
    const cross = cross3(axis, first.up);
    const alongAxis = dot3(axis, first.up) * (1 - cosine);
    transported = [
      first.up[0] * cosine + cross[0] * sinAngle + axis[0] * alongAxis,
      first.up[1] * cosine + cross[1] * sinAngle + axis[1] * alongAxis,
      first.up[2] * cosine + cross[2] * sinAngle + axis[2] * alongAxis,
    ];
  }
  const signedSin = dot3(second.forward, cross3(transported, second.up));
  return Math.abs(Math.atan2(signedSin, dot3(transported, second.up))) * 180 / Math.PI;
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
    || ((direction === "auto" || direction === "spherical") && panoramaCameraPathAxis(estimatedRotations) === "vertical");
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
