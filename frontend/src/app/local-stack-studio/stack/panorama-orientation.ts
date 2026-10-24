export type PanoramaCameraPathAxis = "horizontal" | "vertical";

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
 * so the panorama remains upright rather than becoming upside-down.
 */
export function restoreVerticalWaveCorrectionRoll(
  estimatedRotations: readonly RotationLike[],
  correctedRotations: readonly RotationLike[],
): Float32Array[] {
  if (estimatedRotations.length !== correctedRotations.length) {
    throw new Error("Panorama camera counts differ before and after wave correction.");
  }
  if (estimatedRotations.length <= 1 || panoramaCameraPathAxis(estimatedRotations) !== "vertical") {
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
