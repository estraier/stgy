/**
 * Restore's LIS-compatible area average, sampled while a tone-matched real
 * frame is already resident in a merge worker. The full-resolution reference
 * frame is never transferred to or decoded again by the controller.
 *
 * Each worker sends only the weighted RGB sums for sample rows touched by
 * its core stripe. The controller merges these in image-row order, including
 * when workers complete out of order. The complete sample is <= 65,536 RGB
 * Float32 pixels (about 0.75 MiB), regardless of source resolution.
 */
export const STF_RESTORE_SAMPLE_PIXELS = 65_536;

export type StfRestoreSampleStripe = {
  firstSampleY: number;
  sums: Float64Array;
};

export function stfRestoreSampleDimensions(width: number, height: number): { sampleWidth: number; sampleHeight: number } {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error("STF Restore sample dimensions are invalid.");
  }
  const scale = Math.min(1, Math.sqrt(STF_RESTORE_SAMPLE_PIXELS / (width * height)));
  return {
    sampleWidth: Math.max(1, Math.round(width * scale)),
    sampleHeight: Math.max(1, Math.round(height * scale)),
  };
}

/** Compute unnormalized contributions from exactly one aligned, tone-matched core stripe. */
export function sampleStfRestoreStripe(
  linear: Float32Array, width: number, fullHeight: number, startY: number,
): StfRestoreSampleStripe {
  const { sampleWidth, sampleHeight } = stfRestoreSampleDimensions(width, fullHeight);
  if (!Number.isInteger(startY) || startY < 0 || linear.length % (width * 3) !== 0) {
    throw new Error("STF Restore sample stripe geometry is invalid.");
  }
  const stripeHeight = linear.length / (width * 3);
  if (stripeHeight < 1 || startY + stripeHeight > fullHeight) {
    throw new Error("STF Restore sample stripe extends beyond the image.");
  }
  const syScale = fullHeight / sampleHeight;
  const sxScale = width / sampleWidth;
  const firstSampleY = Math.max(0, Math.floor(startY / syScale) - 1);
  const endSampleY = Math.min(sampleHeight, Math.ceil((startY + stripeHeight) / syScale) + 1);
  const sums = new Float64Array((endSampleY - firstSampleY) * sampleWidth * 3);
  // Identical area-overlap integration to StfRestoreSamples.append(),
  // restricted to this worker's own unpadded rows.
  for (let y = firstSampleY; y < endSampleY; y++) {
    const top = y * syScale;
    const bottom = (y + 1) * syScale;
    const rowStart = Math.max(startY, Math.floor(top));
    const rowEnd = Math.min(startY + stripeHeight, Math.ceil(bottom));
    for (let sy = rowStart; sy < rowEnd; sy++) {
      const wy = Math.max(0, Math.min(sy + 1, bottom) - Math.max(sy, top));
      if (!(wy > 0)) continue;
      const row = (sy - startY) * width * 3;
      for (let x = 0; x < sampleWidth; x++) {
        const left = x * sxScale;
        const right = (x + 1) * sxScale;
        const sampleIndex = ((y - firstSampleY) * sampleWidth + x) * 3;
        for (let sx = Math.floor(left); sx < Math.min(width, Math.ceil(right)); sx++) {
          const wx = Math.max(0, Math.min(sx + 1, right) - Math.max(sx, left));
          const weight = wx * wy;
          if (!(weight > 0)) continue;
          const index = row + sx * 3;
          for (let c = 0; c < 3; c++) sums[sampleIndex + c] += linear[index + c] * weight;
        }
      }
    }
  }
  return { firstSampleY, sums };
}

export class StfRestoreAreaSampleAccumulator {
  readonly sampleWidth: number;
  readonly sampleHeight: number;
  private readonly width: number;
  private readonly height: number;
  private readonly sums: Float64Array;

  constructor(width: number, height: number) {
    const dimensions = stfRestoreSampleDimensions(width, height);
    this.width = width;
    this.height = height;
    this.sampleWidth = dimensions.sampleWidth;
    this.sampleHeight = dimensions.sampleHeight;
    this.sums = new Float64Array(this.sampleWidth * this.sampleHeight * 3);
  }

  add(part: StfRestoreSampleStripe): void {
    const { firstSampleY, sums } = part;
    if (!Number.isInteger(firstSampleY) || firstSampleY < 0 ||
        sums.length % (this.sampleWidth * 3) !== 0 ||
        firstSampleY + sums.length / (this.sampleWidth * 3) > this.sampleHeight) {
      throw new Error("STF Restore sample contribution geometry is invalid.");
    }
    const start = firstSampleY * this.sampleWidth * 3;
    for (let i = 0; i < sums.length; i++) this.sums[start + i] += sums[i];
  }

  finish(): Float32Array {
    const area = (this.width / this.sampleWidth) * (this.height / this.sampleHeight);
    const sample = new Float32Array(this.sums.length);
    for (let i = 0; i < sample.length; i++) sample[i] = this.sums[i] / area;
    return sample;
  }
}

/** Sample the completed STF target directly from its already-resident buffer. */
export function sampleStfRestoreImage(linear: Float32Array, width: number, height: number): Float32Array {
  if (linear.length !== width * height * 3) throw new Error("STF Restore source dimensions are invalid.");
  const accumulator = new StfRestoreAreaSampleAccumulator(width, height);
  accumulator.add(sampleStfRestoreStripe(linear, width, height, 0));
  return accumulator.finish();
}
