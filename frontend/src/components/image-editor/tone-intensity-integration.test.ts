import {
  applyScaledLogLinear,
  toneLinearIntensity,
} from "@/image/tone";
import {
  buildImageMixerLut,
  IMAGE_MIXER_SETTING_COUNT,
} from "./mixer-lut";
import {
  applyFilmSimulationCoreLinearRgb,
  compileFilmSimulation,
} from "./film-simulation-core";
import type { FilmSimulationParams } from "./film-simulation-params";
import { applySharpenToRgb16 } from "./sharpen";
import {
  RAW_DEVELOPED_LINEAR_RANGE_MAX,
  applyRawMatchedTonePass,
} from "./raw-development-core";
import {
  decodeStoredRgb16Channel,
  encodeStoredRgb16Channel,
} from "./sampling";

describe("shared 3:5:2 editor tone intensity", () => {
  test("Mixer hue edits restore 3:5:2 intensity instead of ProPhoto XYZ-Y", () => {
    const settings = new Float32Array(IMAGE_MIXER_SETTING_COUNT);
    // Primary mixer starts after 12 H/S/L triplets. Blue primary is index 2.
    settings[36 + 2 * 3] = 50;
    const lut = buildImageMixerLut(settings);

    // Exact LUT vertex for linear ProPhoto blue (0, 0, 1).
    const offset = 31 * 3;
    const r = Math.pow(lut.data[offset] ?? 0, 2);
    const g = Math.pow(lut.data[offset + 1] ?? 0, 2);
    const b = Math.pow(lut.data[offset + 2] ?? 0, 2);

    expect(toneLinearIntensity(r, g, b)).toBeCloseTo(0.2, 5);
    expect(b).toBeGreaterThan(0.5);
  });

  test("Film Simulation tone curve uses the same 3:5:2 intensity axis", () => {
    const params: FilmSimulationParams = {
      primary: {
        redHue: 0,
        redSaturation: 0,
        greenHue: 0,
        greenSaturation: 0,
        blueHue: 0,
        blueSaturation: 0,
      },
      hslHue: new Array(8).fill(0),
      hslSaturation: new Array(8).fill(0),
      hslLuminance: new Array(8).fill(0),
      globalSaturation: 0,
      vibrance: 0,
      shadowTint: 0,
      toneCurve: [[0, 0], [0.1, 0.15], [1, 1]],
    };
    const output = applyFilmSimulationCoreLinearRgb(
      0,
      0,
      0.5,
      compileFilmSimulation(params),
    );

    expect(output[0]).toBeCloseTo(0, 12);
    expect(output[1]).toBeCloseTo(0, 12);
    expect(output[2]).toBeCloseTo(0.75, 10);
    expect(toneLinearIntensity(...output)).toBeCloseTo(0.15, 10);
  });

  test("Sharpen sees saturated ProPhoto blue structure on the 3:5:2 axis", () => {
    const blue = encodeStoredRgb16Channel(0.5, "gamma20", 1);
    const data = new Uint16Array([
      0, 0, 0,
      0, 0, blue,
      0, 0, 0,
    ]);

    applySharpenToRgb16(data, 3, 1, 2);
    const centerBlue = decodeStoredRgb16Channel(data[5] ?? 0, "gamma20", 1);

    expect(centerBlue).toBeGreaterThan(0.5);
  });

  test("RAW matched tone applies nonlinear tone on the 3:5:2 axis", () => {
    const data = new Uint16Array([0, 0, Math.round(0.5 * 65535)]);
    applyRawMatchedTonePass(
      data,
      1,
      1,
      1,
      undefined,
      {
        gain: 1,
        scaledLog: 5,
        sigmoid: 0,
        toneSlopeAtWhite: 1,
        rolloff: null,
      },
      "linear",
    );

    const blue = decodeStoredRgb16Channel(
      data[2] ?? 0,
      "gamma20",
      RAW_DEVELOPED_LINEAR_RANGE_MAX,
    );
    const expectedIntensity = applyScaledLogLinear(0.2 * 0.5, 5);
    expect(0.2 * blue).toBeCloseTo(expectedIntensity, 4);
  });
});
