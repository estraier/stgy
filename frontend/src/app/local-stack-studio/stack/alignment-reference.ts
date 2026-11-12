/**
 * Selects the initial alignment reference before calling the generic ORB/ECC
 * matchers. Input order is unchanged so image indices keep matching canonical
 * buffers, blend weights, tone plans, and caches.
 */
export type AlignmentReferenceInput = {
  fNumber?: number | null;
  exposureTime?: number | null;
  iso?: number | null;
};

function computeExifLightValue(inputInfo: AlignmentReferenceInput): number | null {
  const exposureTime = Number(inputInfo?.exposureTime);
  const fNumber = Number(inputInfo?.fNumber);
  const iso = Number(inputInfo?.iso);
  if (!(exposureTime > 0 && fNumber > 0 && iso > 0)) return null;
  const lightValue = Math.log2((fNumber * fNumber) / exposureTime) - Math.log2(iso / 100);
  return Number.isFinite(lightValue) ? lightValue : null;
}

export function chooseAlignmentReferenceIndex(
  inputInfos: readonly AlignmentReferenceInput[],
  mergeMode: string,
): number {
  const count = inputInfos.length;
  if (count <= 1) return 0;

  if (mergeMode === "focus") {
    return Math.floor(count / 2);
  }

  if (mergeMode === "stf") {
    // Prefer the widest aperture (lowest valid F-number). Keep original
    // ordering when the EXIF data cannot identify any aperture.
    let bestIndex = 0;
    let smallestFNumber = Infinity;
    for (let index = 0; index < count; index += 1) {
      const fNumber = Number(inputInfos[index]?.fNumber);
      if (Number.isFinite(fNumber) && fNumber > 0 && fNumber < smallestFNumber) {
        smallestFNumber = fNumber;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  const lightValues = inputInfos.map(computeExifLightValue);
  if (!lightValues.every((value): value is number => value !== null && Number.isFinite(value))) return 0;

  const minLightValue = Math.min(...lightValues);
  const maxLightValue = Math.max(...lightValues);
  if (maxLightValue - minLightValue < 1) return 0;

  const centerLightValue = (minLightValue + maxLightValue) / 2;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < lightValues.length; index += 1) {
    const distance = Math.abs(lightValues[index] - centerLightValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}
