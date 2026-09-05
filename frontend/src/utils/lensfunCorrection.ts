"use client";

export type RawLensMetadata = {
  cameraMaker: string;
  cameraModel: string;
  lensMaker?: string;
  lensModel: string;
  focal: number;
  aperture?: number;
  cropFactor?: number;
};

export type LensfunCorrection = {
  gridWidth: number;
  gridHeight: number;
  step: number;
  geometry: Float32Array;
  distortion: boolean;
  tca?: Float32Array;
  vignetting?: Float32Array;
  vignettingBaked?: boolean;
  cameraMaker: string;
  cameraModel: string;
  lensMaker: string;
  lensModel: string;
  focal: number;
  aperture?: number;
  cropFactor: number;
};

export type LensfunCorrectionSummary = {
  lensLabel: string;
  focal: number;
  aperture?: number;
  cropFactor: number;
  distortionPercent?: number;
  tcaRedPercent?: number;
  tcaBluePercent?: number;
  vignettingPercent?: number;
  vignettingEv?: number;
};

type LensfunCameraMatch = {
  maker: string;
  model: string;
  variant?: string;
  mount?: string;
  cropFactor: number;
  score: number;
};

type LensfunLensMatch = {
  handle: number;
  maker: string;
  model: string;
  score: number;
  minFocal?: number;
  maxFocal?: number;
  minAperture?: number;
  maxAperture?: number;
  cropFactor?: number;
};

type LensfunCorrectionMaps = {
  gridWidth: number;
  gridHeight: number;
  step: number;
  geometry: Float32Array;
  tca?: Float32Array;
  vignetting?: Float32Array;
};

type LensfunClientLike = {
  searchCameras(input: {
    maker?: string;
    model?: string;
    searchFlags?: number;
  }): LensfunCameraMatch[];
  searchLenses(input: {
    lensModel: string;
    lensMaker?: string;
    cameraMaker?: string;
    cameraModel?: string;
    searchFlags?: number;
  }): LensfunLensMatch[];
  getAvailableModifications(lensHandle: number, crop: number): number;
  buildCorrectionMaps(input: {
    lensHandle: number;
    width: number;
    height: number;
    focal: number;
    crop: number;
    step?: number;
    reverse?: boolean;
    includeTca?: boolean;
    includeVignetting?: boolean;
    aperture?: number;
    distance?: number;
  }): LensfunCorrectionMaps;
  dispose(): void;
};

type LensfunBrowserModuleLike = {
  createLensfun(options?: {
    moduleJsUrl?: string;
    wasmUrl?: string;
    dataUrl?: string;
    dbPath?: string;
    autoInitDb?: boolean;
  }): Promise<LensfunClientLike>;
  LF_MODIFY_TCA: number;
  LF_MODIFY_VIGNETTING: number;
  LF_MODIFY_DISTORTION: number;
};

const LENSFUN_BASE_URL = "/vendor/lensfun-wasm";
const LENSFUN_UMD_URL = `${LENSFUN_BASE_URL}/umd/index.iife.js`;
const LENSFUN_CORE_JS_URL = `${LENSFUN_BASE_URL}/assets/lensfun-core.js`;
const LENSFUN_CORE_WASM_URL = `${LENSFUN_BASE_URL}/assets/lensfun-core.wasm`;
const LENSFUN_CORE_DATA_URL = `${LENSFUN_BASE_URL}/assets/lensfun-core.data`;
const LENSFUN_MAP_STEP = 8;

let lensfunScriptPromise: Promise<void> | null = null;
let lensfunClientPromise: Promise<{
  client: LensfunClientLike;
  lensfunModule: LensfunBrowserModuleLike;
}> | null = null;

function browserLensfunModule(): LensfunBrowserModuleLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { LensfunWasm?: LensfunBrowserModuleLike }).LensfunWasm;
}

function loadLensfunScript(): Promise<void> {
  const existingModule = browserLensfunModule();
  if (existingModule) return Promise.resolve();
  if (lensfunScriptPromise) return lensfunScriptPromise;

  lensfunScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-stgy-lensfun-wasm="true"]`,
    );
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.src = LENSFUN_UMD_URL;
    script.async = true;
    script.dataset.stgyLensfunWasm = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("LensFun loader failed"));
    document.head.appendChild(script);
  }).catch((error) => {
    lensfunScriptPromise = null;
    throw error;
  });

  return lensfunScriptPromise;
}

async function getLensfunClient(): Promise<{
  client: LensfunClientLike;
  lensfunModule: LensfunBrowserModuleLike;
}> {
  if (lensfunClientPromise) return lensfunClientPromise;

  lensfunClientPromise = (async () => {
    await loadLensfunScript();
    const lensfunModule = browserLensfunModule();
    if (!lensfunModule) throw new Error("LensFun API unavailable");
    const client = await lensfunModule.createLensfun({
      moduleJsUrl: LENSFUN_CORE_JS_URL,
      wasmUrl: LENSFUN_CORE_WASM_URL,
      dataUrl: LENSFUN_CORE_DATA_URL,
    });
    return { client, lensfunModule };
  })().catch((error) => {
    lensfunClientPromise = null;
    throw error;
  });

  return lensfunClientPromise;
}

function bestMatch<T extends { score: number }>(matches: T[]): T | undefined {
  let best: T | undefined;
  for (const match of matches) {
    if (!best || Number(match.score) > Number(best.score)) best = match;
  }
  return best;
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}


function combinedLensLabel(maker: string, model: string): string {
  const normalizedMaker = maker.trim();
  const normalizedModel = model.trim();
  if (!normalizedMaker) return normalizedModel;
  if (!normalizedModel) return normalizedMaker;
  return normalizedModel.toLowerCase().startsWith(normalizedMaker.toLowerCase())
    ? normalizedModel
    : `${normalizedMaker} ${normalizedModel}`;
}

function distanceFromCenter(x: number, y: number, centerX: number, centerY: number): number {
  return Math.hypot(x - centerX, y - centerY);
}

function maxAbsValue(values: number[]): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (best === undefined || Math.abs(value) > Math.abs(best)) {
      best = value;
    }
  }
  return best;
}


function searchLens(
  client: LensfunClientLike,
  metadata: RawLensMetadata,
  camera?: LensfunCameraMatch,
): LensfunLensMatch | undefined {
  const attempts = [
    {
      lensModel: metadata.lensModel,
      ...(metadata.lensMaker ? { lensMaker: metadata.lensMaker } : {}),
      ...(camera?.maker || metadata.cameraMaker
        ? { cameraMaker: camera?.maker || metadata.cameraMaker }
        : {}),
      ...(camera?.model || metadata.cameraModel
        ? { cameraModel: camera?.model || metadata.cameraModel }
        : {}),
    },
    {
      lensModel: metadata.lensModel,
      ...(metadata.lensMaker ? { lensMaker: metadata.lensMaker } : {}),
    },
    { lensModel: metadata.lensModel },
  ];

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const input = attempts[attemptIndex];
    const matches = client.searchLenses(input);
    const match = bestMatch(matches);
    if (match) {
      return match;
    }
  }
  return undefined;
}

export async function buildRawLensfunCorrection(
  metadata: RawLensMetadata | null,
  width: number,
  height: number,
): Promise<LensfunCorrection | undefined> {
  if (!metadata || width <= 0 || height <= 0 || !(metadata.focal > 0)) {
    return undefined;
  }

  try {
    const { client, lensfunModule } = await getLensfunClient();
    const cameraSearchInput = {
      ...(metadata.cameraMaker ? { maker: metadata.cameraMaker } : {}),
      ...(metadata.cameraModel ? { model: metadata.cameraModel } : {}),
    };
    const cameraMatches = client.searchCameras(cameraSearchInput);
    const camera = bestMatch(cameraMatches);
    const lens = searchLens(client, metadata, camera);
    if (!lens) return undefined;

    const cropFactor =
      positiveNumber(camera?.cropFactor) ??
      positiveNumber(metadata.cropFactor) ??
      positiveNumber(lens.cropFactor) ??
      1;
    const modifications = client.getAvailableModifications(lens.handle, cropFactor);
    const includeTca = Boolean(modifications & lensfunModule.LF_MODIFY_TCA);
    const includeVignetting = Boolean(
      (modifications & lensfunModule.LF_MODIFY_VIGNETTING) && positiveNumber(metadata.aperture),
    );
    const includeDistortion = Boolean(modifications & lensfunModule.LF_MODIFY_DISTORTION);
    if (!includeDistortion && !includeTca && !includeVignetting) {
      return undefined;
    }

    const mapRequest = {
      lensHandle: lens.handle,
      width,
      height,
      focal: metadata.focal,
      crop: cropFactor,
      step: LENSFUN_MAP_STEP,
      reverse: false,
      includeTca,
      includeVignetting,
      ...(includeVignetting && metadata.aperture ? { aperture: metadata.aperture } : {}),
    };
    const maps = client.buildCorrectionMaps(mapRequest);

    if (
      maps.gridWidth <= 0 ||
      maps.gridHeight <= 0 ||
      maps.step <= 0 ||
      maps.geometry.length < maps.gridWidth * maps.gridHeight * 2
    ) {
      return undefined;
    }

    const correction: LensfunCorrection = {
      gridWidth: maps.gridWidth,
      gridHeight: maps.gridHeight,
      step: maps.step,
      geometry: maps.geometry,
      distortion: includeDistortion,
      ...(maps.tca ? { tca: maps.tca } : {}),
      ...(maps.vignetting ? { vignetting: maps.vignetting } : {}),
      cameraMaker: camera?.maker || metadata.cameraMaker,
      cameraModel: camera?.model || metadata.cameraModel,
      lensMaker: lens.maker,
      lensModel: lens.model,
      focal: metadata.focal,
      ...(metadata.aperture ? { aperture: metadata.aperture } : {}),
      cropFactor,
    };

    return correction;
  } catch {
    // Lens correction is best-effort. A missing profile or unavailable WASM asset
    // must never prevent the RAW image itself from opening.
    return undefined;
  }
}

export function summarizeLensfunCorrection(
  correction: LensfunCorrection,
  sourceWidth: number,
  sourceHeight: number,
): LensfunCorrectionSummary {
  const maxX = Math.max(0, sourceWidth - 1);
  const maxY = Math.max(0, sourceHeight - 1);
  const centerX = maxX / 2;
  const centerY = maxY / 2;
  const corners: Array<[number, number]> = [
    [0, 0],
    [maxX, 0],
    [0, maxY],
    [maxX, maxY],
  ];

  const distortionCandidates: number[] = [];
  if (correction.distortion) {
    for (const [x, y] of corners) {
      const radius = distanceFromCenter(x, y, centerX, centerY);
      if (!(radius > 0)) continue;
      const geometry = interpolateMapValues(correction, correction.geometry, 2, x, y);
      const sourceX = geometry[0] ?? x;
      const sourceY = geometry[1] ?? y;
      const sourceRadius = distanceFromCenter(sourceX, sourceY, centerX, centerY);
      if (Number.isFinite(sourceRadius)) {
        distortionCandidates.push((sourceRadius / radius - 1) * 100);
      }
    }
  }

  const tcaRedCandidates: number[] = [];
  const tcaBlueCandidates: number[] = [];
  if (correction.tca) {
    for (const [x, y] of corners) {
      const coordinates = lensfunSourceCoordinates(correction, x, y);
      const gRadius = distanceFromCenter(coordinates.g[0], coordinates.g[1], centerX, centerY);
      if (!(gRadius > 0)) continue;
      const rRadius = distanceFromCenter(coordinates.r[0], coordinates.r[1], centerX, centerY);
      const bRadius = distanceFromCenter(coordinates.b[0], coordinates.b[1], centerX, centerY);
      if (Number.isFinite(rRadius)) tcaRedCandidates.push((rRadius / gRadius - 1) * 100);
      if (Number.isFinite(bRadius)) tcaBlueCandidates.push((bRadius / gRadius - 1) * 100);
    }
  }

  let maxVignettingGain: number | undefined;
  if (correction.vignetting) {
    for (const [x, y] of corners) {
      const gains = lensfunVignettingGain(correction, x, y);
      for (const gain of gains) {
        if (!Number.isFinite(gain) || gain <= 0) continue;
        maxVignettingGain = maxVignettingGain === undefined ? gain : Math.max(maxVignettingGain, gain);
      }
    }
  }

  return {
    lensLabel: combinedLensLabel(correction.lensMaker, correction.lensModel),
    focal: correction.focal,
    ...(positiveNumber(correction.aperture) ? { aperture: correction.aperture } : {}),
    cropFactor: correction.cropFactor,
    ...(maxAbsValue(distortionCandidates) === undefined
      ? {}
      : { distortionPercent: maxAbsValue(distortionCandidates) }),
    ...(maxAbsValue(tcaRedCandidates) === undefined
      ? {}
      : { tcaRedPercent: maxAbsValue(tcaRedCandidates) }),
    ...(maxAbsValue(tcaBlueCandidates) === undefined
      ? {}
      : { tcaBluePercent: maxAbsValue(tcaBlueCandidates) }),
    ...(maxVignettingGain === undefined
      ? {}
      : {
        vignettingPercent: (maxVignettingGain - 1) * 100,
        vignettingEv: Math.log2(maxVignettingGain),
      }),
  };
}

function interpolateMapValues(
  correction: LensfunCorrection,
  map: Float32Array,
  stride: number,
  x: number,
  y: number,
): number[] {
  const gx = Math.max(0, Math.min(correction.gridWidth - 1, x / correction.step));
  const gy = Math.max(0, Math.min(correction.gridHeight - 1, y / correction.step));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(correction.gridWidth - 1, x0 + 1);
  const y1 = Math.min(correction.gridHeight - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const i00 = (y0 * correction.gridWidth + x0) * stride;
  const i10 = (y0 * correction.gridWidth + x1) * stride;
  const i01 = (y1 * correction.gridWidth + x0) * stride;
  const i11 = (y1 * correction.gridWidth + x1) * stride;
  const values = new Array<number>(stride);
  for (let channel = 0; channel < stride; channel++) {
    values[channel] =
      (map[i00 + channel] ?? 0) * w00 +
      (map[i10 + channel] ?? 0) * w10 +
      (map[i01 + channel] ?? 0) * w01 +
      (map[i11 + channel] ?? 0) * w11;
  }
  return values;
}

export function lensfunSourceCoordinates(
  correction: LensfunCorrection,
  x: number,
  y: number,
): {
  r: [number, number];
  g: [number, number];
  b: [number, number];
} {
  // Lensfun's reverse lookup order is geometry/distortion first, then TCA.
  // The WASM wrapper exposes those maps separately, so compose them here by
  // feeding the geometry result into the TCA map. Returning the TCA map
  // directly would silently drop distortion whenever both corrections exist.
  let geometryX = x;
  let geometryY = y;
  if (correction.distortion) {
    const geometry = interpolateMapValues(
      correction,
      correction.geometry,
      2,
      x,
      y,
    );
    geometryX = geometry[0] ?? x;
    geometryY = geometry[1] ?? y;
  }

  if (correction.tca) {
    const values = interpolateMapValues(
      correction,
      correction.tca,
      6,
      geometryX,
      geometryY,
    );
    return {
      r: [values[0] ?? geometryX, values[1] ?? geometryY],
      g: [values[2] ?? geometryX, values[3] ?? geometryY],
      b: [values[4] ?? geometryX, values[5] ?? geometryY],
    };
  }

  const point: [number, number] = [geometryX, geometryY];
  return { r: point, g: point, b: point };
}

export function lensfunVignettingGain(
  correction: LensfunCorrection,
  x: number,
  y: number,
): [number, number, number] {
  if (!correction.vignetting) return [1, 1, 1];
  const values = interpolateMapValues(correction, correction.vignetting, 3, x, y);
  return [
    Number.isFinite(values[0]) ? Math.max(0, values[0] ?? 1) : 1,
    Number.isFinite(values[1]) ? Math.max(0, values[1] ?? 1) : 1,
    Number.isFinite(values[2]) ? Math.max(0, values[2] ?? 1) : 1,
  ];
}
