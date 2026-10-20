export type PanoramaExposureProxy = {
  cornerX: number;
  cornerY: number;
  width: number;
  height: number;
  bgr: Float32Array;
  mask: Uint8Array;
};

export type PanoramaGainMap = {
  width: number;
  height: number;
  data: Float32Array;
};

const BLOCK_SIZE = 32;
const SAMPLE_STEP = 2;
const MIN_SAMPLE_VALUE = 10;
const MAX_SAMPLE_VALUE = 245;
const MIN_GAIN = 2 / 3;
const MAX_GAIN = 1.5;
const MAX_LOG_SAMPLE = Math.log(MAX_GAIN);
const MIN_BLOCK_SAMPLES = 12;
const FILL_ITERATIONS = 12;
const SMOOTH_ITERATIONS = 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function blockIndex(mapWidth: number, x: number, y: number): number {
  return y * mapWidth + x;
}

function gainBlockForPixel(value: number, size: number, blocks: number): number {
  if (blocks <= 1 || size <= 1) return 0;
  return Math.min(blocks - 1, Math.max(0, Math.floor(value * blocks / size)));
}

function smoothObservedGrid(
  values: Float32Array,
  observed: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  let current = values.slice();
  const known = observed.slice();

  // Diffuse nearby solved gains into blocks without direct overlap evidence.
  for (let iteration = 0; iteration < FILL_ITERATIONS; iteration += 1) {
    const next = current.slice();
    const nextKnown = known.slice();
    let changed = false;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = blockIndex(width, x, y);
        if (known[index] !== 0) continue;
        let sum = 0;
        let count = 0;
        if (x > 0 && known[index - 1] !== 0) { sum += current[index - 1]!; count += 1; }
        if (x + 1 < width && known[index + 1] !== 0) { sum += current[index + 1]!; count += 1; }
        if (y > 0 && known[index - width] !== 0) { sum += current[index - width]!; count += 1; }
        if (y + 1 < height && known[index + width] !== 0) { sum += current[index + width]!; count += 1; }
        if (count > 0) {
          next[index] = sum / count;
          nextKnown[index] = 1;
          changed = true;
        }
      }
    }
    current = next;
    known.set(nextKnown);
    if (!changed) break;
  }

  // Match OpenCV BlocksCompensator's intent: gains change slowly across blocks.
  for (let iteration = 0; iteration < SMOOTH_ITERATIONS; iteration += 1) {
    const horizontal = new Float32Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = blockIndex(width, x, y);
        const left = current[blockIndex(width, Math.max(0, x - 1), y)]!;
        const center = current[index]!;
        const right = current[blockIndex(width, Math.min(width - 1, x + 1), y)]!;
        horizontal[index] = 0.25 * left + 0.5 * center + 0.25 * right;
      }
    }
    const vertical = new Float32Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = blockIndex(width, x, y);
        const top = horizontal[blockIndex(width, x, Math.max(0, y - 1))]!;
        const center = horizontal[index]!;
        const bottom = horizontal[blockIndex(width, x, Math.min(height - 1, y + 1))]!;
        vertical[index] = 0.25 * top + 0.5 * center + 0.25 * bottom;
      }
    }
    current = vertical;
  }
  return current;
}

export function estimatePanoramaGainMaps(
  images: ReadonlyArray<PanoramaExposureProxy>,
): PanoramaGainMap[] {
  const states = images.map((image) => {
    if (image.bgr.length < image.width * image.height * 3 || image.mask.length < image.width * image.height) {
      throw new Error("Panorama exposure proxy has an invalid pixel buffer.");
    }
    const gridWidth = Math.max(1, Math.ceil(image.width / BLOCK_SIZE));
    const gridHeight = Math.max(1, Math.ceil(image.height / BLOCK_SIZE));
    const blockCount = gridWidth * gridHeight;
    return {
      gridWidth,
      gridHeight,
      logSums: new Float64Array(blockCount * 3),
      counts: new Uint32Array(blockCount * 3),
    };
  });

  for (let firstIndex = 0; firstIndex < images.length; firstIndex += 1) {
    const first = images[firstIndex]!;
    const firstState = states[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < images.length; secondIndex += 1) {
      const second = images[secondIndex]!;
      const secondState = states[secondIndex]!;
      const left = Math.max(first.cornerX, second.cornerX);
      const top = Math.max(first.cornerY, second.cornerY);
      const right = Math.min(first.cornerX + first.width, second.cornerX + second.width);
      const bottom = Math.min(first.cornerY + first.height, second.cornerY + second.height);
      if (right <= left || bottom <= top) continue;

      for (let globalY = top; globalY < bottom; globalY += SAMPLE_STEP) {
        const firstY = globalY - first.cornerY;
        const secondY = globalY - second.cornerY;
        for (let globalX = left; globalX < right; globalX += SAMPLE_STEP) {
          const firstX = globalX - first.cornerX;
          const secondX = globalX - second.cornerX;
          const firstPixel = firstY * first.width + firstX;
          const secondPixel = secondY * second.width + secondX;
          if (first.mask[firstPixel] === 0 || second.mask[secondPixel] === 0) continue;

          const firstBlock = blockIndex(
            firstState.gridWidth,
            gainBlockForPixel(firstX, first.width, firstState.gridWidth),
            gainBlockForPixel(firstY, first.height, firstState.gridHeight),
          );
          const secondBlock = blockIndex(
            secondState.gridWidth,
            gainBlockForPixel(secondX, second.width, secondState.gridWidth),
            gainBlockForPixel(secondY, second.height, secondState.gridHeight),
          );

          for (let channel = 0; channel < 3; channel += 1) {
            const firstValue = first.bgr[firstPixel * 3 + channel]!;
            const secondValue = second.bgr[secondPixel * 3 + channel]!;
            if (
              !Number.isFinite(firstValue)
              || !Number.isFinite(secondValue)
              || firstValue < MIN_SAMPLE_VALUE
              || secondValue < MIN_SAMPLE_VALUE
              || firstValue > MAX_SAMPLE_VALUE
              || secondValue > MAX_SAMPLE_VALUE
            ) continue;

            // Symmetric log-domain correction: both images move halfway toward
            // their geometric mean. Clamp individual observations so an edge,
            // parallax mismatch or moving object cannot dominate a block.
            const logRatio = clamp(
              0.5 * Math.log(secondValue / firstValue),
              -MAX_LOG_SAMPLE,
              MAX_LOG_SAMPLE,
            );
            const firstSlot = firstBlock * 3 + channel;
            const secondSlot = secondBlock * 3 + channel;
            firstState.logSums[firstSlot] += logRatio;
            secondState.logSums[secondSlot] -= logRatio;
            firstState.counts[firstSlot] += 1;
            secondState.counts[secondSlot] += 1;
          }
        }
      }
    }
  }

  return states.map((state) => {
    const blockCount = state.gridWidth * state.gridHeight;
    const channelLogs: Float32Array[] = [];
    for (let channel = 0; channel < 3; channel += 1) {
      const values = new Float32Array(blockCount);
      const observed = new Uint8Array(blockCount);
      for (let block = 0; block < blockCount; block += 1) {
        const slot = block * 3 + channel;
        const count = state.counts[slot]!;
        if (count >= MIN_BLOCK_SAMPLES) {
          values[block] = state.logSums[slot]! / count;
          observed[block] = 1;
        }
      }
      channelLogs.push(smoothObservedGrid(values, observed, state.gridWidth, state.gridHeight));
    }

    const data = new Float32Array(blockCount * 3);
    for (let block = 0; block < blockCount; block += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        data[block * 3 + channel] = clamp(
          Math.exp(channelLogs[channel]![block]!),
          MIN_GAIN,
          MAX_GAIN,
        );
      }
    }
    return { width: state.gridWidth, height: state.gridHeight, data };
  });
}


export function samplePanoramaGainBgrInto(
  map: PanoramaGainMap,
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
  output: Float32Array,
): void {
  if (output.length < 3) throw new Error("Panorama gain sample output must have three channels.");
  if (map.width <= 1 && map.height <= 1) {
    output[0] = map.data[0] ?? 1;
    output[1] = map.data[1] ?? 1;
    output[2] = map.data[2] ?? 1;
    return;
  }
  const gx = clamp(((x + 0.5) * map.width / Math.max(1, imageWidth)) - 0.5, 0, map.width - 1);
  const gy = clamp(((y + 0.5) * map.height / Math.max(1, imageHeight)) - 0.5, 0, map.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  for (let channel = 0; channel < 3; channel += 1) {
    const v00 = map.data[(y0 * map.width + x0) * 3 + channel] ?? 1;
    const v10 = map.data[(y0 * map.width + x1) * 3 + channel] ?? 1;
    const v01 = map.data[(y1 * map.width + x0) * 3 + channel] ?? 1;
    const v11 = map.data[(y1 * map.width + x1) * 3 + channel] ?? 1;
    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    output[channel] = top + (bottom - top) * fy;
  }
}

export function samplePanoramaGainBgr(
  map: PanoramaGainMap,
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
  channel: number,
): number {
  if (map.width <= 1 && map.height <= 1) return map.data[channel] ?? 1;
  const gx = clamp(((x + 0.5) * map.width / Math.max(1, imageWidth)) - 0.5, 0, map.width - 1);
  const gy = clamp(((y + 0.5) * map.height / Math.max(1, imageHeight)) - 0.5, 0, map.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const v00 = map.data[(y0 * map.width + x0) * 3 + channel] ?? 1;
  const v10 = map.data[(y0 * map.width + x1) * 3 + channel] ?? 1;
  const v01 = map.data[(y1 * map.width + x0) * 3 + channel] ?? 1;
  const v11 = map.data[(y1 * map.width + x1) * 3 + channel] ?? 1;
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

export function applyPanoramaGainBgrInPlace(
  bgr: Float32Array,
  width: number,
  height: number,
  map: PanoramaGainMap,
): void {
  if (bgr.length < width * height * 3) {
    throw new Error("Panorama gain application received an invalid pixel buffer.");
  }
  const gains = new Float32Array(3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      samplePanoramaGainBgrInto(map, x, y, width, height, gains);
      bgr[offset] *= gains[0]!;
      bgr[offset + 1] *= gains[1]!;
      bgr[offset + 2] *= gains[2]!;
    }
  }
}
