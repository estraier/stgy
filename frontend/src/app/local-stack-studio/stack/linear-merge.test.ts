import {
  mergeLinearFloatIntoAccumulator,
  percentileFromLinearFloatArray,
} from "./linear-merge";

// Reference calculation retained in tests only: the production Blend path
// computes its rolloff percentile directly from each stripe when needed.
function historicalExposureRolloffMaxP998AfterGain(linear: Float32Array, gain: number): number | null {
  if (!(Number.isFinite(gain) && gain > 1)) return null;
  const maxima = new Float32Array(linear.length / 3);
  for (let pixel = 0, sourceIndex = 0; pixel < maxima.length; pixel++, sourceIndex += 3) {
    maxima[pixel] = Math.max(linear[sourceIndex] * gain,
      linear[sourceIndex + 1] * gain, linear[sourceIndex + 2] * gain);
  }
  const sorted = Array.from(maxima).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.998))];
}

function mergeFull(
  images: Float32Array[],
  gains: Float32Array,
  weights: Float32Array,
  maxAfterGain: Array<number | null>,
): Float32Array {
  const output = new Float32Array(images[0].length);
  for (let i = 0; i < images.length; i += 1) {
    mergeLinearFloatIntoAccumulator(images[i], output, gains[i], weights[i], null, maxAfterGain[i]);
  }
  return output;
}

function mergeByRows(
  images: Float32Array[],
  width: number,
  height: number,
  stripeRows: number,
  gains: Float32Array,
  weights: Float32Array,
  maxAfterGain: Array<number | null>,
): Float32Array {
  const output = new Float32Array(images[0].length);
  const rowLength = width * 3;
  for (let y = 0; y < height; y += stripeRows) {
    const rows = Math.min(stripeRows, height - y);
    const start = y * rowLength;
    const end = (y + rows) * rowLength;
    const stripe = new Float32Array(end - start);
    for (let i = 0; i < images.length; i += 1) {
      mergeLinearFloatIntoAccumulator(
        images[i].slice(start, end),
        stripe,
        gains[i],
        weights[i],
        null,
        maxAfterGain[i],
      );
    }
    output.set(stripe, start);
  }
  return output;
}

describe("linear merge stripe equivalence", () => {
  test("Blend remains bit-identical when split into stripes", () => {
    const width = 7;
    const height = 9;
    const length = width * height * 3;
    const images = [0, 1, 2].map((imageIndex) => {
      const data = new Float32Array(length);
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.fround(((i * 37 + imageIndex * 53) % 997) / 997 * 1.7);
      }
      return data;
    });
    const gains = new Float32Array([1, 1, 1]);
    const weights = new Float32Array([1 / 3, 1 / 3, 1 / 3]);
    const maxAfterGain = [null, null, null];
    expect(mergeByRows(images, width, height, 2, gains, weights, maxAfterGain)).toEqual(
      mergeFull(images, gains, weights, maxAfterGain),
    );
  });


  test("precomputed STF P99.8 reproduces the historical full-image rolloff", () => {
    const length = 97 * 3;
    const source = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      source[i] = Math.fround(((i * 79 + 17) % 401) / 401 * 2.3);
    }
    const gain = Math.fround(1.37);
    const weight = Math.fround(0.42);
    const historical = new Float32Array(length);
    mergeLinearFloatIntoAccumulator(source, historical, gain, weight);
    const precomputed = new Float32Array(length);
    mergeLinearFloatIntoAccumulator(
      source,
      precomputed,
      gain,
      weight,
      null,
      historicalExposureRolloffMaxP998AfterGain(source, gain),
    );
    expect(precomputed).toEqual(historical);
  });


  test("authoritative post-gain P99.8 of zero does not become stripe-local", () => {
    const width = 10;
    const height = 10;
    const length = width * height * 3;
    const source = new Float32Array(length);
    // Fewer than 0.2% bright pixels is impossible at this tiny size, so emulate
    // the important branch directly: a global override of zero must remain
    // authoritative for every stripe.
    source[length - 3] = 4;
    source[length - 2] = 3;
    source[length - 1] = 2;
    const gain = Math.fround(1.5);
    const weight = Math.fround(1);
    const full = new Float32Array(length);
    mergeLinearFloatIntoAccumulator(source, full, gain, weight, null, 0);
    const striped = mergeByRows(
      [source],
      width,
      height,
      1,
      new Float32Array([gain]),
      new Float32Array([weight]),
      [0],
    );
    expect(striped).toEqual(full);
  });

  test("STF remains bit-identical with global P99.8 values", () => {
    const width = 11;
    const height = 13;
    const length = width * height * 3;
    const images = [0, 1, 2, 3].map((imageIndex) => {
      const data = new Float32Array(length);
      for (let i = 0; i < length; i += 1) {
        const base = ((i * 101 + imageIndex * 61) % 1543) / 1543;
        data[i] = Math.fround(base * (1.1 + imageIndex * 0.37));
      }
      return data;
    });
    const gains = new Float32Array([1.35, 0.82, 1.18, 0.73]);
    const weights = new Float32Array([0.15, 0.25, 0.35, 0.25]);
    const maxAfterGain = images.map((image, index) => gains[index] > 1
      ? historicalExposureRolloffMaxP998AfterGain(image, gains[index])
      : null);
    expect(mergeByRows(images, width, height, 3, gains, weights, maxAfterGain)).toEqual(
      mergeFull(images, gains, weights, maxAfterGain),
    );
  });
});


describe("Blend percentile selection", () => {
  const historical = (values: Float32Array, q: number): number => {
    if (values.length === 0) return 0;
    const sorted = Array.from(values).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))];
  };

  test("preserves exact percentiles over random, tied, and monotone Float32 samples", () => {
    let state = 0x12345678;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) | 0;
      return (state >>> 0) / 4294967296;
    };
    for (const count of [0, 1, 2, 3, 9, 32, 4096, 65536]) {
      const source = Float32Array.from({ length: count }, (_, i) =>
        Math.fround((next() - 0.4) * 4 + (i % 11 === 0 ? 2 : 0)));
      const tied = Float32Array.from({ length: count }, (_, i) => i % 5 === 0 ? 1 : 0);
      const monotone = Float32Array.from({ length: count }, (_, i) => i / Math.max(1, count));
      for (const values of [source, tied, monotone]) {
        const original = values.slice();
        for (const q of [0, 0.5, 0.98, 0.998, 1]) {
          expect(percentileFromLinearFloatArray(values, q)).toBe(historical(values, q));
        }
        expect(values).toEqual(original); // The caller's source buffer is never sorted.
      }
    }
  });

  test("preserves historical ordering for non-finite values and negative zero", () => {
    const exceptional = [
      new Float32Array([1, NaN, 4, 2, NaN, 3]),
      new Float32Array([-0, 0, -0, 0, 1, -1]),
      new Float32Array([Infinity, 3, -Infinity, 2, Infinity]),
    ];
    for (const values of exceptional) {
      for (const q of [0, 0.25, 0.5, 0.998, 1]) {
        expect(Object.is(percentileFromLinearFloatArray(values, q), historical(values, q))).toBe(true);
      }
    }
  });
});
