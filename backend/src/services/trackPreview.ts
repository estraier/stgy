import { gzipSync } from "zlib";
import type { GeoCoder, GeoPlace } from "stgy-geocoder";

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

type TrackJsonPoi = {
  coordinates: [number, number];
};

type TrackJsonPoiLabelAssignment = {
  longitude: number;
  latitude: number;
  label: string;
};

type TrackJsonModule = {
  parseTrackJsonData: (text: string) => unknown;
  downsampleTrackJsonData: (data: unknown, options: DownsampleOptions) => unknown;
  compactTrackJsonData: (data: unknown) => unknown;
  getTrackJsonPoi: (data: unknown) => TrackJsonPoi[];
  applyTrackJsonPoiLabels: <T>(
    data: T,
    assignments: readonly TrackJsonPoiLabelAssignment[],
  ) => T;
};

async function loadModule<T>(candidates: string[]): Promise<T> {
  for (const candidate of candidates) {
    try {
      return (await import(candidate)) as T;
    } catch {
      // Try the next candidate. Package layouts differ between source and dist.
    }
  }
  throw new Error(`Cannot load module: ${candidates.join(", ")}`);
}

async function loadFitModule(): Promise<FitModule> {
  return await loadModule<FitModule>([
    "stgy-track/fit",
    "stgy-track/dist/fit",
    "stgy-track/dist/src/fit",
    "stgy-track/src/fit",
  ]);
}

async function loadTrackJsonModule(): Promise<TrackJsonModule> {
  return await loadModule<TrackJsonModule>([
    "stgy-track/trackjson",
    "stgy-track/dist/trackjson",
    "stgy-track/dist/src/trackjson",
  ]);
}

function gzipUtf8(text: string): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(text, "utf8")));
}

function getGeoPlaceLabel(place: GeoPlace | undefined, locale: string): string | undefined {
  const address = place?.addresses.find((item) => item.locale === locale) ?? place?.addresses[0];
  const label = address?.label.trim();
  return label || undefined;
}

function addTrackJsonPoiLabels(
  data: unknown,
  trackjson: TrackJsonModule,
  geoCoder: GeoCoder,
): unknown {
  const coordinatesByKey = new Map<string, { longitude: number; latitude: number }>();

  trackjson.getTrackJsonPoi(data).forEach((point) => {
    const longitude = point.coordinates[0];
    const latitude = point.coordinates[1];
    coordinatesByKey.set(`${longitude},${latitude}`, { longitude, latitude });
  });

  const assignments = Array.from(coordinatesByKey.values())
    .map(({ longitude, latitude }) => {
      const label = getGeoPlaceLabel(geoCoder.decode(longitude, latitude, "ja")[0], "ja");
      return label ? { longitude, latitude, label } : undefined;
    })
    .filter((assignment): assignment is TrackJsonPoiLabelAssignment => {
      return assignment !== undefined;
    });

  return trackjson.applyTrackJsonPoiLabels(data, assignments);
}

export async function makeFitTrackPreview(
  bytes: Uint8Array,
  maxPoints: number,
  geoCoder: GeoCoder,
): Promise<Uint8Array> {
  const [fit, trackjson] = await Promise.all([loadFitModule(), loadTrackJsonModule()]);
  const activity = fit.parseFitBytes(bytes);
  const preview = fit.downsampleTrackActivity(activity, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  const text = fit.trackActivityToTrackJson(preview, {
    pretty: false,
  });
  const data = trackjson.parseTrackJsonData(text);
  const labeled = addTrackJsonPoiLabels(data, trackjson, geoCoder);
  return gzipUtf8(labeled === data ? text : JSON.stringify(labeled));
}

export async function makeTrackJsonTrackPreview(
  text: string,
  maxPoints: number,
  geoCoder: GeoCoder,
): Promise<Uint8Array> {
  const trackjson = await loadTrackJsonModule();
  const data = trackjson.parseTrackJsonData(text);
  const downsampled = trackjson.downsampleTrackJsonData(data, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  const compact = trackjson.compactTrackJsonData(downsampled);
  const labeled = addTrackJsonPoiLabels(compact, trackjson, geoCoder);
  return gzipUtf8(JSON.stringify(labeled));
}
