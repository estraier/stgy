export type PanoramaCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RowUpdater = (row: number, heights: Int32Array) => void;

function preferRect(candidate: PanoramaCropRect, best: PanoramaCropRect): boolean {
  const candidateArea = candidate.width * candidate.height;
  const bestArea = best.width * best.height;
  if (candidateArea !== bestArea) return candidateArea > bestArea;
  if (candidate.y !== best.y) return candidate.y < best.y;
  if (candidate.x !== best.x) return candidate.x < best.x;
  if (candidate.height !== best.height) return candidate.height > best.height;
  return candidate.width > best.width;
}

function largestRectangleFromRows(
  width: number,
  height: number,
  updateHeights: RowUpdater,
): PanoramaCropRect | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Panorama coverage dimensions are invalid.");
  }

  const heights = new Int32Array(width);
  const stack = new Int32Array(width + 1);
  let best: PanoramaCropRect = { x: 0, y: 0, width: 0, height: 0 };

  for (let row = 0; row < height; row += 1) {
    updateHeights(row, heights);
    let stackSize = 0;
    for (let column = 0; column <= width; column += 1) {
      const currentHeight = column < width ? heights[column] : 0;
      while (stackSize > 0 && heights[stack[stackSize - 1]!] > currentHeight) {
        const index = stack[--stackSize]!;
        const rectangleHeight = heights[index]!;
        const left = stackSize > 0 ? stack[stackSize - 1]! + 1 : 0;
        const rectangleWidth = column - left;
        if (rectangleHeight <= 0 || rectangleWidth <= 0) continue;
        const candidate: PanoramaCropRect = {
          x: left,
          y: row - rectangleHeight + 1,
          width: rectangleWidth,
          height: rectangleHeight,
        };
        if (preferRect(candidate, best)) best = candidate;
      }
      if (column < width) stack[stackSize++] = column;
    }
  }

  return best.width > 0 && best.height > 0 ? best : null;
}

export function largestValidPanoramaRectFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
): PanoramaCropRect | null {
  if (mask.length !== width * height) {
    throw new Error("Panorama coverage mask has an invalid size.");
  }
  return largestRectangleFromRows(width, height, (row, heights) => {
    const rowOffset = row * width;
    for (let x = 0; x < width; x += 1) {
      heights[x] = mask[rowOffset + x] !== 0 ? heights[x]! + 1 : 0;
    }
  });
}

export function largestValidPanoramaRectFromBgrCoverage(
  coverageBgr: Uint8Array,
  width: number,
  height: number,
): PanoramaCropRect | null {
  if (coverageBgr.length !== width * height * 3) {
    throw new Error("Panorama coverage image has an invalid size.");
  }
  return largestRectangleFromRows(width, height, (row, heights) => {
    let offset = row * width * 3;
    for (let x = 0; x < width; x += 1, offset += 3) {
      const covered = coverageBgr[offset]! !== 0
        || coverageBgr[offset + 1]! !== 0
        || coverageBgr[offset + 2]! !== 0;
      heights[x] = covered ? heights[x]! + 1 : 0;
    }
  });
}

export function panoramaCoverageFromExteriorBlack(
  panoramaBgr: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Panorama dimensions are invalid.");
  }
  if (panoramaBgr.length !== width * height * 3) {
    throw new Error("Panorama image has an invalid size.");
  }

  const pixelCount = width * height;
  const exterior = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const isBlack = (index: number): boolean => {
    const offset = index * 3;
    return panoramaBgr[offset] === 0
      && panoramaBgr[offset + 1] === 0
      && panoramaBgr[offset + 2] === 0;
  };
  const enqueue = (index: number): void => {
    if (index < 0 || index >= pixelCount || exterior[index] !== 0 || !isBlack(index)) return;
    exterior[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y + 1 < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const coverage = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    coverage[index] = exterior[index] === 0 ? 1 : 0;
  }
  return coverage;
}

function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function blurBoxHorizontal(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
  output: Float32Array,
): void {
  const prefix = new Float64Array(width + 1);
  for (let y = 0; y < height; y += 1) {
    prefix[0] = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      prefix[x + 1] = prefix[x]! + source[rowOffset + x]!;
    }
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const count = right - left + 1;
      output[rowOffset + x] = Number((prefix[right + 1]! - prefix[left]!) / count);
    }
  }
}

function blurBoxVertical(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
  output: Float32Array,
): void {
  const prefix = new Float64Array(height + 1);
  for (let x = 0; x < width; x += 1) {
    prefix[0] = 0;
    for (let y = 0; y < height; y += 1) {
      prefix[y + 1] = prefix[y]! + source[y * width + x]!;
    }
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      const count = bottom - top + 1;
      output[y * width + x] = Number((prefix[bottom + 1]! - prefix[top]!) / count);
    }
  }
}

function blurBoxApproximateGaussian(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
  passes = 3,
): Float32Array {
  if (radius <= 0) return source.slice();
  let current = source.slice();
  const temp = new Float32Array(source.length);
  let output = new Float32Array(source.length);
  for (let pass = 0; pass < passes; pass += 1) {
    blurBoxHorizontal(current, width, height, radius, temp);
    blurBoxVertical(temp, width, height, radius, output);
    if (pass + 1 < passes) {
      const swap = current;
      current = output;
      output = swap;
    }
  }
  return output;
}

function computeFillChebyshevDistance(
  coverage: Uint8Array,
  width: number,
  height: number,
  queue: Uint32Array,
): { distance: Uint16Array; maxDistance: number; uncoveredCount: number } {
  const pixelCount = width * height;
  const distance = new Uint16Array(pixelCount);
  distance.fill(0xffff);
  let head = 0;
  let tail = 0;
  let uncoveredCount = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    if (coverage[index] !== 0) {
      distance[index] = 0;
      queue[tail++] = index;
    } else {
      uncoveredCount += 1;
    }
  }
  if (tail === 0) throw new Error("Panorama has no covered pixels to fill from.");
  if (uncoveredCount === 0) {
    return { distance, maxDistance: 0, uncoveredCount };
  }

  let maxDistance = 0;
  while (head < tail) {
    const index = queue[head++]!;
    const baseDistance = distance[index]! + 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const x0 = Math.max(0, x - 1);
    const x1 = Math.min(width - 1, x + 1);
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let ny = y0; ny <= y1; ny += 1) {
      for (let nx = x0; nx <= x1; nx += 1) {
        const neighbor = ny * width + nx;
        if (distance[neighbor] !== 0xffff) continue;
        distance[neighbor] = baseDistance;
        if (baseDistance > maxDistance) maxDistance = baseDistance;
        queue[tail++] = neighbor;
      }
    }
  }

  return { distance, maxDistance, uncoveredCount };
}

function buildWeightedSourceChannel(
  gamma2Rgb: Uint16Array,
  coverage: Uint8Array,
  pixelCount: number,
  channel: number,
): Float32Array {
  const weighted = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    if (coverage[index] === 0) continue;
    weighted[index] = gamma2Rgb[index * 3 + channel]!;
  }
  return weighted;
}

function buildCoverageWeights(coverage: Uint8Array): Float32Array {
  const weights = new Float32Array(coverage.length);
  for (let index = 0; index < coverage.length; index += 1) {
    weights[index] = coverage[index] !== 0 ? 1 : 0;
  }
  return weights;
}

function fillChannelFromBlurFields(
  gamma2Rgb: Uint16Array,
  coverage: Uint8Array,
  width: number,
  height: number,
  channel: number,
  distance: Uint16Array,
  maxDistance: number,
  smallWeight: Float32Array,
  largeWeight: Float32Array,
  smallRadius: number,
  largeRadius: number,
): void {
  const pixelCount = width * height;
  const weighted = buildWeightedSourceChannel(gamma2Rgb, coverage, pixelCount, channel);
  const smallField = blurBoxApproximateGaussian(weighted, width, height, smallRadius);
  const largeField = blurBoxApproximateGaussian(weighted, width, height, largeRadius);
  const blendSpan = Math.max(1, Math.min(maxDistance, Math.max(smallRadius * 4, Math.round(maxDistance * 0.7))));

  for (let index = 0; index < pixelCount; index += 1) {
    if (coverage[index] !== 0) continue;
    const largeDen = largeWeight[index]!;
    if (largeDen <= 1e-9) {
      throw new Error("Panorama fill low-frequency field does not reach the full margin.");
    }
    const farValue = largeField[index]! / largeDen;
    const smallDen = smallWeight[index]!;
    const nearValue = smallDen > 1e-9 ? smallField[index]! / smallDen : farValue;
    const layer = Math.max(0, distance[index]! - 1);
    const distanceBlend = smoothstep01(layer / blendSpan);
    // Fade away from the near field before its normalized mask support reaches
    // zero. This prevents a second contour at the edge of the small blur field.
    const supportBlend = 1 - smoothstep01(smallDen / 0.03);
    const blend = Math.max(distanceBlend, supportBlend);
    const filled = nearValue + (farValue - nearValue) * blend;
    const destination = index * 3 + channel;
    gamma2Rgb[destination] = Math.max(0, Math.min(65535, Math.round(filled)));
  }
}

export function fillPanoramaMarginsFromMask(
  gamma2Rgb: Uint16Array,
  coverage: Uint8Array,
  width: number,
  height: number,
  workQueue: Uint32Array,
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Panorama fill dimensions are invalid.");
  }
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > 0xffffffff) {
    throw new Error("Panorama fill pixel count is invalid.");
  }
  if (gamma2Rgb.length !== pixelCount * 3) {
    throw new Error("Panorama fill image has an invalid size.");
  }
  if (coverage.length !== pixelCount) {
    throw new Error("Panorama fill coverage mask has an invalid size.");
  }
  if (workQueue.length < pixelCount) {
    throw new Error("Panorama fill work queue is too small.");
  }

  const { distance, maxDistance, uncoveredCount } = computeFillChebyshevDistance(
    coverage,
    width,
    height,
    workQueue,
  );
  if (uncoveredCount === 0) return;

  const smallRadius = Math.max(1, Math.min(24, Math.round(Math.max(1, maxDistance * 0.35))));
  // The low-frequency field must reach every uncovered pixel. A capped radius
  // leaves pixels outside the blur support with a zero denominator, which shows
  // up as a dark step. Box blur is O(N) here, so an uncapped radius does not
  // make the convolution itself more expensive.
  const largeRadius = Math.max(smallRadius + 2, maxDistance);
  const coverageWeights = buildCoverageWeights(coverage);
  const smallWeight = blurBoxApproximateGaussian(coverageWeights, width, height, smallRadius);
  const largeWeight = blurBoxApproximateGaussian(coverageWeights, width, height, largeRadius);

  fillChannelFromBlurFields(
    gamma2Rgb,
    coverage,
    width,
    height,
    0,
    distance,
    maxDistance,
    smallWeight,
    largeWeight,
    smallRadius,
    largeRadius,
  );
  fillChannelFromBlurFields(
    gamma2Rgb,
    coverage,
    width,
    height,
    1,
    distance,
    maxDistance,
    smallWeight,
    largeWeight,
    smallRadius,
    largeRadius,
  );
  fillChannelFromBlurFields(
    gamma2Rgb,
    coverage,
    width,
    height,
    2,
    distance,
    maxDistance,
    smallWeight,
    largeWeight,
    smallRadius,
    largeRadius,
  );

  coverage.fill(1);
}
