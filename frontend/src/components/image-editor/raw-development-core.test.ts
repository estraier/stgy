import {
  applyRawColorPass,
  applyRawFallbackBaselinePass,
  applyRawMatchedTonePass,
  convertRawLinearToGamma20InPlace,
} from "./raw-development-core";

function fnv1a16(values: Uint16Array): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= (value >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function makeFixture() {
  const width = 23;
  const height = 17;
  const data = new Uint16Array(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = (i * 12347) % 65536;
  const vignetting = {
    gridWidth: 4,
    gridHeight: 3,
    step: 8,
    data: new Float32Array(4 * 3 * 3),
  };
  for (let i = 0; i < vignetting.data.length; i++) {
    vignetting.data[i] = 0.8 + (i % 7) * 0.05;
  }
  return { width, height, data, vignetting };
}

describe("RAW development hot-loop characterization", () => {
  test("stores the matched-tone result directly as gamma20 Uint16", () => {
    const fixture = makeFixture();
    const data = new Uint16Array(fixture.data);
    const headroom = applyRawMatchedTonePass(
      data,
      fixture.width,
      fixture.height,
      1,
      fixture.vignetting,
      { gain: 1.23, scaledLog: 0.7, sigmoid: -0.6, toneSlopeAtWhite: 0.82 },
    );
    expect(fnv1a16(data)).toBe("4d707378");
    expect(headroom.bins).toEqual([
      0, 0, 0, 0, 0, 5, 41, 28, 41, 61,
      72, 71, 48, 19, 5, 0, 0, 0, 0, 0,
    ]);
    expect(headroom.maxRgb).toBeCloseTo(1.4372515896129021, 14);
  });

  test("keeps the color pass in gamma20 Uint16", () => {
    const fixture = makeFixture();
    const data = new Uint16Array(fixture.data);
    applyRawMatchedTonePass(
      data,
      fixture.width,
      fixture.height,
      1,
      fixture.vignetting,
      { gain: 1.23, scaledLog: 0.7, sigmoid: -0.6, toneSlopeAtWhite: 0.82 },
    );
    applyRawColorPass(data, 2, {
      rolloff: { inflection: 0.75, scale: 0.2 },
      hasSaturation: true,
      hasVibrance: true,
      saturationFactor: 1.15,
      vibranceFactor: 0.3,
      saturationRolloff: { inflection: 0.8, scale: 0.25 },
    });
    expect(fnv1a16(data)).toBe("91e9f6c0");
  });

  test("still converts untouched linear fallback data to gamma20", () => {
    const data = new Uint16Array([0, 16384, 32768, 65535]);
    convertRawLinearToGamma20InPlace(data, 2);
    expect(Array.from(data)).toEqual([0, 32768, 46341, 65535]);
  });

  test("stores the fallback baseline result directly as gamma20 Uint16", () => {
    const fixture = makeFixture();
    const data = new Uint16Array(fixture.data);
    const result = applyRawFallbackBaselinePass(
      data,
      fixture.width,
      fixture.height,
      1,
      fixture.vignetting,
    );
    expect(result).not.toBeNull();
    expect(fnv1a16(data)).toBe("1fec0a4a");
    expect(result?.exposureEv).toBeCloseTo(0.17376055157331727, 14);
    expect(result?.headroom.maxRgb).toBeCloseTo(1.1909830314689662, 14);
    expect(result?.plan.rolloff).toBeNull();
  });

  test("uses the full 0..2 RAW headroom for fallback rolloff", () => {
    const width = 1000;
    const data = new Uint16Array(width * 3);
    const low = Math.round(0.1 * 65535);
    for (let x = 0; x < width; x++) {
      const value = x < 990 ? low : 65535;
      const i = x * 3;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }

    const result = applyRawFallbackBaselinePass(data, width, 1, 1, undefined);
    expect(result).not.toBeNull();
    expect(result?.plan.factor).toBeCloseTo(8.999313396399145, 12);
    expect(result?.plan.rolloff?.inflection).toBeCloseTo(1.2844670182046447, 12);
    expect(result?.plan.rolloff?.scale).toBeCloseTo(0.09274752262990468, 12);
    expect(result?.headroom.maxRgb).toBeCloseTo(1.9999999072524774, 12);
  });
});
