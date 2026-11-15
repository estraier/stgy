import { selectUniqueStfInputs } from "./stf-input-selection";
import { buildStfApertureWeights } from "./stf-weights";

describe("STF real input selection", () => {
  test("keeps the first selected image, even if natural filename order differs", () => {
    const files = ["z-portrait.tif", "a-portrait.tif", "b-portrait.tif", "c.tif"];
    const infos = [{ fNumber: 2, marker: "first" }, { fNumber: 2, marker: "second" },
      { fNumber: 2.8, marker: "third" }, { fNumber: 4, marker: "fourth" }];
    const result = selectUniqueStfInputs(files, infos);
    expect(result.files).toEqual(["z-portrait.tif", "b-portrait.tif", "c.tif"]);
    expect(result.inputInfos).toEqual([infos[0], infos[2], infos[3]]);
    expect(result.skipped).toEqual([{ index: 1, firstIndex: 0, fNumber: 2 }]);
    // Sorting after filtering must retain the metadata-to-file index mapping.
    const pairings = result.files.map((file, i) => ({ file, info: result.inputInfos[i] }));
    pairings.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true, sensitivity: "base" }));
    expect(pairings.map((pair) => pair.info.marker)).toEqual(["third", "fourth", "first"]);
  });

  test("uses exact numeric EXIF values; same number in a different string form is equivalent", () => {
    const files = ["a", "b", "c", "d"];
    const infos = [2, 2.0, 2 + 2 * Number.EPSILON, 4].map((fNumber) => ({ fNumber }));
    const result = selectUniqueStfInputs(files, infos);
    expect(result.files).toEqual(["a", "c", "d"]);
    expect(result.skipped).toHaveLength(1);
  });

  test.each([null, undefined, 0, -1, NaN, Infinity, -Infinity])(
    "rejects missing or invalid F-number %s before canonical/alignment", (invalid) => {
      expect(() => selectUniqueStfInputs(["a", "b"], [{ fNumber: 2 }, { fNumber: invalid }])).toThrow(
        "STF input 2 has no valid EXIF F-number.",
      );
    },
  );

  test.each([null, undefined, 0, -1, NaN, Infinity, -Infinity])(
    "off preserves missing F-number %s for uniform blending", (missing) => {
      const files = ["first", "missing", "duplicate", "second-missing", "last"];
      const infos = [
        { fNumber: 2 }, { fNumber: missing }, { fNumber: 2 },
        { fNumber: null }, { fNumber: 4 },
      ];
      const selected = selectUniqueStfInputs(files, infos, { allowMissingFNumbers: true });
      expect(selected.files).toEqual(["first", "missing", "second-missing", "last"]);
      expect(selected.inputInfos).toEqual([infos[0], infos[1], infos[3], infos[4]]);
      expect(selected.skipped).toEqual([{ index: 2, firstIndex: 0, fNumber: 2 }]);
    },
  );

  test("rejects misaligned metadata arrays", () => {
    expect(() => selectUniqueStfInputs(["a", "b"], [{ fNumber: 2 }])).toThrow(/counts do not match/);
  });

  test("real weights remain normalized and map to selected input order", () => {
    const files = ["z", "b", "a", "x", "c"];
    const infos = [4, 2.8, 2, 2.8, 5.6].map((fNumber) => ({ fNumber }));
    const result = selectUniqueStfInputs(files, infos);
    const selectedF = result.inputInfos.map((x) => x.fNumber);
    const weights = buildStfApertureWeights(selectedF, 1);
    const sortedWeights = buildStfApertureWeights([2, 2.8, 4, 5.6], 1);
    expect(weights).not.toBeNull();
    expect(sortedWeights).not.toBeNull();
    if (!weights || !sortedWeights) return;
    expect(Array.from(weights)).toEqual([
      sortedWeights[2], sortedWeights[1], sortedWeights[0], sortedWeights[3],
    ]);
    expect(Array.from(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  test("all-duplicate multi-selection becomes one real input", () => {
    const result = selectUniqueStfInputs(["a", "b"], [{ fNumber: 2 }, { fNumber: 2 }]);
    expect(result.files).toEqual(["a"]);
    expect(result.inputInfos).toHaveLength(1);
  });
});
