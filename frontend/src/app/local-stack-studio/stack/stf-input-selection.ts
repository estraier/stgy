/**
 * Select one real STF input per exact EXIF F-number, in the original file
 * selection order. This runs after metadata extraction but before creating
 * canonical images or alignment data. Other merge modes never use it.
 */
export type StfSkippedApertureInput = {
  index: number;
  firstIndex: number;
  fNumber: number;
};

export function selectStfUniqueApertures(
  fNumbers: readonly (number | null | undefined)[],
): { keptIndexes: number[]; skipped: StfSkippedApertureInput[] } {
  const firstByFNumber = new Map<number, number>();
  const keptIndexes: number[] = [];
  const skipped: StfSkippedApertureInput[] = [];
  for (let index = 0; index < fNumbers.length; index += 1) {
    const fNumber = fNumbers[index];
    if (typeof fNumber !== "number" || !Number.isFinite(fNumber) || fNumber <= 0) {
      throw new Error(`STF requires a valid EXIF F-number for input ${index + 1}.`);
    }
    const firstIndex = firstByFNumber.get(fNumber);
    if (firstIndex !== undefined) {
      skipped.push({ index, firstIndex, fNumber });
    } else {
      firstByFNumber.set(fNumber, index);
      keptIndexes.push(index);
    }
  }
  return { keptIndexes, skipped };
}
