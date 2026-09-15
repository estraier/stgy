import { analyzeRawDenoiseMask } from "./raw-development-core";

function makeUniformLinearRgb16(width: number, height: number, value: number): Uint16Array {
  const data = new Uint16Array(width * height * 3);
  data.fill(value);
  return data;
}

describe("RAW denoise ISO weight scaling", () => {
  test("keeps ISO 400 neutral and bends the final blend weight by ISO stops", () => {
    const width = 8;
    const height = 8;
    const data = makeUniformLinearRgb16(width, height, 16384);
    const analyze = (iso?: number | null) => analyzeRawDenoiseMask(
      data,
      width,
      height,
      2,
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
