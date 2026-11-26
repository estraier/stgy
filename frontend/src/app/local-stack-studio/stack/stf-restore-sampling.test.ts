import {
  StfRestoreAreaSampleAccumulator,
  sampleStfRestoreImage,
  sampleStfRestoreStripe,
} from "./stf-restore-sampling";

const PIXEL_TARGET = 65_536;

/** Same area-average sampling as LIS, but read the aligned reference in stripes. */
class ReferenceAreaSampler {
  readonly sampleWidth: number;
  readonly sampleHeight: number;
  private readonly sourceSum: Float64Array;
  private readonly referenceSum: Float64Array;
  private readonly width: number;
  private readonly height: number;
  private nextY = 0;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error("reference sample dimensions are invalid.");
    }
    this.width = width;
    this.height = height;
    const scale = Math.min(1, Math.sqrt(PIXEL_TARGET / (width * height)));
    this.sampleWidth = Math.max(1, Math.round(width * scale));
    this.sampleHeight = Math.max(1, Math.round(height * scale));
    this.sourceSum = new Float64Array(this.sampleWidth * this.sampleHeight * 3);
    this.referenceSum = new Float64Array(this.sourceSum.length);
  }

  append(source: Float32Array, reference: Float32Array, startY: number): void {
    if (startY !== this.nextY || source.length !== reference.length ||
        source.length % (this.width * 3) !== 0) {
      throw new Error("reference sample stripes are missing or unordered.");
    }
    const stripeHeight = source.length / (this.width * 3);
    if (!(stripeHeight > 0) || startY + stripeHeight > this.height) {
      throw new Error("reference sample stripe geometry is invalid.");
    }
    const syScale = this.height / this.sampleHeight;
    const sxScale = this.width / this.sampleWidth;
    const sampleY0 = Math.max(0, Math.floor(startY / syScale) - 1);
    const sampleY1 = Math.min(this.sampleHeight, Math.ceil((startY + stripeHeight) / syScale) + 1);
    for (let y = sampleY0; y < sampleY1; y++) {
      const top = y * syScale;
      const bottom = (y + 1) * syScale;
      const rowStart = Math.max(startY, Math.floor(top));
      const rowEnd = Math.min(startY + stripeHeight, Math.ceil(bottom));
      for (let sy = rowStart; sy < rowEnd; sy++) {
        const wy = Math.max(0, Math.min(sy + 1, bottom) - Math.max(sy, top));
        if (!(wy > 0)) continue;
        const row = (sy - startY) * this.width * 3;
        for (let x = 0; x < this.sampleWidth; x++) {
          const left = x * sxScale;
          const right = (x + 1) * sxScale;
          const sampleIndex = (y * this.sampleWidth + x) * 3;
          for (let sx = Math.floor(left); sx < Math.min(this.width, Math.ceil(right)); sx++) {
            const wx = Math.max(0, Math.min(sx + 1, right) - Math.max(sx, left));
            const weight = wx * wy;
            if (!(weight > 0)) continue;
            const index = row + sx * 3;
            for (let c = 0; c < 3; c++) {
              this.sourceSum[sampleIndex + c] += source[index + c] * weight;
              this.referenceSum[sampleIndex + c] += reference[index + c] * weight;
            }
          }
        }
      }
    }
    this.nextY += stripeHeight;
  }

  finish(): { source: Float32Array; reference: Float32Array } {
    if (this.nextY !== this.height) throw new Error("reference sample is incomplete.");
    const area = (this.width / this.sampleWidth) * (this.height / this.sampleHeight);
    const source = new Float32Array(this.sourceSum.length);
    const reference = new Float32Array(this.referenceSum.length);
    for (let i = 0; i < this.sourceSum.length; i++) {
      source[i] = this.sourceSum[i] / area;
      reference[i] = this.referenceSum[i] / area;
    }
    return { source, reference };
  }
}


function makeInput(width: number, height: number) {
  const input = new Float32Array(width * height * 3);
  for (let i = 0; i < input.length; i++) input[i] = (i * 137 % 997) / 997;
  return input;
}

describe("STF Restore in-merge sampling", () => {
  test.each([[7, 9], [137, 89], [640, 480], [1000, 47], [17, 2000]])(
    "matches the former main-thread area average for %ix%i", (width, height) => {
      const input = makeInput(width, height);
      const previous = new ReferenceAreaSampler(width, height);
      previous.append(input, input, 0);
      const expected = previous.finish().reference;

      const direct = sampleStfRestoreImage(input, width, height);
      expect(direct.length).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) expect(direct[i]).toBeCloseTo(expected[i], 6);

      const jobs: Array<{ y: number; sums: ReturnType<typeof sampleStfRestoreStripe> }> = [];
      for (let y = 0; y < height; y += 13) {
        const end = Math.min(height, y + 13);
        jobs.push({ y, sums: sampleStfRestoreStripe(
          input.subarray(y * width * 3, end * width * 3), width, height, y,
        ) });
      }
      // Worker completion order may be arbitrary; the controller must assemble
      // contributions in image-row order rather than callback completion order.
      const completedOutOfOrder = jobs.slice().reverse();
      const sorted = completedOutOfOrder.sort((a, b) => a.y - b.y);
      const combined = new StfRestoreAreaSampleAccumulator(width, height);
      for (const job of sorted) combined.add(job.sums);
      const actual = combined.finish();
      for (let i = 0; i < expected.length; i++) {
        expect(actual[i]).toBeCloseTo(expected[i], 6);
      }
    },
  );

  test("samples only unpadded rows of an aligned Sobel analysis stripe", () => {
    const width = 37, height = 91;
    const input = makeInput(width, height);
    const result = new StfRestoreAreaSampleAccumulator(width, height);
    for (let y = 0; y < height; y += 8) {
      const end = Math.min(height, y + 8);
      const regionY = Math.max(0, y - 11);
      const regionEnd = Math.min(height, end + 11);
      const halo = input.subarray(regionY * width * 3, regionEnd * width * 3);
      const core = halo.subarray((y - regionY) * width * 3, (end - regionY) * width * 3);
      result.add(sampleStfRestoreStripe(core, width, height, y));
    }
    const direct = sampleStfRestoreImage(input, width, height);
    const sampled = result.finish();
    for (let i = 0; i < sampled.length; i++) expect(sampled[i]).toBeCloseTo(direct[i], 6);
  });

  test("rejects invalid sample geometry", () => {
    expect(() => sampleStfRestoreStripe(new Float32Array(6), 4, 4, 0)).toThrow();
    const accumulator = new StfRestoreAreaSampleAccumulator(4, 4);
    expect(() => accumulator.add({ firstSampleY: 4, sums: new Float64Array(12) })).toThrow();
  });
});
