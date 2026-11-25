import { chooseAlignmentReferenceIndex } from "./alignment-reference";

describe("alignment reference selection", () => {
  const exposures = [
    { fNumber: 8, exposureTime: 1 / 100, iso: 100 },
    { fNumber: 2, exposureTime: 1 / 1600, iso: 100 },
    { fNumber: 4, exposureTime: 1 / 400, iso: 100 },
  ];

  test("STF picks the smallest F-number rather than the first image or exposure midpoint", () => {
    expect(chooseAlignmentReferenceIndex(exposures, "stf")).toBe(1);
    expect(chooseAlignmentReferenceIndex([...exposures].reverse(), "stf")).toBe(1);
  });

  test("STF ignores missing or invalid aperture metadata", () => {
    expect(chooseAlignmentReferenceIndex([
      { fNumber: null }, { fNumber: Number.NaN }, { fNumber: 5.6 }, { fNumber: 2.8 },
    ], "stf")).toBe(3);
    expect(chooseAlignmentReferenceIndex([
      { fNumber: 0 }, { fNumber: -1 }, { fNumber: Infinity }, { fNumber: undefined },
    ], "stf")).toBe(0);
  });

  test("STF keeps the first occurrence when apertures are tied", () => {
    expect(chooseAlignmentReferenceIndex([
      { fNumber: 8 }, { fNumber: 2 }, { fNumber: 2 },
    ], "stf")).toBe(1);
  });

  test("single input and empty input both use index zero", () => {
    expect(chooseAlignmentReferenceIndex([], "stf")).toBe(0);
    expect(chooseAlignmentReferenceIndex([{ fNumber: 2 }], "stf")).toBe(0);
  });

  test("unified ECC with STF selects the geometric F-number midpoint, independently of file order", () => {
    const ordered = [2, 2.52, 3.17, 4, 5.04, 6.35, 8].map((fNumber) => ({ fNumber }));
    expect(chooseAlignmentReferenceIndex(ordered, "stf", "feature-match-ecc")).toBe(3);
    expect(chooseAlignmentReferenceIndex([...ordered].reverse(), "stf", "feature-match-ecc")).toBe(3);
    expect(chooseAlignmentReferenceIndex([
      { fNumber: 8 }, { fNumber: 2 }, { fNumber: 4 }, { fNumber: 5.6 },
    ], "stf", "feature-match-ecc")).toBe(2);
  });

  test("unified ECC keeps the STF geometric reference", () => {
    const frames = [
      { fNumber: 8 }, { fNumber: 2 }, { fNumber: 4 }, { fNumber: 5.6 },
    ];
    expect(chooseAlignmentReferenceIndex(frames, "stf", "feature-match-ecc")).toBe(2);
    expect(chooseAlignmentReferenceIndex(frames, "hdr1", "feature-match-ecc")).toBe(0);
  });

  test("ECC chooses geometric aperture midpoint rather than the median input position", () => {
    expect(chooseAlignmentReferenceIndex([
      { fNumber: 2 }, { fNumber: 2.1 }, { fNumber: 2.2 },
      { fNumber: 3.9 }, { fNumber: 8 },
    ], "stf", "feature-match-ecc")).toBe(3);
  });

  test("unified ECC ties at the geometric midpoint retain the first candidate", () => {
    expect(chooseAlignmentReferenceIndex([
      { fNumber: 2 }, { fNumber: 8 },
    ], "stf", "feature-match-ecc")).toBe(0);
    expect(chooseAlignmentReferenceIndex([
      { fNumber: 8 }, { fNumber: 2 },
    ], "stf", "feature-match-ecc")).toBe(0);
  });

  test("ORB keeps the prior STF reference choice", () => {
    expect(chooseAlignmentReferenceIndex(exposures, "stf", "feature-match-orb")).toBe(1);
  });

  test("unified STF ECC ignores invalid F-values and falls back to the first input when none are valid", () => {
    expect(chooseAlignmentReferenceIndex([
      { fNumber: 0 }, { fNumber: 2 }, { fNumber: 4 }, { fNumber: 8 },
    ], "stf", "feature-match-ecc")).toBe(2);
    expect(chooseAlignmentReferenceIndex([
      { fNumber: null }, { fNumber: Number.NaN }, { fNumber: -1 },
    ], "stf", "feature-match-ecc")).toBe(0);
  });

  test("non-STF alignment modes retain their reference policies regardless of algorithm", () => {
    expect(chooseAlignmentReferenceIndex(exposures, "focus", "feature-match-ecc")).toBe(1);
    const bracketed = [
      { fNumber: 4, exposureTime: 1 / 100, iso: 100 },
      { fNumber: 4, exposureTime: 1 / 400, iso: 100 },
      { fNumber: 4, exposureTime: 1 / 1600, iso: 100 },
    ];
    expect(chooseAlignmentReferenceIndex(bracketed, "hdr1", "feature-match-ecc")).toBe(1);
  });

  test("Focus still uses the middle image", () => {
    expect(chooseAlignmentReferenceIndex(exposures, "focus")).toBe(1);
    expect(chooseAlignmentReferenceIndex([...exposures, { fNumber: 11 }], "focus")).toBe(2);
  });

  test("other modes retain the exposure-midpoint selection and first-image fallbacks", () => {
    const bracketed = [
      { fNumber: 4, exposureTime: 1 / 100, iso: 100 }, // LV 8.64
      { fNumber: 4, exposureTime: 1 / 400, iso: 100 }, // LV 10.64 (midpoint)
      { fNumber: 4, exposureTime: 1 / 1600, iso: 100 }, // LV 12.64
    ];
    expect(chooseAlignmentReferenceIndex(bracketed, "hdr1")).toBe(1);
    expect(chooseAlignmentReferenceIndex(bracketed, "hdr2")).toBe(1);
    expect(chooseAlignmentReferenceIndex(bracketed, "median")).toBe(1);
    expect(chooseAlignmentReferenceIndex(exposures, "hdr1")).toBe(0); // equal effective exposures
    expect(chooseAlignmentReferenceIndex([{ fNumber: 2 }, { fNumber: 4 }], "hdr1")).toBe(0);
  });
});
