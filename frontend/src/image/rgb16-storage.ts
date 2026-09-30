import { clamp01 } from "@/image/tone";

export type Rgb16StorageTransfer = "linear" | "gamma20";

export function normalizeLinearRangeMax(linearRangeMax: number): number {
  return Number.isFinite(linearRangeMax) && linearRangeMax > 0 ? linearRangeMax : 1;
}

export function decodeStoredRgb16Channel(
  sample: number,
  transfer: Rgb16StorageTransfer,
  linearRangeMax: number,
): number {
  const encoded = clamp01(sample / 65535);
  const normalizedRange = normalizeLinearRangeMax(linearRangeMax);
  if (transfer === "gamma20") return encoded * encoded * normalizedRange;
  return encoded * normalizedRange;
}

export function encodeStoredRgb16Channel(
  linear: number,
  transfer: Rgb16StorageTransfer,
  linearRangeMax: number,
): number {
  const normalizedRange = normalizeLinearRangeMax(linearRangeMax);
  const normalized = clamp01(linear / normalizedRange);
  const encoded = transfer === "gamma20" ? Math.sqrt(normalized) : normalized;
  return Math.round(encoded * 65535);
}
