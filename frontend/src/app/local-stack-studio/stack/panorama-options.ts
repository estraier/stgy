export const PANORAMA_DOWNSCALE_MEGAPIXELS = [4, 6, 8, 12, 16, 24, 32, 48, 64] as const;
export const DEFAULT_PANORAMA_DOWNSCALE_MEGAPIXELS = 16;

const PANORAMA_DOWNSCALE_VALUE_SET = new Set<number>(PANORAMA_DOWNSCALE_MEGAPIXELS);

export function isSupportedPanoramaDownscaleMegapixels(value: number): boolean {
  return PANORAMA_DOWNSCALE_VALUE_SET.has(value);
}

export function parsePanoramaDownscaleMegapixels(value: string): number | null | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "none") return null;

  const match = /^(\d+)(?:\s*mp)?$/.exec(normalized);
  if (!match) return undefined;

  const megapixels = Number.parseInt(match[1], 10);
  return PANORAMA_DOWNSCALE_VALUE_SET.has(megapixels) ? megapixels : undefined;
}

export const PANORAMA_FINISH_MODES = ["trim", "fill"] as const;
export type PanoramaFinishMode = (typeof PANORAMA_FINISH_MODES)[number];
export const DEFAULT_PANORAMA_FINISH_MODE: PanoramaFinishMode = "trim";

const PANORAMA_FINISH_MODE_SET = new Set<string>(PANORAMA_FINISH_MODES);

export function isSupportedPanoramaFinishMode(value: string): value is PanoramaFinishMode {
  return PANORAMA_FINISH_MODE_SET.has(value);
}

export function parsePanoramaFinishMode(value: string): PanoramaFinishMode | undefined {
  const normalized = value.trim().toLowerCase();
  return isSupportedPanoramaFinishMode(normalized) ? normalized : undefined;
}
