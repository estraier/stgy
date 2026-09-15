import {
  RAW_DEVELOPED_LINEAR_RANGE_MAX,
  RAW_DEVELOPED_ROLLOFF_A,
  analyzeRawDenoiseMask,
} from "./raw-development-core";

function makeUniformLinearRgb16(width: number, height: number, value: number): Uint16Array {
  const data = new Uint16Array(width * height * 3);
  data.fill(value);
  return data;
}

describe("RAW developed buffer range", () => {
  test("uses [0,4] with A=2 for RAW development", () => {
    expect(RAW_DEVELOPED_LINEAR_RANGE_MAX).toBe(4);
    expect(RAW_DEVELOPED_ROLLOFF_A).toBe(2);
  });
});

describe("RAW denoise ISO weight scaling", () => {
  test("keeps ISO 400 neutral and bends the final blend weight by ISO stops", () => {
    const width = 8;
    const height = 8;
    const data = makeUniformLinearRgb16(width, height, 8192);
    const analyze = (iso?: number | null) => analyzeRawDenoiseMask(
      data,
      width,
      height,
      RAW_DEVELOPED_LINEAR_RANGE_MAX,
      "linear",
      iso,
    );

    const iso200 = analyze(200);
    const iso400 = analyze(400);
    const iso800 = analyze(800);
    const unknown = analyze(null);

    expect(iso400.weightMean).toBeCloseTo(0.3125, 6);
    expect(unknown.weightMean).toBeCloseTo(iso400.weightMean, 6);
    expect(iso200.weightMean).toBeLessThan(iso400.weightMean);
    expect(iso800.weightMean).toBeGreaterThan(iso400.weightMean);
  });
});
