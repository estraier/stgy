// Characterization tests import the extracted processing core directly so they do not
// depend on React/Next.js or on the ImageUploadDialog component module.

// Sampling integration is characterized with deterministic Lensfun coordinates here.
// image/lensfun.ts remains responsible for calculating the real
// distortion/TCA/vignetting maps.
jest.mock("@/image/lensfun", () => ({
  buildRawLensfunCorrection: jest.fn(),
  summarizeLensfunCorrection: jest.fn(() => ""),
  lensfunSourceCoordinates: (_correction: unknown, x: number, y: number) => ({
    r: [x - 0.25, y],
    g: [x, y],
    b: [x + 0.25, y],
  }),
  lensfunSourceCoordinatesInto: (
    _correction: unknown,
    x: number,
    y: number,
    output: [number, number, number, number, number, number],
  ) => {
    output[0] = x - 0.25;
    output[1] = y;
    output[2] = x;
    output[3] = y;
    output[4] = x + 0.25;
    output[5] = y;
    return output;
  },
  lensfunVignettingGain: (_correction: unknown, x: number, y: number) => [
    1 + x * 0.01,
    1 + y * 0.01,
    1,
  ],
  lensfunVignettingGainInto: (
    _correction: unknown,
    x: number,
    y: number,
    output: [number, number, number],
  ) => {
    output[0] = 1 + x * 0.01;
    output[1] = 1 + y * 0.01;
    output[2] = 1;
    return output;
  },
}));

import { __imageEditorCharacterization as imageEditor } from "./image-editor/characterization";

function rounded(values: number[]): number[] {
  return values.map((value) => Number(value.toFixed(12)));
}

function fnv1a32(bytes: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function makeDecodedRgb16(
  width: number,
  height: number,
  linearValues: Array<[number, number, number]>,
  linearRangeMax = 2,
  lensCorrection?: unknown,
) {
  const data = new Uint16Array(width * height * 3);
  linearValues.forEach(([r, g, b], pixel) => {
    const i = pixel * 3;
    data[i] = imageEditor.encodeStoredRgb16Channel(r, "gamma20", linearRangeMax);
    data[i + 1] = imageEditor.encodeStoredRgb16Channel(g, "gamma20", linearRangeMax);
    data[i + 2] = imageEditor.encodeStoredRgb16Channel(b, "gamma20", linearRangeMax);
  });
  return {
    colorSpace: "prophoto" as const,
    transfer: "gamma20" as const,
    width,
    height,
    data,
    linearRangeMax,
    ...(lensCorrection ? { lensCorrection } : {}),
    cleanup: () => undefined,
  };
}

function makeSyntheticDecodedRgb16(width = 4, height = 3) {
  const values: Array<[number, number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values.push([
        ((x + 1) / 5) * 0.9 + y * 0.05,
        ((y + 1) / 4) * 0.8 + x * 0.03,
        ((x + y + 1) / 7) * 0.7,
      ]);
    }
  }
  return makeDecodedRgb16(width, height, values, 2);
}

function renderToBytes(
  decoded: ReturnType<typeof makeSyntheticDecodedRgb16>,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  width = 4,
  height = 3,
): Uint8ClampedArray {
  let captured = new Uint8ClampedArray();
  const context = {
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: (imageData: { data: Uint8ClampedArray }) => {
      captured = new Uint8ClampedArray(imageData.data);
    },
  };
  const canvas = {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;

  imageEditor.renderAdjustedRgb16ToCanvas(
    canvas,
    decoded,
    sourceRect,
    rotationDegrees,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    "srgb",
  );
  return captured;
}

function renderCachedPreviewToBytes(
  decoded: ReturnType<typeof makeSyntheticDecodedRgb16>,
  sourceRect: { x: number; y: number; w: number; h: number },
  rotationDegrees: number,
  temperature: number,
  tint: number,
  exposureEv: number,
  shadow: number,
  highlight: number,
  scaledLog: number,
  sigmoid: number,
  vibrance: number,
  saturation: number,
  width = 4,
  height = 3,
): Uint8ClampedArray {
  let captured = new Uint8ClampedArray();
  const context = {
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: (imageData: { data: Uint8ClampedArray }) => {
      captured = new Uint8ClampedArray(imageData.data);
    },
  };
  const canvas = {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const renderedSample = imageEditor.getRenderedLinearRgbSample(
    decoded,
    sourceRect,
    rotationDegrees,
    width,
    height,
  );
  const contextSample = imageEditor.getAnalysisLinearRgbSample(decoded, sourceRect, rotationDegrees);
  imageEditor.renderAdjustedLinearRgbSampleToCanvas(
    canvas,
    renderedSample,
    contextSample,
    temperature,
    tint,
    exposureEv,
    shadow,
    highlight,
    scaledLog,
    sigmoid,
    vibrance,
    saturation,
    "srgb",
  );
  return captured;
}

describe("image editor tone characterization", () => {
  test("freezes the gamma-12 midpoint-zero Shadow curves", () => {
    const points = [0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4];
    expect(rounded(points.map((x) => imageEditor.applyShadowLinear(x, -100)))).toEqual([
      0,
      0.000013811692,
      0.000039508903,
      0.000180986735,
      0.00066298461,
      0.001545339612,
      0.002972067164,
      0.008283236242,
      0.018979390068,
    ]);
    expect(rounded(points.map((x) => imageEditor.applyShadowLinear(x, 100)))).toEqual([
      0,
      0.321268772483,
      0.406849642541,
      0.535389208133,
      0.641118273643,
      0.704948703048,
      0.750640685175,
      0.81505184134,
      0.860410991214,
    ]);
    expect(imageEditor.applyShadowLinear(1.2, -100)).toBe(1.2);
    expect(imageEditor.applyShadowLinear(1.2, 100)).toBe(1.2);
  });

  test("freezes the gamma-0.48 P100-normalized Highlight curves", () => {
    const overWhiteRange = { p100: 1.2 };
    const points = [0.02, 0.1, 0.4, 0.8, 1, 1.2];
    expect(
      rounded(points.map((x) => imageEditor.applyHighlightLinear(x, -100, overWhiteRange))),
    ).toEqual([
      0.007958241286,
      0.039992660814,
      0.175226411521,
      0.490345436836,
      0.790991117902,
      1.2,
    ]);
    expect(
      rounded(points.map((x) => imageEditor.applyHighlightLinear(x, 100, overWhiteRange))),
    ).toEqual([
      0.050209044858,
      0.243062211261,
      0.715986837441,
      1.004882140752,
      1.1053466268,
      1.2,
    ]);
    expect(imageEditor.applyHighlightLinear(1.1, -100, overWhiteRange)).toBeLessThan(1);
    expect(imageEditor.applyHighlightLinear(overWhiteRange.p100, -100, overWhiteRange)).toBe(
      overWhiteRange.p100,
    );
    expect(imageEditor.applyHighlightLinear(overWhiteRange.p100, 100, overWhiteRange)).toBe(
      overWhiteRange.p100,
    );

    const subWhiteRange = { p100: 0.8 };
    expect(imageEditor.applyHighlightLinear(subWhiteRange.p100, 100, subWhiteRange)).toBe(
      subWhiteRange.p100,
    );
    expect(imageEditor.applyHighlightLinear(subWhiteRange.p100, -100, subWhiteRange)).toBe(
      subWhiteRange.p100,
    );
  });

  test("preserves extended-range Tone and luminance-preserving Color behavior", () => {
    const gains = imageEditor.whiteBalanceGains(50, 0);
    expect(Math.max(...imageEditor.applyWhiteBalanceLinear(1.2, 0.8, 0.6, gains))).toBeGreaterThan(1);

    expect(imageEditor.applyScaledLogLinearExtended(1.2, 5)).toBeGreaterThan(1);
    expect(imageEditor.applySigmoidLinearExtended(1.2, 5)).toBeGreaterThan(1);

    const source: [number, number, number] = [0.7, 0.3, 0.1];
    const sourceY = imageEditor.proPhotoLinearLuminance(...source);
    const saturated = imageEditor.applySaturationVibranceAndFinalRolloffLinearRgb(
      ...source,
      50,
      0,
      false,
    );
    expect(imageEditor.proPhotoLinearLuminance(...saturated)).toBeCloseTo(sourceY, 12);

    const rolled = imageEditor.applyFinalMaxChannelRolloffLinearRgb(1.2, 0.6, 0.3);
    expect(rolled[0]).toBeGreaterThan(0.9);
    expect(rolled[0]).toBeLessThan(1);
    expect(rolled[0] / rolled[1]).toBeCloseTo(2, 12);
    expect(rolled[1] / rolled[2]).toBeCloseTo(2, 12);
  });

  test("freezes Logarithm, Sigmoid, rolloff and the combined tone pipeline", () => {
    expect(rounded([0.1, 0.5, 0.9].map((x) => imageEditor.applyScaledLogLinear(x, 1)))).toEqual([
      0.13750352375,
      0.584962500721,
      0.925999418556,
    ]);
    expect(rounded([0.1, 0.5, 0.9].map((x) => imageEditor.applySigmoidLinear(x, 3)))).toEqual([
      0.088078095536,
      0.55293487976,
      0.926053948381,
    ]);

    const rolloff = imageEditor.rolloffParams(2, 0.5, 4);
    expect(rolloff).not.toBeNull();
    expect(rolloff?.inflection).toBeCloseTo(0.75, 12);
    expect(rolloff?.scale).toBeCloseTo(0.19999984000012802, 12);

    const tone = imageEditor.applyToneLinearToRgb(
      0.12,
      0.5,
      1.3,
      { r: 1, g: 1, b: 1 },
      false,
      Math.pow(2, 0.7),
      -35,
      70,
      { p100: 1.45 },
      0.8,
      -1.2,
    );
    expect(rounded(tone)).toEqual([0.257110835394, 1.071295147476, 2.785367383439]);
  });
});

describe("image editor RGB16 characterization", () => {
  test("uses a fixed-area analysis sample and reuses identical geometry", () => {
    expect(imageEditor.analysisSampleDimensions(4000, 4000)).toEqual({ width: 256, height: 256 });
    expect(imageEditor.analysisSampleDimensions(6000, 4000)).toEqual({ width: 314, height: 209 });
    expect(imageEditor.analysisSampleDimensions(16000, 9000)).toEqual({ width: 341, height: 192 });
    expect(imageEditor.analysisSampleDimensions(4000, 1000)).toEqual({ width: 512, height: 128 });
    expect(imageEditor.analysisSampleDimensions(64, 32)).toEqual({ width: 64, height: 32 });

    const decoded = makeSyntheticDecodedRgb16();
    const sourceRect = { x: 0, y: 0, w: 4, h: 3 };
    const first = imageEditor.getAnalysisLinearRgbSample(decoded, sourceRect, 17);
    const second = imageEditor.getAnalysisLinearRgbSample(decoded, sourceRect, 17);
    const differentRotation = imageEditor.getAnalysisLinearRgbSample(decoded, sourceRect, 18);
    expect(second).toBe(first);
    expect(differentRotation).not.toBe(first);
  });

  test("reuses preview-resolution rendered linear RGB samples for identical geometry", () => {
    const decoded = makeSyntheticDecodedRgb16();
    const sourceRect = { x: 0, y: 0, w: 4, h: 3 };
    const first = imageEditor.getRenderedLinearRgbSample(decoded, sourceRect, 17, 140, 105);
    const second = imageEditor.getRenderedLinearRgbSample(decoded, sourceRect, 17, 140, 105);
    const differentSize = imageEditor.getRenderedLinearRgbSample(decoded, sourceRect, 17, 141, 105);
    expect(second).toBe(first);
    expect(differentSize).not.toBe(first);
    expect(first.width).toBe(140);
    expect(first.height).toBe(105);
  });

  test("precomputes color/tone adjustment activity flags", () => {
    const sample = { data: new Float32Array([0.1, 0.2, 0.3]), width: 1, height: 1 };
    const inactive = imageEditor.buildColorAdjustmentContextFromLinearRgbSample(
      sample, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    );
    expect({
      hasWhiteBalance: inactive.hasWhiteBalance,
      hasExposure: inactive.hasExposure,
      hasShadow: inactive.hasShadow,
      hasHighlight: inactive.hasHighlight,
      hasScaledLog: inactive.hasScaledLog,
      hasSigmoid: inactive.hasSigmoid,
      hasSaturation: inactive.hasSaturation,
      hasVibrance: inactive.hasVibrance,
      hasSaturationOrVibrance: inactive.hasSaturationOrVibrance,
    }).toEqual({
      hasWhiteBalance: false,
      hasExposure: false,
      hasShadow: false,
      hasHighlight: false,
      hasScaledLog: false,
      hasSigmoid: false,
      hasSaturation: false,
      hasVibrance: false,
      hasSaturationOrVibrance: false,
    });

    const active = imageEditor.buildColorAdjustmentContextFromLinearRgbSample(
      sample, 5, -4, 0.3, -20, 15, 0.4, 0.8, 12, -6,
    );
    expect({
      hasWhiteBalance: active.hasWhiteBalance,
      hasExposure: active.hasExposure,
      hasShadow: active.hasShadow,
      hasHighlight: active.hasHighlight,
      hasScaledLog: active.hasScaledLog,
      hasSigmoid: active.hasSigmoid,
      hasSaturation: active.hasSaturation,
      hasVibrance: active.hasVibrance,
      hasSaturationOrVibrance: active.hasSaturationOrVibrance,
    }).toEqual({
      hasWhiteBalance: true,
      hasExposure: true,
      hasShadow: true,
      hasHighlight: true,
      hasScaledLog: true,
      hasSigmoid: true,
      hasSaturation: true,
      hasVibrance: true,
      hasSaturationOrVibrance: true,
    });
  });

  test("avoids sorting endpoint-only percentiles and sorts once for percentile sets", () => {
    const endpointValues = [3, 1, 2];
    expect(imageEditor.percentilesFromValues(endpointValues, [0, 100])).toEqual([1, 3]);
    expect(endpointValues).toEqual([3, 1, 2]);

    const percentileValues = [4, 1, 3, 2];
    expect(imageEditor.percentilesFromValues(percentileValues, [0, 25, 50, 75, 100])).toEqual([
      1,
      1.75,
      2.5,
      3.25,
      4,
    ]);
    expect(percentileValues).toEqual([1, 2, 3, 4]);
  });

  test("freezes gamma2 storage with and without RAW 1EV headroom", () => {
    expect(imageEditor.encodeStoredRgb16Channel(1, "gamma20", 1)).toBe(65535);
    expect(imageEditor.encodeStoredRgb16Channel(1, "gamma20", 2)).toBe(46340);
    expect(imageEditor.encodeStoredRgb16Channel(2, "gamma20", 2)).toBe(65535);
    expect(imageEditor.decodeStoredRgb16Channel(46340, "gamma20", 2)).toBeCloseTo(
      0.99998951648,
      11,
    );
    expect(imageEditor.decodeStoredRgb16Channel(65535, "gamma20", 2)).toBe(2);
  });

  test("freezes bilinear sampling and rotation mapping", () => {
    const decoded = makeDecodedRgb16(
      3,
      2,
      [
        [0, 0.25, 0.5],
        [0.75, 1, 1.25],
        [1.5, 1.75, 2],
        [0.2, 0.4, 0.6],
        [0.8, 1.2, 1.6],
        [2, 1, 0.5],
      ],
      2,
    );
    const sample = imageEditor.sampleLinearRgb16BilinearAtSource(decoded, 0.5, 0.5);
    expect(sample).not.toBeNull();
    expect(rounded(sample ?? [])).toEqual([0.437501933383, 0.712493470342, 0.987500333031]);

    const intoSample: [number, number, number] = [0, 0, 0];
    expect(imageEditor.sampleLinearRgb16BilinearAtSourceInto(decoded, 0.5, 0.5, intoSample)).toBe(true);
    expect(rounded(intoSample)).toEqual([0.437501933383, 0.712493470342, 0.987500333031]);

    const point = imageEditor.renderedPixelToSourcePoint(7, 4, 400, 300, 10, 20, 2, 1.5, 33);
    expect(point.x).toBeCloseTo(-25.371550726743678, 12);
    expect(point.y).toBeCloseTo(144.92785814247995, 12);

    const transform = imageEditor.buildRenderedPixelToSourceTransform(400, 300, 10, 20, 2, 1.5, 33);
    expect(transform.originX + 7 * transform.columnStepX + 4 * transform.rowStepX).toBeCloseTo(point.x, 12);
    expect(transform.originY + 7 * transform.columnStepY + 4 * transform.rowStepY).toBeCloseTo(point.y, 12);
  });

  test("freezes the TCA/vignetting integration path around Lensfun coordinates", () => {
    const values: Array<[number, number, number]> = [
      [0, 0.25, 0.5],
      [0.75, 1, 1.25],
      [1.5, 1.75, 2],
      [0.2, 0.4, 0.6],
      [0.8, 1.2, 1.6],
      [2, 1, 0.5],
    ];
    const tcaDecoded = makeDecodedRgb16(3, 2, values, 2, {
      tca: true,
      vignetting: false,
      vignettingBaked: true,
    });
    expect(rounded(imageEditor.sampleLinearRgb16Bilinear(tcaDecoded, 0.5, 0.5) ?? [])).toEqual([
      0.268751031129,
      0.712493470342,
      1.206246666426,
    ]);
    const tcaIntoSample: [number, number, number] = [0, 0, 0];
    expect(
      imageEditor.sampleLinearRgb16BilinearInto(
        tcaDecoded,
        0.5,
        0.5,
        tcaIntoSample,
        imageEditor.createRgb16SamplingScratch(),
      ),
    ).toBe(true);
    expect(rounded(tcaIntoSample)).toEqual([0.268751031129, 0.712493470342, 1.206246666426]);

    const vignettingDecoded = makeDecodedRgb16(3, 2, values, 2, {
      tca: false,
      vignetting: true,
      vignettingBaked: false,
    });
    expect(
      rounded(imageEditor.sampleLinearRgb16Bilinear(vignettingDecoded, 0.5, 0.5) ?? []),
    ).toEqual([0.43968944305, 0.716055937694, 0.987500333031]);
  });
});

describe("image editor render characterization", () => {
  test("freezes synthetic RGB16 preview output", () => {
    const decoded = makeSyntheticDecodedRgb16();
    expect(
      fnv1a32(renderToBytes(decoded, { x: 0, y: 0, w: 4, h: 3 }, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
    ).toBe("9d568c31");

    expect(
      fnv1a32(
        renderToBytes(
          decoded,
          { x: 0, y: 0, w: 4, h: 3 },
          0,
          0,
          0,
          0.7,
          -35,
          70,
          0.8,
          -1.2,
          12,
          -5,
        ),
      ),
    ).toBe("b8a66e9e");
  });

  test("freezes crop + arbitrary rotation render output", () => {
    const decoded = makeSyntheticDecodedRgb16();
    const bytes = renderToBytes(
      decoded,
      { x: 0.5, y: 0.25, w: 3, h: 2.5 },
      33,
      0,
      0,
      0.3,
      -20,
      0,
      0.4,
      0.8,
      0,
      0,
    );
    expect(fnv1a32(bytes)).toBe("1a815ffb");
  });

  test("matches direct preview rendering when using the preview-resolution linear RGB cache", () => {
    const decoded = makeSyntheticDecodedRgb16();
    const sourceRect = { x: 0.5, y: 0.25, w: 3, h: 2.5 };
    const direct = renderToBytes(decoded, sourceRect, 33, 5, -4, 0.3, -20, 15, 0.4, 0.8, 12, -6, 7, 5);
    const cached = renderCachedPreviewToBytes(decoded, sourceRect, 33, 5, -4, 0.3, -20, 15, 0.4, 0.8, 12, -6, 7, 5);
    expect(Array.from(cached)).toEqual(Array.from(direct));
  });
});

describe("image editor Auto Tone characterization", () => {
  test("freezes the current Exposure -> Logarithm -> Sigmoid Auto sequence with Shadow/Highlight at zero", () => {
    const data = new Float32Array(100 * 3);
    for (let i = 0; i < 100; i++) {
      const value = (i / 99) * 0.3;
      data[i * 3] = value;
      data[i * 3 + 1] = value;
      data[i * 3 + 2] = value;
    }
    const sample = { data, width: 10, height: 10 };
    const exposure = imageEditor.findAutoExposure(sample, 0, 0);
    const scaledLog = imageEditor.findAutoLogarithm(sample, 0, 0, exposure);
    const sigmoid = imageEditor.findAutoSigmoid(sample, 0, 0, exposure, scaledLog);

    // Shadow and Highlight Auto are intentionally not implemented; Tone Auto resets both to zero.
    expect({ exposure, shadow: 0, highlight: 0, scaledLog, sigmoid }).toEqual({
      exposure: 1.7,
      shadow: 0,
      highlight: 0,
      scaledLog: -3,
      sigmoid: 0,
    });
  });
});

describe("image editor performance baseline", () => {
  test("reports a repeatable synthetic render baseline when explicitly enabled", () => {
    if (process.env.STGY_IMAGE_EDITOR_BENCH !== "1") {
      expect(true).toBe(true);
      return;
    }

    const width = 320;
    const height = 240;
    const values: Array<[number, number, number]> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const fx = x / Math.max(1, width - 1);
        const fy = y / Math.max(1, height - 1);
        values.push([0.05 + 1.4 * fx, 0.03 + 1.1 * fy, 0.02 + 0.8 * (fx + fy) / 2]);
      }
    }
    const decoded = makeDecodedRgb16(width, height, values, 2);
    const runs = 3;
    const elapsed: number[] = [];
    for (let run = 0; run < runs; run++) {
      const start = performance.now();
      renderToBytes(
        decoded,
        { x: 0, y: 0, w: width, h: height },
        17,
        0,
        0,
        0.6,
        -30,
        65,
        0.7,
        1.1,
        8,
        -4,
        width,
        height,
      );
      elapsed.push(performance.now() - start);
    }
    const sorted = [...elapsed].sort((a, b) => a - b);
    const medianMs = sorted[Math.floor(sorted.length / 2)] ?? 0;
    console.info(
      `[image-editor benchmark] ${width}x${height}, median=${medianMs.toFixed(2)}ms, ` +
        `runs=${elapsed.map((value) => value.toFixed(2)).join(",")}`,
    );
    expect(medianMs).toBeGreaterThan(0);
  });
});
