const sources: Float32Array[] = [];

jest.mock("./canonical-source", () => ({
  readCanonicalLinearRows: jest.fn(async (_session: unknown, imageIndex: number, startRow: number, rowCount: number) => {
    const meta = (_session as { images: Array<{ width: number }> }).images[imageIndex];
    const width = meta.width;
    const src = sources[imageIndex];
    return src.slice(startRow * width * 3, (startRow + rowCount) * width * 3);
  }),
  // Test-only storage uses the source channel index as its fake 16-bit code.
  readCanonicalStoredRows: jest.fn(async (_session: unknown, imageIndex: number, startRow: number, rowCount: number) => {
    const meta = (_session as { images: Array<{ width: number }> }).images[imageIndex];
    return Uint16Array.from(Array.from({ length: rowCount * meta.width * 3 }, (_, i) =>
      startRow * meta.width * 3 + i + 1));
  }),
  getCanonicalLinearDecodeLut: jest.fn(() => {
    const lut = new Float32Array(65536);
    for (let i = 0; i < sources[0].length; i++) lut[i + 1] = sources[0][i];
    return lut;
  }),
}));

import { AlignedImageReader } from "./aligned-reader";

function rgb(values: number[]): Float32Array {
  const out = new Float32Array(values.length * 3);
  values.forEach((value, index) => {
    out[index * 3] = value;
    out[index * 3 + 1] = value;
    out[index * 3 + 2] = value;
  });
  return out;
}

function session(width: number, height: number) {
  return { images: [{ width, height }] } as any;
}

const identity = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

describe("AlignedImageReader", () => {
  test("preserves an identity feature-match image", async () => {
    sources[0] = rgb([0.1, 0.2, 0.3, 0.4]);
    const reader = new AlignedImageReader(
      session(2, 2),
      { normalizationMode: "feature-match", targetWidth: 2, targetHeight: 2 },
      { matrices: [identity] },
    );
    expect(Array.from(await reader.readLinearImage(0))).toEqual(Array.from(sources[0]));
  });

  test("applies center crop before alignment", async () => {
    sources[0] = rgb([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
      12, 13, 14, 15,
    ]);
    const reader = new AlignedImageReader(
      session(4, 4),
      { normalizationMode: "center-crop", targetWidth: 2, targetHeight: 2 },
      { matrices: [identity] },
    );
    const result = await reader.readLinearImage(0);
    expect([result[0], result[3], result[6], result[9]]).toEqual([5, 6, 9, 10]);
  });

  test("uses inverse mapping for feature-match transforms", async () => {
    sources[0] = rgb([0, 1, 2]);
    // Source -> destination is +1px in X. BORDER_REPLICATE produces [0, 0, 1].
    const translateRight = new Float64Array([1, 0, 1, 0, 1, 0, 0, 0, 1]);
    const reader = new AlignedImageReader(
      session(3, 1),
      { normalizationMode: "feature-match", targetWidth: 3, targetHeight: 1 },
      { matrices: [translateRight] },
    );
    const result = await reader.readLinearImage(0);
    expect([result[0], result[3], result[6]]).toEqual([0, 0, 1]);
  });
});

describe("AlignedImageReader sampled RGB brightness", () => {
  test("sample-grid reads match the original full-region pixels for alignment, crops, and stripe boundaries", async () => {
    const sourceWidth = 29, sourceHeight = 23;
    sources[0] = new Float32Array(sourceWidth * sourceHeight * 3);
    for (let i = 0; i < sources[0].length; i++) {
      sources[0][i] = Math.fround((Math.sin(i * 0.19) + 1.2) * (1 + (i % 17)) / 21);
    }
    const variants = [
      { mode: "feature-match" as const, width: 29, height: 23, matrix: identity },
      { mode: "feature-match" as const, width: 29, height: 23,
        matrix: new Float64Array([1, 0.11, 1.3, -0.04, 1, -0.9, 0, 0, 1]) },
      { mode: "center-crop" as const, width: 21, height: 17, matrix: identity },
      { mode: "center-fit" as const, width: 25, height: 19, matrix: identity },
      { mode: "center-fill" as const, width: 34, height: 27, matrix: identity },
      { mode: "top-left-fill" as const, width: 34, height: 27, matrix: identity },
    ];
    for (const variant of variants) {
      const reader = new AlignedImageReader(
        session(sourceWidth, sourceHeight),
        { normalizationMode: variant.mode, targetWidth: variant.width, targetHeight: variant.height },
        { matrices: [variant.matrix] },
      );
      for (const stride of [1, 2, 5, 9]) {
        const offsetX = Math.min(variant.width - 1, Math.floor(stride / 2));
        const offsetY = Math.min(variant.height - 1, Math.floor(stride / 2));
        for (let y = 0; y < variant.height; y += 7) {
          const h = Math.min(7, variant.height - y);
          const full = await reader.readLinearRegion(0, 0, y, variant.width, h);
          const samples = await reader.readLinearSampleGrid(0, y, h, stride, offsetX, offsetY);
          const expected: number[] = [];
          for (let sy = offsetY; sy < variant.height; sy += stride) {
            if (sy < y || sy >= y + h) continue;
            for (let sx = offsetX; sx < variant.width; sx += stride) {
              const start = ((sy - y) * variant.width + sx) * 3;
              expected.push(full[start], full[start + 1], full[start + 2]);
            }
          }
          expect(Array.from(samples)).toEqual(expected);
        }
      }
    }
  });

  test("sample grid rejects impossible stride/offset parameters", async () => {
    sources[0] = rgb([1, 2, 3, 4]);
    const reader = new AlignedImageReader(session(2, 2),
      { normalizationMode: "feature-match", targetWidth: 2, targetHeight: 2 },
      { matrices: [identity] });
    await expect(reader.readLinearSampleGrid(0, 0, 2, 0, 0, 0)).rejects.toThrow();
    await expect(reader.readLinearSampleGrid(0, 0, 2, 1, 2, 0)).rejects.toThrow();
  });
});
