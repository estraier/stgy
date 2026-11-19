import { isStfFarnebackWinsize, stfPairFarnebackWinsize,
  STF_FARNEBACK_BASE_WINSIZE } from "./stf-farneback-winsize";

const f = Array.from({ length: 7 }, (_, i) => 2 * 2 ** (i / 6));
const windows = () => f.slice(0, -1).map((low, i) =>
  stfPairFarnebackWinsize(f[0], f[1], low, f[i + 1]));

test("fixed 31 + F-dependent window matches the previously adopted settings", () => {
  expect(STF_FARNEBACK_BASE_WINSIZE).toBe(31);
  expect(windows()).toEqual([31, 29, 25, 23, 19, 17]);
});

test("window validation protects the Flow worker protocol", () => {
  for (const size of [11, 17, 19, 25, 29, 31]) {
    expect(isStfFarnebackWinsize(size)).toBe(true);
  }
  for (const size of [0, 3, 7, 10, 22, 32, 41, 50, 51, 101, 201, 202, 203, 31.5, NaN, Infinity]) {
    expect(isStfFarnebackWinsize(size)).toBe(false);
  }
});

test("wide or narrow F gaps adjust the fixed window within 11..31", () => {
  expect(stfPairFarnebackWinsize(2, 2.25, 2, 2.25)).toBe(31);
  expect(stfPairFarnebackWinsize(2, 2.25, 2.25, 2.75)).toBe(31);
  expect(stfPairFarnebackWinsize(2, 2.25, 4, 4.00001)).toBe(11);
  const narrow = stfPairFarnebackWinsize(2, 2.25, 2.25, 2.50);
  const wide = stfPairFarnebackWinsize(2, 2.25, 2.25, 2.75);
  expect(narrow).toBeLessThan(wide);
  expect(() => stfPairFarnebackWinsize(2, 2.25, 2.5, 2.25)).toThrow();
  expect(() => stfPairFarnebackWinsize(2, 2.25, 0, 2.25)).toThrow();
});
