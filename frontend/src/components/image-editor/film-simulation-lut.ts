import { clamp01 } from "@/image/tone";
import {
  FILM_SIMULATION_PARAMS,
  type FilmSimulationPreset,
} from "./film-simulation-params";
import {
  applyFilmSimulationCoreLinearRgb,
  compileFilmSimulation,
} from "./film-simulation-core";

export const FILM_SIMULATION_LUT_SIZE = 32;
const LUT_CHANNELS = 3;

export type FilmSimulationLut = {
  preset: FilmSimulationPreset;
  size: number;
  data: Float32Array;
};

function lutOffset(size: number, r: number, g: number, b: number): number {
  return ((r * size + g) * size + b) * LUT_CHANNELS;
}

function addVertex(
  lut: FilmSimulationLut,
  r: number,
  g: number,
  b: number,
  weight: number,
  out: number[],
): void {
  if (weight === 0) return;
  const offset = lutOffset(lut.size, r, g, b);
  out[0] = (out[0] ?? 0) + (lut.data[offset] ?? 0) * weight;
  out[1] = (out[1] ?? 0) + (lut.data[offset + 1] ?? 0) * weight;
  out[2] = (out[2] ?? 0) + (lut.data[offset + 2] ?? 0) * weight;
}

function sampleEncodedTetrahedral(
  lut: FilmSimulationLut,
  encodedR: number,
  encodedG: number,
  encodedB: number,
  out: number[],
): void {
  const size = lut.size;
  const maxIndex = size - 1;
  const xr = clamp01(encodedR) * maxIndex;
  const xg = clamp01(encodedG) * maxIndex;
  const xb = clamp01(encodedB) * maxIndex;
  const r0 = Math.min(maxIndex - 1, Math.floor(xr));
  const g0 = Math.min(maxIndex - 1, Math.floor(xg));
  const b0 = Math.min(maxIndex - 1, Math.floor(xb));
  const fr = xr - r0;
  const fg = xg - g0;
  const fb = xb - b0;
  const r1 = r0 + 1;
  const g1 = g0 + 1;
  const b1 = b0 + 1;

  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (fr >= fg) {
    if (fg >= fb) {
      addVertex(lut, r0, g0, b0, 1 - fr, out);
      addVertex(lut, r1, g0, b0, fr - fg, out);
      addVertex(lut, r1, g1, b0, fg - fb, out);
      addVertex(lut, r1, g1, b1, fb, out);
    } else if (fr >= fb) {
      addVertex(lut, r0, g0, b0, 1 - fr, out);
      addVertex(lut, r1, g0, b0, fr - fb, out);
      addVertex(lut, r1, g0, b1, fb - fg, out);
      addVertex(lut, r1, g1, b1, fg, out);
    } else {
      addVertex(lut, r0, g0, b0, 1 - fb, out);
      addVertex(lut, r0, g0, b1, fb - fr, out);
      addVertex(lut, r1, g0, b1, fr - fg, out);
      addVertex(lut, r1, g1, b1, fg, out);
    }
  } else if (fr >= fb) {
    addVertex(lut, r0, g0, b0, 1 - fg, out);
    addVertex(lut, r0, g1, b0, fg - fr, out);
    addVertex(lut, r1, g1, b0, fr - fb, out);
    addVertex(lut, r1, g1, b1, fb, out);
  } else if (fg >= fb) {
    addVertex(lut, r0, g0, b0, 1 - fg, out);
    addVertex(lut, r0, g1, b0, fg - fb, out);
    addVertex(lut, r0, g1, b1, fb - fr, out);
    addVertex(lut, r1, g1, b1, fr, out);
  } else {
    addVertex(lut, r0, g0, b0, 1 - fb, out);
    addVertex(lut, r0, g0, b1, fb - fg, out);
    addVertex(lut, r0, g1, b1, fg - fr, out);
    addVertex(lut, r1, g1, b1, fr, out);
  }
}

export function buildFilmSimulationLut(preset: FilmSimulationPreset): FilmSimulationLut {
  const size = FILM_SIMULATION_LUT_SIZE;
  const data = new Float32Array(size * size * size * LUT_CHANNELS);
  const maxIndex = size - 1;
  const compiled = compileFilmSimulation(FILM_SIMULATION_PARAMS[preset]);
  let offset = 0;
  for (let ri = 0; ri < size; ri += 1) {
    const encodedR = ri / maxIndex;
    const r = encodedR * encodedR;
    for (let gi = 0; gi < size; gi += 1) {
      const encodedG = gi / maxIndex;
      const g = encodedG * encodedG;
      for (let bi = 0; bi < size; bi += 1) {
        const encodedB = bi / maxIndex;
        const b = encodedB * encodedB;
        const [rr, gg, bb] = applyFilmSimulationCoreLinearRgb(r, g, b, compiled);
        data[offset] = Math.sqrt(clamp01(rr));
        data[offset + 1] = Math.sqrt(clamp01(gg));
        data[offset + 2] = Math.sqrt(clamp01(bb));
        offset += LUT_CHANNELS;
      }
    }
  }
  return { preset, size, data };
}

const simulationLutCache = new Map<FilmSimulationPreset, FilmSimulationLut>();

export function getOrBuildFilmSimulationLut(preset: FilmSimulationPreset): FilmSimulationLut {
  const cached = simulationLutCache.get(preset);
  if (cached?.size === FILM_SIMULATION_LUT_SIZE) return cached;
  const built = buildFilmSimulationLut(preset);
  simulationLutCache.set(preset, built);
  return built;
}

export function sampleFilmSimulationLutLinearInto(
  lut: FilmSimulationLut,
  r: number,
  g: number,
  b: number,
  out: number[],
): void {
  const encodedR = Math.sqrt(clamp01(r));
  const encodedG = Math.sqrt(clamp01(g));
  const encodedB = Math.sqrt(clamp01(b));
  sampleEncodedTetrahedral(lut, encodedR, encodedG, encodedB, out);
  out[0] = Math.max(0, (out[0] ?? 0) * (out[0] ?? 0));
  out[1] = Math.max(0, (out[1] ?? 0) * (out[1] ?? 0));
  out[2] = Math.max(0, (out[2] ?? 0) * (out[2] ?? 0));
}
