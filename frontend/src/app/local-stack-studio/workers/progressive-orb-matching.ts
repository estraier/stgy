/** Spatially constrained ORB matching. Coordinates are in the same image plane. */
export type OrbLocation = { x: number; y: number };
export type OrbSpatialMatch = { referenceIndex: number; targetIndex: number; distance: number };

const POPCOUNT = Uint8Array.from({ length: 256 }, (_, value) => {
  let count = 0;
  for (let v = value; v !== 0; v &= v - 1) count += 1;
  return count;
});

export function scaleOrbAffine(
  matrix: ArrayLike<number>,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): Float64Array {
  if (!(fromWidth > 0 && fromHeight > 0 && toWidth > 0 && toHeight > 0)) {
    throw new Error("Invalid ORB alignment dimensions.");
  }
  const sx = toWidth / fromWidth;
  const sy = toHeight / fromHeight;
  return new Float64Array([
    matrix[0], matrix[1] * sx / sy, matrix[2] * sx,
    matrix[3] * sy / sx, matrix[4], matrix[5] * sy,
    0, 0, 1,
  ]);
}

export function orbCornerCorrection(
  initial: ArrayLike<number>, candidate: ArrayLike<number>, width: number, height: number,
): number {
  let maximum = 0;
  for (const x of [0, width]) {
    for (const y of [0, height]) {
      maximum = Math.max(maximum, Math.hypot(
        (candidate[0] - initial[0]) * x + (candidate[1] - initial[1]) * y + candidate[2] - initial[2],
        (candidate[3] - initial[3]) * x + (candidate[4] - initial[4]) * y + candidate[5] - initial[5],
      ));
    }
  }
  return maximum;
}

/**
 * Search the location-filtered candidates *before* calculating descriptor distance.
 * For the initial pass maxDx/maxDy bound translation from identity; for the
 * refinement pass a small circular radius bounds deviation from the prediction.
 * No all-pairs descriptor matching or silent unbounded search is performed here.
 */
export function matchSpatialOrbDescriptors({
  referencePoints, targetPoints, referenceDescriptors, targetDescriptors,
  descriptorBytes, prediction, maxDx, maxDy, circular = false, maxDistance = 100,
}: {
  referencePoints: OrbLocation[];
  targetPoints: OrbLocation[];
  referenceDescriptors: Uint8Array;
  targetDescriptors: Uint8Array;
  descriptorBytes: number;
  prediction: ArrayLike<number>;
  maxDx: number;
  maxDy: number;
  circular?: boolean;
  maxDistance?: number;
}): OrbSpatialMatch[] {
  if (!(descriptorBytes > 0 && maxDx > 0 && maxDy > 0) ||
      referenceDescriptors.length < referencePoints.length * descriptorBytes ||
      targetDescriptors.length < targetPoints.length * descriptorBytes) {
    throw new Error("Invalid progressive ORB descriptor array or search radius.");
  }
  const cell = Math.max(1, Math.min(maxDx, maxDy));
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (let index = 0; index < referencePoints.length; index += 1) {
    const point = referencePoints[index];
    const cellX = Math.floor(point.x / cell);
    const cellY = Math.floor(point.y / cell);
    const bucketKey = key(cellX, cellY);
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(index);
    else buckets.set(bucketKey, [index]);
  }

  // First find each target point's best candidate. Then retain only the best
  // target for each reference point, making the correspondences one-to-one.
  const bestForReference = new Map<number, OrbSpatialMatch>();
  for (let targetIndex = 0; targetIndex < targetPoints.length; targetIndex += 1) {
    const pt = targetPoints[targetIndex];
    const px = prediction[0] * pt.x + prediction[1] * pt.y + prediction[2];
    const py = prediction[3] * pt.x + prediction[4] * pt.y + prediction[5];
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const minX = Math.floor((px - maxDx) / cell);
    const maxX = Math.floor((px + maxDx) / cell);
    const minY = Math.floor((py - maxDy) / cell);
    const maxY = Math.floor((py + maxDy) / cell);
    let bestIndex = -1;
    let bestDistance = maxDistance + 1;
    for (let cy = minY; cy <= maxY; cy += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const bucket = buckets.get(key(cx, cy));
        if (!bucket) continue;
        for (const referenceIndex of bucket) {
          const ref = referencePoints[referenceIndex];
          const dx = ref.x - px;
          const dy = ref.y - py;
          if (Math.abs(dx) > maxDx || Math.abs(dy) > maxDy ||
              (circular && dx * dx + dy * dy > maxDx * maxDx)) continue;
          let distance = 0;
          const ro = referenceIndex * descriptorBytes;
          const to = targetIndex * descriptorBytes;
          for (let byte = 0; byte < descriptorBytes; byte += 1) {
            distance += POPCOUNT[referenceDescriptors[ro + byte] ^ targetDescriptors[to + byte]];
            if (distance >= bestDistance) break;
          }
          if (distance < bestDistance) {
            bestIndex = referenceIndex;
            bestDistance = distance;
          }
        }
      }
    }
    if (bestIndex < 0 || bestDistance > maxDistance) continue;
    const current = bestForReference.get(bestIndex);
    if (!current || bestDistance < current.distance) {
      bestForReference.set(bestIndex, { referenceIndex: bestIndex, targetIndex, distance: bestDistance });
    }
  }
  return [...bestForReference.values()].sort((a, b) => a.distance - b.distance);
}

/** Estimate a 4-DOF similarity on already ECC-warped target coordinates.
 * This preserves the 6-DOF affine shear/anisotropic scale after composition. */
export function orbResidualCandidates<T extends {
  targetX: number; targetY: number; referenceX: number; referenceY: number; distance: number;
}>(initial: ArrayLike<number>, candidates: T[]): T[] {
  return candidates.map((candidate) => ({
    ...candidate,
    targetX: initial[0] * candidate.targetX + initial[1] * candidate.targetY + initial[2],
    targetY: initial[3] * candidate.targetX + initial[4] * candidate.targetY + initial[5],
  }));
}

/** T = S * A, in target->reference coordinates. Both are 3x3 affine matrices. */
export function composeOrbResidual(initial: ArrayLike<number>, residual: ArrayLike<number>): Float64Array {
  const result = new Float64Array([
    residual[0] * initial[0] + residual[1] * initial[3],
    residual[0] * initial[1] + residual[1] * initial[4],
    residual[0] * initial[2] + residual[1] * initial[5] + residual[2],
    residual[3] * initial[0] + residual[4] * initial[3],
    residual[3] * initial[1] + residual[4] * initial[4],
    residual[3] * initial[2] + residual[4] * initial[5] + residual[5],
    0, 0, 1,
  ]);
  if (!Array.from(result).every(Number.isFinite)) {
    throw new Error("ORB residual composition produced a non-finite transform.");
  }
  return result;
}
