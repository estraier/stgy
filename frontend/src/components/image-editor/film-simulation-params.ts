export type FilmSimulationPreset = "provia" | "velvia" | "astia" | "eterna" | "classic-chrome";

export type FilmSimulationPrimaryParams = {
  redHue: number;
  redSaturation: number;
  greenHue: number;
  greenSaturation: number;
  blueHue: number;
  blueSaturation: number;
};

export type FilmSimulationParams = {
  primary: FilmSimulationPrimaryParams;
  hslHue: readonly number[];
  hslSaturation: readonly number[];
  hslLuminance: readonly number[];
  globalSaturation: number;
  vibrance: number;
  shadowTint: number;
  toneCurve: readonly (readonly [number, number])[];
};

const PROVIA_TONE_CURVE = [
  [0, 0],
  [5 / 255, 0.015],
  [0.05, 0.040],
  [0.10, 0.085],
  [0.18, 0.180],
  [0.25, 0.252],
  [150 / 255, 159 / 255],
  [0.75, 0.738],
  [0.90, 0.872],
  [0.98, 0.952],
  [1, 1],
] as const;

const VELVIA_TONE_CURVE = [
  [0, 0],
  [5 / 255, 0.013],
  [0.05, 0.034],
  [0.10, 0.076],
  [0.18, 0.178],
  [0.25, 0.250],
  [150 / 255, 161 / 255],
  [0.75, 0.748],
  [0.90, 0.882],
  [0.98, 0.952],
  [1, 1],
] as const;

const ASTIA_TONE_CURVE = [
  [0, 0],
  [5 / 255, 0.017],
  [0.05, 0.045],
  [0.10, 0.091],
  [0.18, 0.180],
  [0.25, 0.250],
  [150 / 255, 157 / 255],
  [0.75, 0.730],
  [0.90, 0.865],
  [0.98, 0.948],
  [1, 1],
] as const;

const ETERNA_TONE_CURVE = [
  [0, 0],
  [5 / 255, 5 / 255],
  [0.10, 0.115],
  [0.22, 0.22],
  [95 / 255, 85 / 255],
  [0.75, 0.705],
  [0.90, 0.842],
  [0.98, 0.950],
  [1, 1],
] as const;

const CLASSIC_CHROME_TONE_CURVE = [
  [0, 0],
  [5 / 255, 0.012],
  [0.05, 0.030],
  [0.10, 0.070],
  [0.18, 0.177],
  [0.25, 0.245],
  [150 / 255, 156 / 255],
  [0.75, 0.732],
  [0.90, 0.858],
  [0.98, 0.930],
  [1, 1],
] as const;

export const FILM_SIMULATION_PARAMS: Record<FilmSimulationPreset, FilmSimulationParams> = {
  provia: {
    primary: {
      redHue: 0,
      redSaturation: 0,
      greenHue: 2,
      greenSaturation: 0,
      blueHue: 1,
      blueSaturation: 0,
    },
    hslHue: [1, 0, 5, 5, 5, 2, 0, 0],
    hslSaturation: [0, 0, -6, -3, 0, 0, 0, 0],
    hslLuminance: [20, 10, -5, -5, -5, 0, 5, 10],
    globalSaturation: 0,
    vibrance: 5,
    shadowTint: 1,
    toneCurve: PROVIA_TONE_CURVE,
  },
  velvia: {
    primary: {
      redHue: 0,
      redSaturation: 5,
      greenHue: -2,
      greenSaturation: 0,
      blueHue: 3,
      blueSaturation: 5,
    },
    hslHue: [1, -2, -5, 5, 10, 5, 0, 0],
    hslSaturation: [0, 0, -10, -5, 0, 0, 0, 0],
    hslLuminance: [40, 15, -5, -5, -5, -5, 15, 30],
    globalSaturation: 0,
    vibrance: 25,
    shadowTint: 3,
    toneCurve: VELVIA_TONE_CURVE,
  },
  astia: {
    primary: {
      redHue: -5,
      redSaturation: 0,
      greenHue: 0,
      greenSaturation: 0,
      blueHue: 2,
      blueSaturation: 0,
    },
    hslHue: [-3, 8, -2, -2, 20, 0, 0, 0],
    hslSaturation: [-5, -3, -6, -3, 0, 0, 0, 0],
    hslLuminance: [20, 5, -5, -5, 0, 5, 10, 15],
    globalSaturation: 0,
    vibrance: 10,
    shadowTint: 3,
    toneCurve: ASTIA_TONE_CURVE,
  },
  eterna: {
    primary: {
      redHue: 5,
      redSaturation: 0,
      greenHue: 5,
      greenSaturation: 0,
      blueHue: -10,
      blueSaturation: 0,
    },
    hslHue: [5, 5, 5, 5, 5, 0, 0, 0],
    hslSaturation: [0, 0, 0, 0, 0, 0, 0, 0],
    hslLuminance: [-5, -5, -5, -5, -5, -5, -5, -5],
    globalSaturation: -10,
    vibrance: -15,
    shadowTint: -1,
    toneCurve: ETERNA_TONE_CURVE,
  },
  "classic-chrome": {
    primary: {
      redHue: 5,
      redSaturation: -5,
      greenHue: 0,
      greenSaturation: 0,
      blueHue: -15,
      blueSaturation: 0,
    },
    hslHue: [-5, 0, 5, 10, 5, 0, 0, 0],
    hslSaturation: [0, 0, 0, 0, 0, 0, 0, 0],
    hslLuminance: [5, -5, -10, -10, -10, -10, -10, -5],
    globalSaturation: -5,
    vibrance: -15,
    shadowTint: -2,
    toneCurve: CLASSIC_CHROME_TONE_CURVE,
  },
};

export const FILM_SIMULATION_SEQUENCE: readonly FilmSimulationPreset[] = [
  "provia",
  "velvia",
  "astia",
  "eterna",
  "classic-chrome",
] as const;

export const FILM_SIMULATION_LABELS: Record<FilmSimulationPreset, string> = {
  provia: "Provia",
  velvia: "Velvia",
  astia: "Astia",
  eterna: "Eterna",
  "classic-chrome": "C. Chrome",
};
