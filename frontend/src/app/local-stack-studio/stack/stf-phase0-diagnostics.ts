/**
 * Phase 0: non-invasive baseline telemetry for the existing (real-frame-only) STF.
 * Timing values are wall time; parallel worker CPU times are not inferred.
 * Do not use this module to determine pipeline behavior or cache policy.
 */
export type StfBaselineStage = {
  stage: string;
  wallMs: number;
  note?: string;
};

export type StfBaselineCache = {
  item: string;
  state: string;
  location: string;
  sizeMiB?: number;
  note?: string;
};

export type StfSampledSignature = {
  hash: string;
  sampledPixels: number;
  totalPixels: number;
};

/** Fast reproducible check, NOT a whole-image checksum or a replacement for pixel comparison. */
export function fingerprintStfOutputSampled(
  pixels: Uint16Array, width: number, height: number, maximumSamples = 8192,
): StfSampledSignature {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
      pixels.length !== width * height * 3) {
    throw new Error("STF baseline fingerprint dimensions are invalid.");
  }
  const count = width * height;
  const samples = Math.max(1, Math.min(count, Math.floor(maximumSamples)));
  let hash = 2166136261;
  // Sample a fixed set of spatially distributed pixels, including both endpoints.
  for (let index = 0; index < samples; index += 1) {
    const pixel = samples === 1 ? 0 : Math.floor(index * (count - 1) / (samples - 1));
    const rgb = pixel * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = pixels[rgb + channel];
      hash = Math.imul(hash ^ value, 16777619);
    }
  }
  return {
    hash: (hash >>> 0).toString(16).padStart(8, "0"),
    sampledPixels: samples,
    totalPixels: count,
  };
}

export type StfBaselineContext = {
  inputCount: number;
  width: number;
  height: number;
  blendWeight: number;
  blurStrength: string;
  blurRatio: number;
  blurGuard: string;
  blurSigmoid: number;
  alignmentMode: string;
  referenceIndex: number | null;
  fNumbers: number[];
  weights: number[];
  gains: number[];
  scaledLogs: number[];
};

export class StfPhase0Diagnostics {
  private readonly stages: StfBaselineStage[] = [];
  private readonly caches: StfBaselineCache[] = [];
  private readonly workerCounts = new Map<string, number>();
  private context: StfBaselineContext | null = null;
  private signature: StfSampledSignature | null = null;
  private readonly runId: number;

  constructor(runId: number) { this.runId = runId; }

  setContext(context: StfBaselineContext): void { this.context = context; }

  stage(stage: string, wallMs: number, note?: string): void {
    if (Number.isFinite(wallMs) && wallMs >= 0) {
      this.stages.push({ stage, wallMs, ...(note ? { note } : {}) });
    }
  }

  cache(item: string, state: string, location: string, bytes?: number, note?: string): void {
    this.caches.push({
      item, state, location,
      ...(bytes !== undefined && Number.isFinite(bytes) && bytes >= 0
        ? { sizeMiB: Number((bytes / 1048576).toFixed(2)) } : {}),
      ...(note ? { note } : {}),
    });
  }

  workers(role: string, count: number): void {
    if (Number.isInteger(count) && count >= 0) this.workerCounts.set(role, count);
  }

  captureOutput(pixels: Uint16Array | null | undefined, width: number, height: number): void {
    if (pixels) this.signature = fingerprintStfOutputSampled(pixels, width, height);
  }

  /** The returned record is plain data so runs can be compared or copied from DevTools. */
  record(totalWallMs: number, status: "completed" | "failed", infoTimings: readonly {
    label: string; durationMs: number; includedIn?: string;
  }[] = []): {
    version: string;
    runId: number;
    status: string;
    totalWallMs: number;
    context: StfBaselineContext | null;
    stages: StfBaselineStage[];
    caches: StfBaselineCache[];
    workers: Record<string, number>;
    resultSignature: StfSampledSignature | null;
  } {
    return {
      version: "stf-phase0-v1", runId: this.runId, status,
      totalWallMs: Number(totalWallMs.toFixed(2)),
      context: this.context,
      stages: [
        ...infoTimings.map((entry) => ({
          stage: entry.label, wallMs: entry.durationMs,
          ...(entry.includedIn ? { note: `Included in ${entry.includedIn}` } : {}),
        })),
        ...this.stages,
      ],
      caches: [...this.caches],
      workers: Object.fromEntries(this.workerCounts),
      resultSignature: this.signature,
    };
  }

  print(totalWallMs: number, status: "completed" | "failed", infoTimings: readonly {
    label: string; durationMs: number; includedIn?: string;
  }[] = []): void {
    // A single plain string is fully visible in Chrome DevTools without
    // expanding console groups, tables, arrays, or object properties.
    console.log(formatStfPhase0Report(this.record(totalWallMs, status, infoTimings)));
  }
}

type StfPhase0Record = ReturnType<StfPhase0Diagnostics["record"]>;

/** One copyable console entry per Process; no collapsed DevTools objects. */
export function formatStfPhase0Report(record: StfPhase0Record): string {
  const ctx = record.context;
  const fmtMs = (ms: number) => `${ms.toFixed(1)} ms`;
  const fmtArray = (values: readonly number[]) => `[${values.join(", ")}]`;
  const lines = [
    `[LSS STF] Phase 0 | run=${record.runId} | ${record.status} | total=${fmtMs(record.totalWallMs)}`,
    `Settings: ${ctx ? [
      `${ctx.inputCount} real frames`, "0 generated frames", "generation=off",
      `${ctx.width}x${ctx.height}`, `W=${ctx.blendWeight}`,
      `blur=${ctx.blurStrength}`, `ratio=${ctx.blurRatio}`,
      `guard=${ctx.blurGuard}`, `sigmoid=${ctx.blurSigmoid}`,
      `alignment=${ctx.alignmentMode}`, `reference=${ctx.referenceIndex ?? "none"}`,
    ].join(" | ") : "unavailable"}`,
    "Stages (wall time; stages included in a parent are NOT additive):",
    ...record.stages.map((entry) =>
      `  ${entry.stage}: ${fmtMs(entry.wallMs)}${entry.note ? ` | ${entry.note}` : ""}`),
    "Caches:",
    ...(record.caches.length
      ? record.caches.map((entry) =>
        `  ${entry.item}: ${entry.state} | ${entry.location}` +
        `${entry.sizeMiB !== undefined ? ` | ${entry.sizeMiB} MiB` : ""}` +
        `${entry.note ? ` | ${entry.note}` : ""}`)
      : ["  (none recorded)"]),
    "Workers:",
    ...Object.entries(record.workers).map(([role, count]) => `  ${role}: ${count}`),
    "Numerical baseline (sampled fingerprint; NOT full-image equality):",
    ...(ctx ? [
      `  fNumbers: ${fmtArray(ctx.fNumbers)}`,
      `  weights: ${fmtArray(ctx.weights)}`,
      `  gains: ${fmtArray(ctx.gains)}`,
      `  scaledLogs: ${fmtArray(ctx.scaledLogs)}`,
    ] : ["  (unavailable)"]),
    `  gamma2Sample: ${record.resultSignature
      ? `${record.resultSignature.hash} | sampled=${record.resultSignature.sampledPixels} | pixels=${record.resultSignature.totalPixels}`
      : "unavailable"}`,
    // The full record can be pasted or programmatically parsed. It is a
    // literal string, not a DevTools object reference requiring expansion.
    `Full record JSON: ${JSON.stringify(record)}`,
    `[LSS STF] END run=${record.runId}`,
  ];
  return lines.join("\n");
}
