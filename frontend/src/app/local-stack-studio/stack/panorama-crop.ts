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
