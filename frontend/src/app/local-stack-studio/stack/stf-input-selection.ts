/** A single EXIF aperture maps to a single selected real STF source. */
export type StfFNumberInfo = { fNumber?: number | null };

export type SkippedStfDuplicate = { index: number; firstIndex: number; fNumber: number };

/**
 * Filter only the STF real-image input list. The source order must be the
 * browser's selection order, not a filename/natural sort. The caller may sort
 * the filtered result for processing, but may not reselect the representative.
 * No approximate F-number comparison: two numeric EXIF values are duplicates
 * only when exactly equal. Missing EXIF is accepted only for real-only STF
 * (Frame generation = off), preserving the historical equal-weight fallback.
 */
export function selectUniqueStfInputs<TFile, TInfo extends StfFNumberInfo>(
  files: readonly TFile[],
  inputInfos: readonly TInfo[],
  options: { allowMissingFNumbers?: boolean } = {},
): { files: TFile[]; inputInfos: TInfo[]; skipped: SkippedStfDuplicate[] } {
  if (files.length !== inputInfos.length) {
    throw new Error("STF files and EXIF metadata counts do not match.");
  }
  const seen = new Map<number, number>();
  const filteredFiles: TFile[] = [];
  const filteredInfos: TInfo[] = [];
  const skipped: SkippedStfDuplicate[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const fNumber = inputInfos[index]?.fNumber;
    if (typeof fNumber !== "number" || !Number.isFinite(fNumber) || fNumber <= 0) {
      if (!options.allowMissingFNumbers) {
        throw new Error(`STF input ${index + 1} has no valid EXIF F-number.`);
      }
      // No aperture is known: preserve this input, and do not deduplicate
      // it against other images with missing EXIF. STF off will use equal weights.
      filteredFiles.push(files[index]);
      filteredInfos.push(inputInfos[index]);
      continue;
    }
    const firstIndex = seen.get(fNumber);
    if (firstIndex !== undefined) {
      skipped.push({ index, firstIndex, fNumber });
      continue;
    }
    seen.set(fNumber, index);
    filteredFiles.push(files[index]);
    filteredInfos.push(inputInfos[index]);
  }
  return { files: filteredFiles, inputInfos: filteredInfos, skipped };
}
