// Opening-side STF extrapolation helper: reuse up to the first three adjacent
// real-image Flow fields, normalize them by the 1/F interval, and average the
// tracked displacements. With one real pair this is identical to the legacy
// extrapolation Flow; with two pairs it averages A-B and B-C equally; with
// three pairs it averages A-B, B-C, and C-D equally.
export type StfAverageFlowSample = {
  flow: Float32Array;
  // Positive 1/F difference for this adjacent pair, in travel direction.
  radiusSpan: number;
};

type Vector = { x: number; y: number };

function sampleVector(flow: Float32Array, width: number, height: number, x: number, y: number): Vector | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width - 1 || y > height - 1) return null;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * width + x0) * 2;
  const i10 = (y0 * width + x1) * 2;
  const i01 = (y1 * width + x0) * 2;
  const i11 = (y1 * width + x1) * 2;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy, w11 = fx * fy;
  const vx = flow[i00] * w00 + flow[i10] * w10 + flow[i01] * w01 + flow[i11] * w11;
  const vy = flow[i00 + 1] * w00 + flow[i10 + 1] * w10 + flow[i01 + 1] * w01 + flow[i11 + 1] * w11;
  return Number.isFinite(vx) && Number.isFinite(vy) ? { x: vx, y: vy } : null;
}

export function buildStfAverageFlow(
  samples: readonly StfAverageFlowSample[], width: number, height: number,
): Float32Array {
  if (samples.length < 1 || samples.length > 3 || !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error("STF opening Average Flow requires one to three adjacent real-image pairs.");
  }
  for (const { flow, radiusSpan } of samples) {
    if (flow.length !== width * height * 2 || !(radiusSpan > 0) || !Number.isFinite(radiusSpan)) {
      throw new Error("STF opening Average Flow received an invalid field or aperture interval.");
    }
  }

  if (samples.length === 1) return samples[0].flow;

  const result = new Float32Array(samples[0].flow.length);
  const baseSpan = samples[0].radiusSpan;
  const scales = samples.map((sample) => baseSpan / sample.radiusSpan);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 2;
      const firstX = samples[0].flow[i], firstY = samples[0].flow[i + 1];
      if (!Number.isFinite(firstX) || !Number.isFinite(firstY)) {
        result[i] = 0;
        result[i + 1] = 0;
        continue;
      }
      let sumX = firstX;
      let sumY = firstY;
      let count = 1;
      let trackX = x + firstX;
      let trackY = y + firstY;
      for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
        const tracked = sampleVector(samples[sampleIndex].flow, width, height, trackX, trackY);
        if (!tracked) break;
        sumX += tracked.x * scales[sampleIndex];
        sumY += tracked.y * scales[sampleIndex];
        count += 1;
        trackX += tracked.x;
        trackY += tracked.y;
      }
      result[i] = sumX / count;
      result[i + 1] = sumY / count;
    }
  }
  return result;
}
