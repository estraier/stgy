import {
  __lensfunCorrectionCharacterization,
  lensfunSourceCoordinatesInto,
  type LensfunCorrection,
} from "./lensfunCorrection";

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
