import { stfSplatCompressionWeight } from "./stf-splat-geometry";

test("production one-pass priority retains exactly the adopted Compression 2 formula", () => {
  for (const distance of [0, 0.25, 0.5, 1, 4, 8, 64, 100000]) {
    const expected = Math.exp(2 * Math.max(0, distance - 0.5) / (1.5 + 0.1 * distance));
    expect(stfSplatCompressionWeight(distance)).toBeCloseTo(expected, 12);
  }
  expect(stfSplatCompressionWeight(4)).toBeGreaterThan(stfSplatCompressionWeight(1));
  expect(stfSplatCompressionWeight(0)).toBe(1);
  expect(stfSplatCompressionWeight(0.5)).toBe(1);
});

test("production priority is finite for valid large Flow and zero for invalid displacement", () => {
  expect(Number.isFinite(stfSplatCompressionWeight(1_000_000))).toBe(true);
  for (const displacement of [-1, NaN, Infinity, -Infinity]) {
    expect(stfSplatCompressionWeight(displacement)).toBe(0);
  }
});

test("geometric weighting yields symmetric bright/dark collisions", () => {
  const moving = stfSplatCompressionWeight(4);
  const stationary = stfSplatCompressionWeight(0);
  const bright = (1000 * stationary) / (stationary + moving);
  const inverted = (1000 * moving) / (stationary + moving);
  expect(bright + inverted).toBeCloseTo(1000, 10);
  expect(moving).toBeGreaterThan(stationary);
});
