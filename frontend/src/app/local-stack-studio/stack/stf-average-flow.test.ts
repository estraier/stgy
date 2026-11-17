import { buildStfAverageFlow } from "./stf-average-flow";

function field(width: number, height: number, dx: number, dy = 0): Float32Array {
  const flow = new Float32Array(width * height * 2);
  for (let p = 0; p < width * height; p++) {
    flow[2 * p] = dx;
    flow[2 * p + 1] = dy;
  }
  return flow;
}
function at(flow: Float32Array, width: number, x: number, y: number) {
  const i = (y * width + x) * 2;
  return { x: flow[i], y: flow[i + 1] };
}

test("three consistent radius-normalized fields retain the original displacement", () => {
  const average = buildStfAverageFlow([
    { flow: field(50, 12, 4, -2), radiusSpan: 0.1 },
    { flow: field(50, 12, 2, -1), radiusSpan: 0.05 },
    { flow: field(50, 12, 1, -0.5), radiusSpan: 0.025 },
  ], 50, 12);
  expect(at(average, 50, 20, 6).x).toBeCloseTo(4, 5);
  expect(at(average, 50, 20, 6).y).toBeCloseTo(-2, 5);
});

test("disagreeing field is still blended by equal-weight averaging", () => {
  const average = buildStfAverageFlow([
    { flow: field(70, 16, 8), radiusSpan: 0.1 },
    { flow: field(70, 16, 2), radiusSpan: 0.05 },
    { flow: field(70, 16, 1), radiusSpan: 0.025 },
  ], 70, 16);
  expect(at(average, 70, 20, 8).x).toBeCloseTo(16 / 3, 5);
});

test("average may increase extrapolation magnitude when outer pair underestimates", () => {
  const average = buildStfAverageFlow([
    { flow: field(60, 12, 1), radiusSpan: 0.1 },
    { flow: field(60, 12, 2), radiusSpan: 0.05 },
    { flow: field(60, 12, 1), radiusSpan: 0.025 },
  ], 60, 12);
  expect(at(average, 60, 18, 6).x).toBeCloseTo(3, 5);
});

test("sampling follows the transported point through both neighboring fields", () => {
  const width = 40, height = 12;
  const first = field(width, height, 2);
  const second = field(width, height, 0);
  const third = field(width, height, 0);
  for (let y = 0; y < height; y++) {
    second[(y * width + 13) * 2] = 4;
    third[(y * width + 17) * 2] = 9;
  }
  const avg = buildStfAverageFlow([
    { flow: first, radiusSpan: 1 }, { flow: second, radiusSpan: 1 },
    { flow: third, radiusSpan: 1 },
  ], width, height);
  expect(at(avg, width, 11, 6).x).toBeCloseTo(5, 5);
});

test("one pair preserves the base field and two pairs are averaged equally", () => {
  const first = field(20, 10, 5);
  const second = field(20, 10, 2);
  expect(buildStfAverageFlow([{ flow: first, radiusSpan: 1 }], 20, 10)).toBe(first);
  const avgTwo = buildStfAverageFlow([
    { flow: first, radiusSpan: 1 }, { flow: second, radiusSpan: 1 },
  ], 20, 10);
  expect(at(avgTwo, 20, 10, 5).x).toBeCloseTo(3.5, 5);
  const avgThree = buildStfAverageFlow([
    { flow: first, radiusSpan: 1 }, { flow: second, radiusSpan: 1 },
    { flow: field(20, 10, 1), radiusSpan: 1 },
  ], 20, 10);
  expect(at(avgThree, 20, 19, 5).x).toBeCloseTo(5, 5);
});

test("invalid aperture spans and nonfinite displacement cannot propagate to output", () => {
  expect(() => buildStfAverageFlow([{ flow: field(10, 10, 1), radiusSpan: 0 }], 10, 10)).toThrow();
  const first = field(20, 10, 1);
  first[(5 * 20 + 7) * 2] = Number.NaN;
  const avg = buildStfAverageFlow([
    { flow: first, radiusSpan: 1 },
    { flow: field(20, 10, 1), radiusSpan: 1 },
    { flow: field(20, 10, 1), radiusSpan: 1 },
  ], 20, 10);
  expect(at(avg, 20, 7, 5).x).toBe(0);
  expect(at(avg, 20, 7, 5).y).toBe(0);
});
