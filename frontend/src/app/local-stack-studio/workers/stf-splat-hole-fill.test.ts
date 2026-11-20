import {
  fillStfSplatHole,
  STF_SPLAT_HOLE_NEIGHBOR_BUCKET_COUNT,
  STF_SPLAT_HOLE_SEARCH_BUCKET_COUNT,
} from "./stf-splat-hole-fill";

function createScene(width = 21, height = 21, x = 10, y = 10) {
  const weights = new Float32Array(width * height);
  const accum = new Float32Array(width * height * 3);
  const output = new Uint16Array(width * height * 3).fill(9999);
  const searchCounts = new Array<number>(STF_SPLAT_HOLE_SEARCH_BUCKET_COUNT).fill(0);
  const neighborsUsedCounts = new Array<number>(STF_SPLAT_HOLE_NEIGHBOR_BUCKET_COUNT).fill(0);
  const pixel = y * width + x;
  function cover(dx: number, dy: number, color: number, weight = 1) {
    const neighbor = (y + dy) * width + x + dx;
    weights[neighbor] = weight;
    accum[neighbor * 3] = color * weight;
    accum[neighbor * 3 + 1] = (color + 100) * weight;
    accum[neighbor * 3 + 2] = (color + 200) * weight;
  }
  function fill() {
    return fillStfSplatHole(output, pixel, width, height, weights, accum,
      searchCounts, neighborsUsedCounts);
  }
  return { weights, accum, output, searchCounts, neighborsUsedCounts, pixel, cover, fill };
}

test("the four original cardinal neighbors take priority and average normalized RGB16", () => {
  const scene = createScene();
  scene.cover(0, -1, 1000, 2);
  scene.cover(-1, 0, 2000, 0.5);
  scene.cover(1, 0, 3000, 4);
  scene.cover(0, 1, 4000, 1);
  scene.cover(-1, -1, 32000); // diagonal ignored when any cardinal neighbor is covered
  expect(scene.fill()).toBe(true);
  expect(Array.from(scene.output.subarray(scene.pixel * 3, scene.pixel * 3 + 3)))
    .toEqual([2500, 2600, 2700]);
  expect(scene.searchCounts[1]).toBe(1);
  expect(scene.neighborsUsedCounts[4]).toBe(1);
});

test("the diagonal four are searched only after all cardinals fail", () => {
  const scene = createScene();
  scene.cover(-1, -1, 1500);
  scene.cover(1, -1, 2500);
  scene.cover(-1, 1, 3500);
  scene.cover(1, 1, 4500);
  scene.cover(0, -2, 65000); // greater radius must not pollute the average
  expect(scene.fill()).toBe(true);
  expect(scene.output[scene.pixel * 3]).toBe(3000);
  expect(scene.searchCounts[2]).toBe(1);
  expect(scene.neighborsUsedCounts[4]).toBe(1);
});

test.each([2, 3, 4, 5, 6, 7, 8])(
  "an uncovered center is filled from the nearest nonempty square ring r=%i", (radius) => {
    const scene = createScene();
    scene.cover(-radius, 0, 1200);
    scene.cover(radius, -radius, 2800);
    if (radius < 8) scene.cover(radius + 1, 0, 30000); // outer ring ignored
    expect(scene.fill()).toBe(true);
    expect(scene.output[scene.pixel * 3]).toBe(2000);
    expect(scene.searchCounts[radius + 1]).toBe(1);
    expect(scene.neighborsUsedCounts[2]).toBe(1);
    expect(scene.searchCounts.reduce((sum, count) => sum + count, 0)).toBe(1);
  },
);

test("radius-8 ring visits all 64 distinct neighbors and averages them once", () => {
  const scene = createScene();
  for (let dx = -8; dx <= 8; dx++) {
    scene.cover(dx, -8, 1000);
    scene.cover(dx, 8, 1000);
  }
  for (let dy = -7; dy <= 7; dy++) {
    scene.cover(-8, dy, 1000);
    scene.cover(8, dy, 1000);
  }
  expect(scene.fill()).toBe(true);
  expect(scene.searchCounts[9]).toBe(1);
  expect(scene.neighborsUsedCounts[64]).toBe(1);
  expect(scene.output[scene.pixel * 3]).toBe(1000);
});

test("the radius-8 limit is strict; unavailable neighbors leave output for source fallback", () => {
  const scene = createScene();
  scene.cover(9, 0, 2000);
  expect(scene.fill()).toBe(false);
  expect(scene.output[scene.pixel * 3]).toBe(9999);
  expect(scene.searchCounts[0]).toBe(1);
  expect(scene.neighborsUsedCounts[0]).toBe(1);
});

test("at an image corner, out-of-bounds pixels do not contribute", () => {
  const scene = createScene(5, 5, 0, 0);
  scene.cover(2, 0, 1000);
  scene.cover(0, 2, 3000);
  expect(scene.fill()).toBe(true);
  expect(scene.output[scene.pixel * 3]).toBe(2000);
  expect(scene.searchCounts[3]).toBe(1);
  expect(scene.neighborsUsedCounts[2]).toBe(1);
});

test("filled colors cannot become candidates in subsequent calls", () => {
  const scene = createScene();
  scene.cover(2, 0, 1500);
  // This pixel is not covered by FS but already has a nonzero value in the
  // mutable output. It MUST NOT enter the average for the actual hole.
  scene.output[(scene.pixel + 1) * 3] = 60000;
  expect(scene.fill()).toBe(true);
  expect(scene.output[scene.pixel * 3]).toBe(1500);
  expect(scene.searchCounts[3]).toBe(1);
});


test("ring hole filling reads an offset destination band without using filled neighbors", () => {
  const width = 7;
  const height = 30;
  const startY = 9;
  const bandRows = 15;
  const weights = new Float32Array(width * bandRows);
  const accum = new Float32Array(width * bandRows * 3);
  const output = new Uint16Array(3);
  const search = new Array<number>(STF_SPLAT_HOLE_SEARCH_BUCKET_COUNT).fill(0);
  const neighbors = new Array<number>(STF_SPLAT_HOLE_NEIGHBOR_BUCKET_COUNT).fill(0);
  const globalY = 15;
  const globalX = 3;
  const pixel = globalY * width + globalX;
  const covered = (globalY - 1 - startY) * width + globalX;
  weights[covered] = 2;
  accum[covered * 3] = 8000;
  accum[covered * 3 + 1] = 12000;
  accum[covered * 3 + 2] = 16000;
  expect(fillStfSplatHole(output, pixel, width, height, weights, accum,
    search, neighbors, pixel, startY * width)).toBe(true);
  expect(Array.from(output)).toEqual([4000, 6000, 8000]);
  expect(search[1]).toBe(1);
  expect(neighbors[1]).toBe(1);
});
