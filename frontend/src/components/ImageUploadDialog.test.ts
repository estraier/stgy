// Characterization tests import the extracted processing core directly so they do not
// depend on React/Next.js or on the ImageUploadDialog component module.

// Sampling integration is characterized with deterministic Lensfun coordinates here.
// lensfunCorrection.ts itself remains responsible for calculating the real
// distortion/TCA/vignetting maps.
jest.mock("@/utils/lensfunCorrection", () => ({
  buildRawLensfunCorrection: jest.fn(),
  summarizeLensfunCorrection: jest.fn(() => ""),
  lensfunSourceCoordinates: (_correction: unknown, x: number, y: number) => ({
    r: [x - 0.25, y],
    g: [x, y],
    b: [x + 0.25, y],
  }),
  lensfunVignettingGain: (_correction: unknown, x: number, y: number) => [
    1 + x * 0.01,
    1 + y * 0.01,
    1,
  ],
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

describe("image editor tone characterization", () => {
  test("freezes the current Shadow curves", () => {
    const points = [0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4];
    expect(rounded(points.map((x) => imageEditor.applyShadowLinear(x, -100)))).toEqual([
      0,
      0.003222041554,
      0.0062532972,
      0.01467931346,
      0.02935862692,
      0.05,
      0.094790243902,
      0.253092682927,
      0.4,
    ]);
    expect(rounded(points.map((x) => imageEditor.applyShadowLinear(x, 100)))).toEqual([
      0.100976709241,
      0.107362283997,
      0.113735236664,
      0.132832456799,
      0.164913598798,
      0.197896318557,
      0.232456799399,
      0.309015777611,
      0.4,
    ]);
  });

  test("freezes Highlight endpoints and the current exponent-2.4 curve", () => {
    const range = { p0: 0.02, p100: 1.2 };
    const points = [0.02, 0.1, 0.4, 0.8, 1, 1.2];
    expect(rounded(points.map((x) => imageEditor.applyHighlightLinear(x, -100, range)))).toEqual([
      0.02,
      0.05598825543,
      0.200179998013,
      0.503208348654,
      0.791396432436,
      1.2,
    ]);
    expect(rounded(points.map((x) => imageEditor.applyHighlightLinear(x, 100, range)))).toEqual([
      0.02,
      0.123443452301,
      0.509163047948,
      0.988967387899,
      1.159805007103,
      1.2,
    ]);
    expect(imageEditor.applyHighlightLinear(range.p0, -100, range)).toBe(range.p0);
    expect(imageEditor.applyHighlightLinear(range.p100, 100, range)).toBe(range.p100);
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
      { p0: 0.015, p100: 1.45 },
      imageEditor.rolloffParams(2.1, 0.5, 4),
      0.8,
      -1.2,
    );
    expect(rounded(tone)).toEqual([0.224081377671, 0.793269462975, 1]);
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

    const point = imageEditor.renderedPixelToSourcePoint(7, 4, 400, 300, 10, 20, 2, 1.5, 33);
    expect(point.x).toBeCloseTo(-25.371550726743678, 12);
    expect(point.y).toBeCloseTo(144.92785814247995, 12);
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
    ).toBe("3c4cfc7a");
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
    expect(fnv1a32(bytes)).toBe("a1950ca6");
  });
});

describe("image editor Auto Tone characterization", () => {
  test("places Shadow Auto's soft point at post-exposure P2", () => {
    const data = new Float32Array(101 * 3);
    for (let i = 0; i <= 100; i++) {
      const value = i * 0.015;
      data[i * 3] = value;
      data[i * 3 + 1] = value;
      data[i * 3 + 2] = value;
    }
    const sample = { data, width: 101, height: 1 };
    expect(imageEditor.findAutoShadow(sample, 0, 0, 0)).toBe(-20);
  });

  test("freezes the current Exposure -> Shadow -> Logarithm -> Sigmoid Auto sequence", () => {
    const data = new Float32Array(100 * 3);
    for (let i = 0; i < 100; i++) {
      const value = (i / 99) * 0.3;
      data[i * 3] = value;
      data[i * 3 + 1] = value;
      data[i * 3 + 2] = value;
    }
    const sample = { data, width: 10, height: 10 };
    const exposure = imageEditor.findAutoExposure(sample, 0, 0);
    const shadow = imageEditor.findAutoShadow(sample, 0, 0, exposure);
    const scaledLog = imageEditor.findAutoLogarithm(sample, 0, 0, exposure, shadow);
    const sigmoid = imageEditor.findAutoSigmoid(sample, 0, 0, exposure, shadow, scaledLog);

    // Highlight Auto is intentionally not implemented; Tone Auto resets Highlight to zero.
    expect({ exposure, shadow, highlight: 0, scaledLog, sigmoid }).toEqual({
      exposure: 1.7,
      shadow: -13,
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
