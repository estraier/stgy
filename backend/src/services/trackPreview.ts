import { gzipSync, gunzipSync } from "zlib";

type TrackActivity = {
  schemaVersion: number;
  metadata: Record<string, unknown>;
  points: unknown[];
  warnings: unknown[];
};

type DownsampleOptions = {
  maxPoints: number;
  strategy: "uniform" | "aggregate";
  preserveEndpoints: boolean;
};

type FitModule = {
  parseFitBytes: (bytes: Uint8Array) => TrackActivity;
  downsampleTrackActivity: (
    activity: TrackActivity,
    options: DownsampleOptions,
  ) => TrackActivity;
  trackActivityToTrackJson: (
    activity: TrackActivity,
    options: { pretty: boolean },
  ) => string;
};

type TrackJsonModule = {
  parseTrackJsonData: (text: string) => unknown;
  downsampleTrackJsonData: (data: unknown, options: DownsampleOptions) => unknown;
  compactTrackJsonData: (data: unknown) => unknown;
};

function loadModule<T>(candidates: string[]): T {
  for (const candidate of candidates) {
    try {
      return require(candidate) as T;
    } catch {
      // Try the next candidate. Package layouts differ between source and dist.
    }
  }
  throw new Error(`Cannot load module: ${candidates.join(", ")}`);
}

function loadFitModule(): FitModule {
  return loadModule<FitModule>([
    "stgy-track/fit",
    "stgy-track/dist/fit",
    "stgy-track/dist/src/fit",
    "stgy-track/src/fit",
  ]);
}

function loadTrackJsonModule(): TrackJsonModule {
  return loadModule<TrackJsonModule>([
    "stgy-track/trackjson",
    "stgy-track/dist/trackjson",
    "stgy-track/dist/src/trackjson",
    "stgy-track/src/trackjson",
  ]);
}

function gzipUtf8(text: string): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(text, "utf8")));
}

function gunzipUtf8(bytes: Uint8Array): string {
  return gunzipSync(Buffer.from(bytes)).toString("utf8");
}

export function makeFitTrackPreview(bytes: Uint8Array, maxPoints: number): Uint8Array {
  const fit = loadFitModule();
  const activity = fit.parseFitBytes(bytes);
  const preview = fit.downsampleTrackActivity(activity, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  const text = fit.trackActivityToTrackJson(preview, {
    pretty: false,
  });
  return gzipUtf8(text);
}

export function makeTrackJsonTrackPreview(bytes: Uint8Array, maxPoints: number): Uint8Array {
  const trackjson = loadTrackJsonModule();
  const text = gunzipUtf8(bytes);
  const data = trackjson.parseTrackJsonData(text);
  const downsampled = trackjson.downsampleTrackJsonData(data, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  const compact = trackjson.compactTrackJsonData(downsampled);
  return gzipUtf8(JSON.stringify(compact));
}
