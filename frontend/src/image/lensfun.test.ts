import {
  __lensfunCorrectionCharacterization,
  lensfunAutoCropInsets,
  lensfunSourceCoordinatesInto,
  type LensfunCorrection,
} from "./lensfun";

function correctionBase(overrides: Partial<LensfunCorrection> = {}): LensfunCorrection {
  return {
    gridWidth: 2,
    gridHeight: 2,
    step: 10,
    geometry: new Float32Array([
      0, 0,
      10, 0,
      0, 10,
      10, 10,
    ]),
    distortion: true,
    cameraMaker: "Test",
    cameraModel: "Camera",
    lensMaker: "Test",
    lensModel: "Lens",
    focal: 50,
    cropFactor: 1,
    ...overrides,
  };
}

describe("Lensfun combined source-coordinate map", () => {
  test("composes geometry first and TCA second at correction-grid points", () => {
    const geometry = new Float32Array([
      1, 2,
      9, 2,
      1, 8,
      9, 8,
    ]);
    // Linear TCA map: red x-1, green x, blue x+1; y unchanged.
    const tca = new Float32Array([
      -1, 0, 0, 0, 1, 0,
      9, 0, 10, 0, 11, 0,
      -1, 10, 0, 10, 1, 10,
      9, 10, 10, 10, 11, 10,
    ]);
    const combined = __lensfunCorrectionCharacterization.buildCombinedSourceCoordinateMap({
      gridWidth: 2,
      gridHeight: 2,
      step: 10,
      geometry,
      tca,
    });
    expect(combined).toBeDefined();
    expect(Array.from(combined ?? [], (value) => Number(value.toFixed(6)))).toEqual([
      0, 2, 1, 2, 2, 2,
      8, 2, 9, 2, 10, 2,
      0, 8, 1, 8, 2, 8,
      8, 8, 9, 8, 10, 8,
    ]);
  });

  test("prefers the precomposed RGB map in the pixel lookup path", () => {
    const combined = new Float32Array([
      0, 0, 1, 0, 2, 0,
      10, 0, 11, 0, 12, 0,
      0, 10, 1, 10, 2, 10,
      10, 10, 11, 10, 12, 10,
    ]);
    const correction = correctionBase({
      combined,
      // Deliberately incompatible fallback maps. If the old two-stage path is
      // used, the assertion below will fail.
      geometry: new Float32Array([100, 100, 100, 100, 100, 100, 100, 100]),
      tca: new Float32Array(24).fill(200),
    });
    const output: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
    lensfunSourceCoordinatesInto(correction, 5, 5, output);
    expect(output).toEqual([5, 5, 6, 5, 7, 5]);
  });
});


describe("Lensfun auto crop", () => {
  test("finds a centered safe rectangle when distortion exposes borders", () => {
    const width = 101;
    const height = 101;
    const center = 50;
    const expansion = 1.1;
    const map = new Float32Array(3 * 3 * 2);
    let index = 0;
    for (let gy = 0; gy < 3; gy++) {
      const y = gy * 50;
      for (let gx = 0; gx < 3; gx++) {
        const x = gx * 50;
        map[index++] = center + (x - center) * expansion;
        map[index++] = center + (y - center) * expansion;
      }
    }
    const correction = correctionBase({
      gridWidth: 3,
      gridHeight: 3,
      step: 50,
      geometry: map,
    });
    const crop = lensfunAutoCropInsets(correction, width, height);
    expect(crop).toBeDefined();
    expect(crop!.left).toBeGreaterThan(0.04);
    expect(crop!.left).toBeLessThan(0.06);
    expect(crop!.right).toBeCloseTo(crop!.left, 8);
    expect(crop!.top).toBeCloseTo(crop!.left, 8);
    expect(crop!.bottom).toBeCloseTo(crop!.left, 8);
  });

  test("does not crop when the full corrected frame is valid", () => {
    const crop = lensfunAutoCropInsets(correctionBase(), 11, 11);
    expect(crop).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
});
