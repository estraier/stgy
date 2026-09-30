const sources: Float32Array[] = [];

jest.mock("./canonical-source", () => ({
  readCanonicalLinearRows: jest.fn(async (_session: unknown, imageIndex: number, startRow: number, rowCount: number) => {
    const meta = (_session as { images: Array<{ width: number }> }).images[imageIndex];
    const width = meta.width;
    const src = sources[imageIndex];
    return src.slice(startRow * width * 3, (startRow + rowCount) * width * 3);
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
