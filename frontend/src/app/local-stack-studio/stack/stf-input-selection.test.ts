import { selectStfUniqueApertures } from "./stf-input-selection";
import { buildStfApertureWeights } from "./stf-weights";
import { buildStfFrameSet } from "./stf-frame-generation";

describe("STF unique EXIF aperture selection", () => {
  test("keeps first selection per F-number, even when input order is unsorted", () => {
    const inputFNumbers = [2.8, 4, 2, 2.8, 3.5, 4, 2.8];
    const selection = selectStfUniqueApertures(inputFNumbers);
    expect(selection.keptIndexes).toEqual([0, 1, 2, 4]);
    expect(selection.skipped).toEqual([
      { index: 3, firstIndex: 0, fNumber: 2.8 },
      { index: 5, firstIndex: 1, fNumber: 4 },
      { index: 6, firstIndex: 0, fNumber: 2.8 },
    ]);
    const keptFNumbers = selection.keptIndexes.map((index) => inputFNumbers[index]);
    const directWeights = buildStfApertureWeights([2, 2.8, 3.5, 4], 4)!;
    const selectionWeights = buildStfApertureWeights(keptFNumbers, 4)!;
    // Real-frame weights retain the input order, not the aperture sort order.
    expect(selectionWeights[0]).toBeCloseTo(directWeights[1], 12);
    expect(selectionWeights[1]).toBeCloseTo(directWeights[3], 12);
    expect(selectionWeights[2]).toBeCloseTo(directWeights[0], 12);
    expect(selectionWeights[3]).toBeCloseTo(directWeights[2], 12);
    expect(Array.from(selectionWeights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
  });

  test("off, interpolation and extrapolation all use the same filtered real inputs", () => {
    const raw = [4, 2.8, 2.8, 2, 4];
    const selection = selectStfUniqueApertures(raw);
    const kept = selection.keptIndexes.map((index) => raw[index]);
    expect(kept).toEqual([4, 2.8, 2]);
    const off = buildStfFrameSet(kept, 4, "off");
    const mid = buildStfFrameSet(kept, 4, "interpolation");
    const outer = buildStfFrameSet(kept, 4, "interpolation-extrapolation");
    expect(off.realWeights).toHaveLength(3);
    expect(off.middleFrames).toHaveLength(0);
    expect(mid.middleFrames).toHaveLength(2);
    expect(mid.allWeights).toHaveLength(5);
    expect(outer.middleFrames).toHaveLength(2);
    expect(outer.outerFrames).toHaveLength(2);
    expect(outer.allWeights).toHaveLength(7);
  });

  test("all identical F-numbers leave one real image for off mode", () => {
    const selection = selectStfUniqueApertures([2.8, 2.8, 2.8]);
    expect(selection.keptIndexes).toEqual([0]);
    expect(buildStfApertureWeights([2.8])).toEqual(new Float64Array([1]));
    expect(buildStfFrameSet([2.8], 4, "off").allWeights).toEqual(new Float32Array([1]));
    expect(() => buildStfFrameSet([2.8], 4, "interpolation")).toThrow("at least two");
  });

  test("rejects missing/invalid F-numbers rather than silently using equal weights", () => {
    for (const fNumbers of [
      [2, null], [2, undefined], [2, 0], [2, -1], [2, Number.NaN], [2, Infinity],
    ]) {
      expect(() => selectStfUniqueApertures(fNumbers)).toThrow("valid EXIF F-number for input 2");
    }
    expect(() => buildStfFrameSet([2, 2.8, 2.8], 4, "off")).toThrow("aperture weights");
    expect(() => buildStfFrameSet([2, null], 4, "off")).toThrow("aperture weights");
  });

  test("uses exact numeric F equality, not a fuzzy aperture-step comparison", () => {
    expect(selectStfUniqueApertures([2.8, 2.8 + 1e-6, 2.8]).keptIndexes).toEqual([0, 1]);
  });
});
