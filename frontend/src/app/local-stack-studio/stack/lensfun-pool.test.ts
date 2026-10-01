import { lensfunCorrectionToRawMaps, resolveLensfunWorkerCount } from "./lensfun-pool";

describe("LensFun worker pool", () => {
  test("caps row workers at four and available output rows", () => {
    expect(resolveLensfunWorkerCount(100, 16)).toBe(4);
    expect(resolveLensfunWorkerCount(100, 2)).toBe(2);
    expect(resolveLensfunWorkerCount(2, 16)).toBe(2);
    expect(resolveLensfunWorkerCount(1, 16)).toBe(1);
  });

  test("maps the shared LensFun correction without changing its numeric arrays", () => {
    const geometry = new Float32Array([0, 0, 1, 1]);
    const tca = new Float32Array([1, 0, 0, 1]);
    const vignetting = new Float32Array([1, 0.9, 0.8]);
    const correction = {
      gridWidth: 2,
      gridHeight: 2,
      step: 32,
      geometry,
      distortion: true,
      autoCrop: { top: 1, bottom: 2, left: 3, right: 4 },
      tca,
      vignetting,
      vignettingBaked: true,
      cameraMaker: "Example",
      cameraModel: "Camera",
      lensMaker: "Example",
      lensModel: "Lens",
      focal: 35,
      cropFactor: 1,
    };
    const maps = lensfunCorrectionToRawMaps(correction);
    expect(maps).toEqual(expect.objectContaining({
      gridWidth: 2,
      gridHeight: 2,
      step: 32,
      geometry,
      distortion: true,
      crop: { top: 1, bottom: 2, left: 3, right: 4 },
      tca,
      vignetting,
      vignettingBaked: true,
    }));
  });
});
