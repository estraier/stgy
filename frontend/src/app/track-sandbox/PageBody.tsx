"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  Bike,
  CalendarClock,
  Download,
  Gauge,
  HeartPulse,
  MapPinned,
  Mountain,
  RotateCcw,
  Timer,
  UploadCloud,
  Zap,
} from "lucide-react";
import {
  downsampleTrackActivity,
  mergeTrackActivities,
  parseFitBytes,
  trackActivityToFit,
  trackActivityToTrackJson,
  trackJsonDataToTrackActivity,
} from "stgy-track/fit";
import type { TrackActivity, TrackPoint } from "stgy-track/fit";
import {
  parseGpxText,
  trackActivityToGpx,
} from "stgy-track/gpx";
import { parseTrackJsonData } from "stgy-track/trackjson";

type SourceType = "fit" | "gpx" | "trackjson" | "trjgz";
type DownsampleStrategy = "uniform" | "aggregate";

type ParsedInput = {
  file: File;
  activity: TrackActivity;
  sourceType: SourceType;
  originalPointCount: number;
};

type ConvertOptions = {
  downsample: boolean;
  strategy: DownsampleStrategy;
  maxPoints: number;
  preserveEndpoints: boolean;
  obfuscatePrivacy: boolean;
  privacyStartDistanceM: number;
  privacyEndDistanceM: number;
};

type TrackResult = {
  title: string;
  trackJson: string;
  trackJsonData: unknown;
  gpx: string;
  activity: TrackActivity;
  renderedActivity: TrackActivity;
  originalPointCount: number;
  renderedPointCount: number;
  sourceLabel: string;
  fitBytes: Uint8Array;
};

type ObjectUrlSet = {
  raw?: string;
  gzip?: string;
  gpx?: string;
  fit?: string;
};

type SummaryCardItem = {
  label: string;
  value: string;
};

type SummaryCard = {
  label: string;
  value?: string;
  sub?: string;
  icon: ComponentType<{ className?: string }>;
  wide?: boolean;
  items?: SummaryCardItem[];
};

type ZoneRow = {
  label: string;
  seconds: number;
  percentage: number;
};

type HistogramBin = {
  label: string;
  maxInclusive?: number;
};

type ZoneDefinition = {
  label: string;
  maxRatio: number;
};

type ZoneLabelOptions = {
  unit: string;
};

type PowerCurvePoint = {
  durationSeconds: number;
  watts: number;
};

const DEFAULT_FTP_W = 223;
const DEFAULT_LTHR_BPM = 151;
const DEFAULT_MAX_POINTS = 10000;

const POWER_ZONES = [
  { label: "Z1 Recovery", maxRatio: 0.55 },
  { label: "Z2 Endurance", maxRatio: 0.75 },
  { label: "Z3 Tempo", maxRatio: 0.90 },
  { label: "Z4 Threshold", maxRatio: 1.05 },
  { label: "Z5 VO₂ max", maxRatio: 1.20 },
  { label: "Z6 Anaerobic", maxRatio: 1.50 },
  { label: "Z7 Sprint", maxRatio: Number.POSITIVE_INFINITY },
];

const HEART_RATE_ZONES = [
  { label: "Z1 Easy", maxRatio: 0.81 },
  { label: "Z2 Endurance", maxRatio: 0.89 },
  { label: "Z3 Tempo", maxRatio: 0.94 },
  { label: "Z4 Threshold", maxRatio: 1.00 },
  { label: "Z5 Hard", maxRatio: Number.POSITIVE_INFINITY },
];

const SPEED_HISTOGRAM_BINS: HistogramBin[] = [
  { label: "≤15 km/h", maxInclusive: 15 },
  { label: "≤20 km/h", maxInclusive: 20 },
  { label: "≤25 km/h", maxInclusive: 25 },
  { label: "≤30 km/h", maxInclusive: 30 },
  { label: "≤35 km/h", maxInclusive: 35 },
  { label: "≤40 km/h", maxInclusive: 40 },
  { label: ">40 km/h" },
];

const CADENCE_HISTOGRAM_BINS: HistogramBin[] = [
  { label: "≤50 rpm", maxInclusive: 50 },
  { label: "≤60 rpm", maxInclusive: 60 },
  { label: "≤70 rpm", maxInclusive: 70 },
  { label: "≤80 rpm", maxInclusive: 80 },
  { label: "≤90 rpm", maxInclusive: 90 },
  { label: "≤100 rpm", maxInclusive: 100 },
  { label: ">100 rpm" },
];

const ZONE_RATIO_EPSILON = 1e-12;

const POWER_CURVE_DURATIONS_SECONDS = [
  5,
  10,
  15,
  20,
  30,
  45,
  60,
  90,
  120,
  180,
  300,
  600,
  900,
  1200,
  1800,
  2700,
  3600,
  5400,
  7200,
] as const;

export default function TrackSandbox() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [downsample, setDownsample] = useState(false);
  const [strategy, setStrategy] = useState<DownsampleStrategy>("aggregate");
  const [maxPoints, setMaxPoints] = useState(DEFAULT_MAX_POINTS);
  const [preserveEndpoints, setPreserveEndpoints] = useState(true);
  const [obfuscatePrivacy, setObfuscatePrivacy] = useState(false);
  const [privacyStartDistanceM, setPrivacyStartDistanceM] = useState(1000);
  const [privacyEndDistanceM, setPrivacyEndDistanceM] = useState(1000);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [ftpW, setFtpW] = useState(DEFAULT_FTP_W);
  const [lthrBpm, setLthrBpm] = useState(DEFAULT_LTHR_BPM);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Choose FIT, GPX, TrackJSON, or TRJGZ files.");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackResult | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<ObjectUrlSet>({});

  const revokeUrls = useCallback((urls: ObjectUrlSet) => {
    if (urls.raw) URL.revokeObjectURL(urls.raw);
    if (urls.gzip) URL.revokeObjectURL(urls.gzip);
    if (urls.gpx) URL.revokeObjectURL(urls.gpx);
    if (urls.fit) URL.revokeObjectURL(urls.fit);
  }, []);

  useEffect(() => {
    return () => {
      revokeUrls(downloadUrls);
    };
  }, [downloadUrls, revokeUrls]);

  const options: ConvertOptions = useMemo(() => ({
    downsample,
    strategy,
    maxPoints,
    preserveEndpoints,
    obfuscatePrivacy,
    privacyStartDistanceM,
    privacyEndDistanceM,
  }), [
    downsample,
    strategy,
    maxPoints,
    preserveEndpoints,
    obfuscatePrivacy,
    privacyStartDistanceM,
    privacyEndDistanceM,
  ]);

  const convert = useCallback(async () => {
    if (files.length === 0) {
      setError("Choose at least one FIT, GPX, TrackJSON, or TRJGZ file.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(files.length > 1 ? "Converting and merging tracks…" : "Converting track…");

    try {
      const nextResult = await convertFiles(files, options);
      const rawUrl = URL.createObjectURL(new Blob([nextResult.trackJson], {
        type: "application/json",
      }));
      const gzipBlob = await gzipText(nextResult.trackJson);
      const gzipUrl = URL.createObjectURL(gzipBlob);
      const gpxUrl = URL.createObjectURL(new Blob([nextResult.gpx], {
        type: "application/gpx+xml",
      }));
      const fitUrl = URL.createObjectURL(new Blob([copyUint8ArrayToArrayBuffer(
        nextResult.fitBytes
      )], {
        type: "application/octet-stream",
      }));

      setDownloadUrls((current) => {
        revokeUrls(current);
        return { raw: rawUrl, gzip: gzipUrl, gpx: gpxUrl, fit: fitUrl };
      });
      setResult(nextResult);
      setStatus("Track is ready.");
    } catch (e) {
      setResult(null);
      setError(getErrorMessage(e));
      setStatus("Conversion failed.");
    } finally {
      setBusy(false);
    }
  }, [files, options, revokeUrls]);

  const reset = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setFiles([]);
    setResult(null);
    setError(null);
    setStatus("Choose FIT, GPX, TrackJSON, or TRJGZ files.");
    setDownloadUrls((current) => {
      revokeUrls(current);
      return {};
    });
  }, [revokeUrls]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <header className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
              STGY Tracks
            </p>
            <h1 className="text-2xl font-bold text-slate-950">Track sandbox</h1>
            <p className="mt-1 text-sm text-slate-500">
              Convert FIT / GPX / TrackJSON rides, preview them on a cycling map,
              and download public-safe TrackJSON, GPX, and FIT.
            </p>
          </div>
        </header>

        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <label className="block rounded-xl border border-dashed border-sky-300 bg-sky-50/60 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <UploadCloud className="h-4 w-4 text-sky-700" />
                Track files
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".fit,.gpx,.trj,.json,.geojson,.trjgz,application/gpx+xml,application/xml,text/xml,application/json,application/gzip,application/octet-stream"
                disabled={busy}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg
                  file:border-0 file:bg-sky-700 file:px-3 file:py-2 file:text-sm
                  file:font-semibold file:text-white hover:file:bg-sky-800"
                onChange={(e) => {
                  setFiles(Array.from(e.currentTarget.files || []));
                }}
              />
              {files.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                  {files.map((file) => (
                    <li key={`${file.name}-${file.size}`} className="rounded-full bg-white px-3 py-1">
                      {file.name}
                    </li>
                  ))}
                </ul>
              )}
            </label>

            <div className="grid gap-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={downsample}
                    disabled={busy}
                    onChange={(e) => setDownsample(e.currentTarget.checked)}
                  />
                  <span>Downsample</span>
                </label>

                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={preserveEndpoints}
                    disabled={busy || !downsample}
                    onChange={(e) => setPreserveEndpoints(e.currentTarget.checked)}
                  />
                  <span>Preserve endpoints</span>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-500">Strategy</span>
                  <select
                    value={strategy}
                    disabled={busy || !downsample}
                    className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                    onChange={(e) => setStrategy(e.currentTarget.value as DownsampleStrategy)}
                  >
                    <option value="uniform">Uniform</option>
                    <option value="aggregate">Aggregate</option>
                  </select>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-500">Max points</span>
                  <input
                    type="number"
                    min={2}
                    step={1}
                    value={maxPoints}
                    disabled={busy || !downsample}
                    className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                    onChange={(e) => setMaxPoints(parsePositiveInt(e.currentTarget.value, 2))}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={obfuscatePrivacy}
                    disabled={busy}
                    onChange={(e) => setObfuscatePrivacy(e.currentTarget.checked)}
                  />
                  <span>Obfuscate privacy</span>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-500">Start m</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={privacyStartDistanceM}
                    disabled={busy || !obfuscatePrivacy}
                    className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                    onChange={(e) => {
                      setPrivacyStartDistanceM(parseNonNegativeInt(e.currentTarget.value));
                    }}
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-500">End m</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={privacyEndDistanceM}
                    disabled={busy || !obfuscatePrivacy}
                    className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                    onChange={(e) => {
                      setPrivacyEndDistanceM(parseNonNegativeInt(e.currentTarget.value));
                    }}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showAnalysis}
                    disabled={busy}
                    onChange={(e) => setShowAnalysis(e.currentTarget.checked)}
                  />
                  <span>Show analysis</span>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-500">FTP W</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={ftpW}
                    disabled={busy || !showAnalysis}
                    className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                    onChange={(e) => setFtpW(parsePositiveInt(e.currentTarget.value, 1))}
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-500">LTHR bpm</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={lthrBpm}
                    disabled={busy || !showAnalysis}
                    className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                    onChange={(e) => setLthrBpm(parsePositiveInt(e.currentTarget.value, 1))}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || files.length === 0}
              onClick={() => void convert()}
              className="rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white
                shadow-sm hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {busy ? "Processing…" : "Convert and preview"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300
                bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <span className={error ? "text-sm text-red-600" : "text-sm text-slate-500"}>
              {error || status}
            </span>
          </div>
        </section>

        {result && (
          <>
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">{result.title}</h2>
                    <p className="text-xs text-slate-500">
                      {result.sourceLabel} · {result.renderedPointCount.toLocaleString()} points
                    </p>
                  </div>
                  <MapPinned className="h-5 w-5 text-sky-700" />
                </div>
                <TrackMap trackJson={result.trackJson} />
              </section>

              <section className="space-y-4">
                <RideSummary activity={result.activity} trackJsonData={result.trackJsonData} />

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold text-slate-900">Download</h2>
                  <div className="flex flex-wrap gap-3">
                    {downloadUrls.raw && (
                      <a
                        href={downloadUrls.raw}
                        download={`${safeBaseName(result.title)}.trj`}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900
                          px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                      >
                        <Download className="h-4 w-4" />
                        TrackJSON
                      </a>
                    )}
                    {downloadUrls.gzip && (
                      <a
                        href={downloadUrls.gzip}
                        download={`${safeBaseName(result.title)}.trjgz`}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300
                          bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Download className="h-4 w-4" />
                        Compressed
                      </a>
                    )}
                    {downloadUrls.gpx && (
                      <a
                        href={downloadUrls.gpx}
                        download={`${safeBaseName(result.title)}.gpx`}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300
                          bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Download className="h-4 w-4" />
                        GPX
                      </a>
                    )}
                    {downloadUrls.fit && (
                      <a
                        href={downloadUrls.fit}
                        download={`${safeBaseName(result.title)}.fit`}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300
                          bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Download className="h-4 w-4" />
                        FIT
                      </a>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {showAnalysis && (
              <div className="mt-4">
                <RideAnalysis activity={result.activity} ftpW={ftpW} lthrBpm={lthrBpm} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function TrackMap({ trackJson }: { trackJson: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId();
  const sourceId = useMemo(() => {
    const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
    return `track-sandbox-${safeId}`;
  }, [reactId]);

  useEffect(() => {
    const root = rootRef.current;
    let disposed = false;

    if (!root) {
      return;
    }

    root.querySelectorAll(".stgy-track-graph").forEach((node) => node.remove());
    root.querySelectorAll<HTMLElement>(".stgy-track-map").forEach((figure) => {
      delete figure.dataset.stgyTrackInitialized;

      const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
      if (!canvas) {
        return;
      }

      const nextCanvas = canvas.cloneNode(false) as HTMLElement;
      canvas.replaceWith(nextCanvas);
    });

    (async () => {
      const { StgyTrackRenderer } = await import("stgy-track");
      if (disposed || !rootRef.current) {
        return;
      }

      const renderer = new StgyTrackRenderer();
      renderer.hydrate(rootRef.current);
    })().catch((e: unknown) => {
      if (disposed) {
        return;
      }

      const message = e instanceof Error ? e.message : String(e);
      const currentCanvas = rootRef.current?.querySelector<HTMLElement>(".stgy-track-canvas");
      if (currentCanvas) {
        currentCanvas.textContent = `Track renderer could not be loaded: ${message}`;
      }
    });

    return () => {
      disposed = true;
      root.querySelectorAll(".stgy-track-graph").forEach((node) => node.remove());
    };
  }, [sourceId, trackJson]);

  return (
    <div ref={rootRef}>
      <figure
        key={sourceId}
        className="stgy-track-map"
        data-src={`#${sourceId}`}
        data-base-layer="cyclosm"
        data-show-graph="true"
        data-show-overlay="true"
      >
        <div
          className="stgy-track-canvas w-full bg-slate-100"
          style={{
            flex: "0 0 500px",
            height: "500px",
            minHeight: "500px",
          }}
          aria-label="Track map"
        />
      </figure>
      <script
        id={sourceId}
        type="application/json"
        dangerouslySetInnerHTML={{ __html: escapeJsonScriptContent(trackJson) }}
      />
    </div>
  );
}

function escapeJsonScriptContent(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function RideSummary({
  activity,
  trackJsonData,
}: {
  activity: TrackActivity;
  trackJsonData: unknown;
}) {
  const cards = useMemo(() => {
    return buildSummaryCards(activity, trackJsonData);
  }, [activity, trackJsonData]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Ride summary</h2>
        <Bike className="h-5 w-5 text-sky-700" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`rounded-2xl bg-slate-50 p-3 ${card.wide ? "col-span-2" : ""}`}
          >
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
              <card.icon className="h-4 w-4 text-sky-700" />
              {card.label}
            </div>
            {card.items ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {card.items.map((item) => (
                  <div key={item.label}>
                    <div className="text-[11px] font-medium text-slate-500">{item.label}</div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-slate-950">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="text-xl font-bold tabular-nums text-slate-950">{card.value}</div>
                {card.sub && <div className="mt-1 text-xs text-slate-500">{card.sub}</div>}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RideAnalysis({
  activity,
  ftpW,
  lthrBpm,
}: {
  activity: TrackActivity;
  ftpW: number;
  lthrBpm: number;
}) {
  const speedRows = useMemo(() => {
    return computeHistogramRows(activity.points, (point) => {
      return typeof point.speedMps === "number" ? point.speedMps * 3.6 : undefined;
    }, SPEED_HISTOGRAM_BINS);
  }, [activity.points]);
  const cadenceRows = useMemo(() => {
    return computeHistogramRows(
      activity.points,
      (point) => point.cadenceRpm,
      CADENCE_HISTOGRAM_BINS,
    );
  }, [activity.points]);
  const powerZones = useMemo(() => {
    return computeZoneRows(
      activity.points,
      (point) => point.powerW,
      ftpW,
      POWER_ZONES,
      { unit: "W" },
    );
  }, [activity.points, ftpW]);
  const heartRateZones = useMemo(() => {
    return computeZoneRows(
      activity.points,
      (point) => point.heartRateBpm,
      lthrBpm,
      HEART_RATE_ZONES,
      { unit: "bpm" },
    );
  }, [activity.points, lthrBpm]);
  const powerCurve = useMemo(() => getPowerCurvePoints(activity), [activity]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-slate-900">Analysis</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        {speedRows.length > 0 && <ZoneBars title="Speed histogram" rows={speedRows} />}
        {cadenceRows.length > 0 && <ZoneBars title="Cadence histogram" rows={cadenceRows} />}
        {heartRateZones.length > 0 && (
          <ZoneBars title={`Heart-rate zones · LTHR ${lthrBpm} bpm`} rows={heartRateZones} />
        )}
        {powerZones.length > 0 && (
          <ZoneBars title={`Power zones · FTP ${ftpW} W`} rows={powerZones} />
        )}
        {powerCurve.length > 0 && (
          <div className="lg:col-span-2">
            <PowerCurve points={powerCurve} />
          </div>
        )}
      </div>
    </section>
  );
}

function PowerCurve({ points }: { points: PowerCurvePoint[] }) {
  const width = 480;
  const height = 170;
  const left = 38;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const minDuration = POWER_CURVE_DURATIONS_SECONDS[0];
  const maxDuration = POWER_CURVE_DURATIONS_SECONDS[POWER_CURVE_DURATIONS_SECONDS.length - 1];
  const maxPower = Math.max(...points.map((point) => point.watts), 1);
  const yMax = Math.ceil(maxPower / 50) * 50;
  const yTicks = Array.from(
    { length: Math.max(1, Math.floor(yMax / 50)) },
    (_, index) => (index + 1) * 50,
  );

  const xValue = (seconds: number) => {
    const minLog = Math.log10(minDuration);
    const maxLog = Math.log10(maxDuration);
    const ratio = (Math.log10(seconds) - minLog) / Math.max(0.001, maxLog - minLog);
    return left + ratio * plotWidth;
  };
  const yValue = (watts: number) => top + plotHeight - (watts / yMax) * plotHeight;
  const path = points
    .map((point, index) => {
      const prefix = index === 0 ? "M" : "L";
      return `${prefix}${xValue(point.durationSeconds).toFixed(1)},${yValue(point.watts).toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="mx-auto w-full lg:w-4/5">
      <div className="mb-2 text-xs font-semibold text-slate-600">Power curve</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-xl bg-slate-50">
        <line x1={left} y1={top + plotHeight} x2={width - right} y2={top + plotHeight}
          stroke="#cbd5e1" />
        <line x1={left} y1={top} x2={left} y2={top + plotHeight} stroke="#cbd5e1" />
        {yTicks.map((tick) => {
          const y = yValue(tick);
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e2e8f0" />
              <text x={left - 6} y={y + 3} textAnchor="end" fontSize="7" fill="#64748b">
                {tick}
              </text>
            </g>
          );
        })}
        {POWER_CURVE_DURATIONS_SECONDS.map((seconds) => {
          const x = xValue(seconds);
          return (
            <g key={seconds}>
              <line x1={x} y1={top + plotHeight} x2={x} y2={top + plotHeight + 4}
                stroke="#94a3b8" />
              <text x={x} y={height - 9} textAnchor="middle" fontSize="7" fill="#64748b">
                {formatDurationLabel(seconds)}
              </text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke="#0f80c9" strokeWidth="2.6" />
        {points.map((point) => (
          <circle key={point.durationSeconds} cx={xValue(point.durationSeconds)}
            cy={yValue(point.watts)} r="2.5" fill="#0f80c9" />
        ))}
      </svg>
    </div>
  );
}

function ZoneBars({ title, rows }: { title: string; rows: ZoneRow[] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-slate-600">{title}</div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[6.25rem_minmax(0,1fr)_7.75rem] items-center gap-2"
          >
            <div className="whitespace-nowrap text-xs text-slate-600">{row.label}</div>
            <div className="h-2.5 min-w-0 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-sky-600"
                style={{ width: `${Math.max(2, row.percentage)}%` }}
              />
            </div>
            <div className="whitespace-nowrap text-right text-[11px] tabular-nums text-slate-500">
              {formatDuration(row.seconds)}
              <span className="ml-1 text-slate-400">
                {formatNumber(row.percentage, 1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function convertFiles(files: File[], options: ConvertOptions): Promise<TrackResult> {
  const firstFile = files[0];
  if (!firstFile) {
    throw new Error("No track file was selected.");
  }

  const parsed = await Promise.all(files.map((file) => parseInputFile(file)));
  const firstParsed = parsed[0];
  if (!firstParsed) {
    throw new Error("No track file could be parsed.");
  }

  const title = files.length === 1 ? fileTitle(firstFile) : `${fileTitle(firstFile)} merged`;
  const activity = parsed.length === 1
    ? firstParsed.activity
    : mergeTrackActivities(parsed.map((item) => item.activity), {
      name: title,
      description: `Merged from ${files.map((file) => file.name).join(", ")}`,
    });
  const processedActivity = options.obfuscatePrivacy
    ? obfuscateActivityPrivacy(activity, options)
    : activity;
  const renderedActivity = options.downsample
    ? downsampleTrackActivity(processedActivity, {
      maxPoints: options.maxPoints,
      strategy: options.strategy,
      preserveEndpoints: options.preserveEndpoints,
    })
    : processedActivity;
  const description = files.length === 1
    ? `Converted from ${firstFile.name}`
    : `Merged from ${files.map((file) => file.name).join(", ")}`;
  const trackJson = trackActivityToTrackJson(renderedActivity, {
    title,
    description,
    includeMetadata: true,
    pretty: false,
  });
  const trackJsonData = JSON.parse(trackJson);
  const gpx = trackActivityToGpx(renderedActivity, {
    name: title,
    description,
  });
  const fitBytes = trackActivityToFit(renderedActivity);

  return {
    title,
    trackJson,
    trackJsonData,
    gpx,
    activity: processedActivity,
    renderedActivity,
    originalPointCount: parsed.reduce((sum, item) => sum + item.originalPointCount, 0),
    renderedPointCount: renderedActivity.points.length,
    sourceLabel: summarizeSources(parsed),
    fitBytes,
  };
}

async function parseInputFile(file: File): Promise<ParsedInput> {
  const lowerName = file.name.toLowerCase();

  if (
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".geojson") ||
    lowerName.endsWith(".trj")
  ) {
    const text = await file.text();
    return parseTrackJsonInput(file, text, "trackjson");
  }

  if (lowerName.endsWith(".trjgz")) {
    const text = await decompressGzipText(await file.arrayBuffer());
    return parseTrackJsonInput(file, text, "trjgz");
  }

  if (lowerName.endsWith(".gpx")) {
    return parseGpxInput(file, await file.text());
  }

  const activity = parseFitBytes(await file.arrayBuffer());
  activity.metadata.name = fileTitle(file);

  return {
    file,
    activity,
    sourceType: "fit",
    originalPointCount: activity.points.length,
  };
}

function parseGpxInput(file: File, text: string): ParsedInput {
  const activity = parseGpxText(text);
  activity.metadata.name = getStringProperty(activity.metadata as Record<string, unknown>, "name") ||
    fileTitle(file);

  return {
    file,
    activity,
    sourceType: "gpx",
    originalPointCount: activity.points.length,
  };
}

function parseTrackJsonInput(
  file: File,
  text: string,
  sourceType: "trackjson" | "trjgz",
): ParsedInput {
  const originalData = parseTrackJsonData(text);
  const activity = trackJsonDataToTrackActivity(originalData, {
    sourceType,
    name: fileTitle(file),
  });

  return {
    file,
    activity,
    sourceType,
    originalPointCount: activity.points.length,
  };
}

function obfuscateActivityPrivacy(
  activity: TrackActivity,
  options: ConvertOptions,
): TrackActivity {
  const startDistanceM = options.privacyStartDistanceM;
  const endDistanceM = options.privacyEndDistanceM;
  if (startDistanceM === 0 && endDistanceM === 0) {
    return cloneActivity(activity);
  }

  const points = activity.points.map((point) => ({
    ...point,
    ...(point.metrics ? { metrics: { ...point.metrics } } : {}),
  }));
  const positionedIndices = points
    .map((point, index) => hasPosition(point) ? index : -1)
    .filter((index) => index >= 0);
  const totalDistanceM = getActivityPrivacyDistance(points, positionedIndices);

  if (!Number.isFinite(totalDistanceM) || totalDistanceM <= 0) {
    return {
      ...cloneActivity(activity),
      points,
    };
  }

  if (startDistanceM + endDistanceM >= totalDistanceM) {
    const anchorIndex = findActivityDistanceIndex(
      points,
      positionedIndices,
      totalDistanceM / 2,
    );
    clampActivityPositionRange(
      points,
      positionedIndices,
      0,
      positionedIndices.length - 1,
      anchorIndex,
    );
  } else {
    if (startDistanceM > 0) {
      const anchorIndex = findActivityDistanceIndex(points, positionedIndices, startDistanceM);
      const anchorPosition = positionedIndices.indexOf(anchorIndex);
      if (anchorPosition >= 0) {
        clampActivityPositionRange(points, positionedIndices, 0, anchorPosition, anchorIndex);
      }
    }

    if (endDistanceM > 0) {
      const thresholdM = Math.max(0, totalDistanceM - endDistanceM);
      const anchorIndex = findActivityDistanceIndex(points, positionedIndices, thresholdM);
      const anchorPosition = positionedIndices.indexOf(anchorIndex);
      if (anchorPosition >= 0) {
        clampActivityPositionRange(
          points,
          positionedIndices,
          anchorPosition,
          positionedIndices.length - 1,
          anchorIndex,
        );
      }
    }
  }

  return {
    ...cloneActivity(activity),
    points,
  };
}

function cloneActivity(activity: TrackActivity): TrackActivity {
  return {
    ...activity,
    metadata: { ...activity.metadata },
    points: activity.points.map((point) => ({
      ...point,
      ...(point.metrics ? { metrics: { ...point.metrics } } : {}),
    })),
    pins: activity.pins?.map((pin) => ({
      ...pin,
      properties: pin.properties ? JSON.parse(JSON.stringify(pin.properties)) : undefined,
    })),
    warnings: activity.warnings.map((warning) => ({ ...warning })),
  };
}

function getActivityPrivacyDistance(points: TrackPoint[], positionedIndices: number[]): number {
  if (positionedIndices.length === 0) {
    return 0;
  }

  const lastPositioned = points[positionedIndices[positionedIndices.length - 1]];
  const lastDistance = lastPositioned?.distanceM;
  return typeof lastDistance === "number" && Number.isFinite(lastDistance)
    ? lastDistance
    : 0;
}

function findActivityDistanceIndex(
  points: TrackPoint[],
  positionedIndices: number[],
  thresholdM: number,
): number {
  const found = positionedIndices.find((index) => {
    const distanceM = points[index]?.distanceM;
    return typeof distanceM === "number" && Number.isFinite(distanceM) &&
      distanceM >= thresholdM;
  });

  return typeof found === "number"
    ? found
    : positionedIndices[positionedIndices.length - 1];
}

function clampActivityPositionRange(
  points: TrackPoint[],
  positionedIndices: number[],
  startPosition: number,
  endPosition: number,
  anchorIndex: number,
) {
  const anchor = points[anchorIndex];
  if (!anchor || !hasPosition(anchor)) {
    return;
  }

  for (let position = startPosition; position <= endPosition; position += 1) {
    const point = points[positionedIndices[position]];
    if (point && hasPosition(point)) {
      point.lat = anchor.lat;
      point.lon = anchor.lon;
    }
  }
}

function hasPosition(point: TrackPoint): point is TrackPoint & { lat: number; lon: number } {
  return typeof point.lat === "number" && typeof point.lon === "number";
}

function buildSummaryCards(activity: TrackActivity, trackJsonData: unknown): SummaryCard[] {
  const metadata = activity.metadata;
  const metadataRecord = metadata as Record<string, unknown>;
  const stats = asRecord(metadata.statistics);
  const training = asRecord(metadata.training);
  const distanceM = numberValue(metadata.totalDistanceM) ?? getPointDistanceM(activity.points);
  const timerTime = numberValue(metadata.totalTimerTime);
  const elapsedTime = numberValue(metadata.totalElapsedTime);
  const avgSpeed = getNestedNumber(stats, "speedKph", "avg") ??
    (distanceM && timerTime ? (distanceM / timerTime) * 3.6 : undefined);
  const avgPower = getNestedNumber(stats, "powerW", "avg");
  const avgHeartRate = getNestedNumber(stats, "heartRateBpm", "avg");
  const normalizedPowerW = getNumberProperty(training, "normalizedPowerW");
  const totalWorkJ = getNumberProperty(training, "totalWorkJ");
  const totalCaloriesCal = getNumberProperty(training, "totalCaloriesCal");
  const elevationGainM = getElevationGainM(activity.points);
  const cards: SummaryCard[] = [];
  const context = buildRideContextSummary(activity, trackJsonData);

  if (context) {
    cards.push({
      label: "Context",
      items: context.items,
      icon: MapPinned,
      wide: true,
    });
  }

  if (distanceM) {
    cards.push({ label: "Distance", value: formatDistance(distanceM), icon: Bike });
  }
  if (timerTime) {
    cards.push({ label: "Moving time", value: formatDuration(timerTime), icon: Timer });
  }
  if (elapsedTime) {
    cards.push({ label: "Elapsed", value: formatDuration(elapsedTime), icon: CalendarClock });
  }
  if (avgSpeed) {
    cards.push({ label: "Avg speed", value: `${formatNumber(avgSpeed, 1)} km/h`, icon: Gauge });
  }
  if (elevationGainM > 0) {
    cards.push({ label: "Elevation", value: `${formatNumber(elevationGainM, 0)} m`, icon: Mountain });
  }
  if (avgHeartRate) {
    cards.push({ label: "Avg HR", value: `${formatNumber(avgHeartRate, 0)} bpm`, icon: HeartPulse });
  }
  if (avgPower) {
    cards.push({ label: "Avg power", value: `${formatNumber(avgPower, 0)} W`, icon: Zap });
  }
  if (normalizedPowerW) {
    cards.push({ label: "Normalized", value: `${formatNumber(normalizedPowerW, 0)} W`, icon: Zap });
  }
  if (totalWorkJ) {
    cards.push({ label: "Work", value: `${formatNumber(totalWorkJ / 1000, 0)} kJ`, icon: Zap });
  }
  if (totalCaloriesCal) {
    cards.push({
      label: "Calories",
      value: `${formatNumber(totalCaloriesCal / 1000, 0)} kcal`,
      icon: Gauge,
    });
  }

  void metadataRecord;
  return cards;
}

function buildRideContextSummary(
  activity: TrackActivity,
  trackJsonData: unknown,
): { items: SummaryCardItem[] } | undefined {
  const center = getTrackJsonRcenter(trackJsonData) ??
    getActivityRouteCenter(activity.points) ??
    getTrackJsonBboxCenter(trackJsonData);
  const metadata = activity.metadata as Record<string, unknown>;
  const startTime = numberValue(metadata.startTime);
  const endTime = numberValue(metadata.endTime) ?? getActivityEndTime(activity);
  const offsetSeconds = numberValue(metadata.localTimeOffsetSeconds);
  const items: SummaryCardItem[] = [];

  if (center) {
    items.push({ label: "Coordinates", value: formatCoordinate(center.lon, center.lat) });
  }
  if (typeof startTime === "number") {
    items.push({ label: "Start Time", value: formatLocalDateTime(startTime, offsetSeconds) });
  }
  if (typeof endTime === "number") {
    items.push({ label: "End Time", value: formatLocalDateTime(endTime, offsetSeconds) });
  }

  return items.length > 0 ? { items } : undefined;
}

function getTrackJsonRcenter(data: unknown): { lon: number; lat: number } | undefined {
  const record = asRecord(data);
  const rcenter = record?.rcenter;
  if (!Array.isArray(rcenter) || rcenter.length < 2) {
    return undefined;
  }

  const lon = numberValue(rcenter[0]);
  const lat = numberValue(rcenter[1]);
  if (typeof lon !== "number" || typeof lat !== "number") {
    return undefined;
  }
  return { lon, lat };
}

function getTrackJsonBboxCenter(data: unknown): { lon: number; lat: number } | undefined {
  const record = asRecord(data);
  const bbox = record?.bbox;
  if (!Array.isArray(bbox) || bbox.length < 4) {
    return undefined;
  }

  const west = numberValue(bbox[0]);
  const south = numberValue(bbox[1]);
  const east = numberValue(bbox[2]);
  const north = numberValue(bbox[3]);
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number"
  ) {
    return undefined;
  }

  return {
    lon: (west + east) / 2,
    lat: (south + north) / 2,
  };
}

function getActivityRouteCenter(points: TrackPoint[]): { lon: number; lat: number } | undefined {
  let sumLon = 0;
  let sumLat = 0;
  let totalLength = 0;
  let previous: (TrackPoint & { lat: number; lon: number }) | undefined;

  points.forEach((point) => {
    if (!hasPosition(point)) {
      return;
    }

    if (previous) {
      const length = haversineDistanceM(previous, point);
      if (length > 0) {
        sumLon += ((previous.lon + point.lon) / 2) * length;
        sumLat += ((previous.lat + point.lat) / 2) * length;
        totalLength += length;
      }
    }
    previous = point;
  });

  if (totalLength > 0) {
    return {
      lon: sumLon / totalLength,
      lat: sumLat / totalLength,
    };
  }

  const positioned = points.filter(hasPosition);
  if (positioned.length === 0) {
    return undefined;
  }

  const lon = positioned.reduce((sum, point) => sum + point.lon, 0) / positioned.length;
  const lat = positioned.reduce((sum, point) => sum + point.lat, 0) / positioned.length;
  return { lon, lat };
}

function getActivityEndTime(activity: TrackActivity): number | undefined {
  const metadata = activity.metadata as Record<string, unknown>;
  const endTime = numberValue(metadata.endTime);
  if (typeof endTime === "number") {
    return endTime;
  }

  const startTime = numberValue(metadata.startTime);
  const elapsedTime = numberValue(metadata.totalElapsedTime);
  if (typeof startTime === "number" && typeof elapsedTime === "number") {
    return startTime + elapsedTime;
  }

  const times = activity.points.map((point) => point.time).filter(isFiniteNumber);
  if (times.length === 0) {
    return undefined;
  }
  return Math.max(...times);
}

function computeZoneRows(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  threshold: number,
  zones: ZoneDefinition[],
  labelOptions: ZoneLabelOptions,
): ZoneRow[] {
  if (!Number.isFinite(threshold) || threshold <= 0 || points.length === 0) {
    return [];
  }

  const seconds = zones.map(() => 0);
  let totalSeconds = 0;
  const timed = hasTimedIntervals(points);

  points.forEach((point, index) => {
    const value = getValue(point);
    if (!Number.isFinite(value) || value == null || value <= 0) {
      return;
    }
    const duration = timed ? getPointDurationSeconds(points, index) : 1;
    if (duration <= 0) {
      return;
    }
    const ratio = value / threshold;
    const zoneIndex = zones.findIndex((zone) => isRatioAtMost(ratio, zone.maxRatio));
    if (zoneIndex < 0) {
      return;
    }
    seconds[zoneIndex] += duration;
    totalSeconds += duration;
  });

  if (totalSeconds <= 0) {
    return [];
  }

  return zones.map((zone, index) => ({
    label: formatZoneLabel(zone, zones[index - 1], threshold, labelOptions),
    seconds: seconds[index],
    percentage: (seconds[index] / totalSeconds) * 100,
  }));
}

function computeHistogramRows(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  bins: HistogramBin[],
): ZoneRow[] {
  const seconds = bins.map(() => 0);
  let totalSeconds = 0;
  const timed = hasTimedIntervals(points);

  points.forEach((point, index) => {
    const value = getValue(point);
    if (!Number.isFinite(value) || value == null || value <= 0) {
      return;
    }

    const duration = timed ? getPointDurationSeconds(points, index) : 1;
    if (duration <= 0) {
      return;
    }

    const binIndex = bins.findIndex((bin) => {
      return typeof bin.maxInclusive === "number" ? value <= bin.maxInclusive : true;
    });
    if (binIndex < 0) {
      return;
    }

    seconds[binIndex] += duration;
    totalSeconds += duration;
  });

  if (totalSeconds <= 0) {
    return [];
  }

  return bins.map((bin, index) => ({
    label: bin.label,
    seconds: seconds[index],
    percentage: (seconds[index] / totalSeconds) * 100,
  }));
}

function isRatioAtMost(value: number, maxInclusive: number): boolean {
  return value <= maxInclusive + ZONE_RATIO_EPSILON;
}

function formatZoneLabel(
  zone: ZoneDefinition,
  previousZone: ZoneDefinition | undefined,
  threshold: number,
  options: ZoneLabelOptions,
): string {
  const zoneKey = getZoneKey(zone.label);

  if (!Number.isFinite(zone.maxRatio)) {
    const previousMaxRatio = previousZone?.maxRatio;
    if (typeof previousMaxRatio !== "number" || !Number.isFinite(previousMaxRatio)) {
      return zoneKey;
    }

    return `${zoneKey}: >${formatCompactNumber(previousMaxRatio * threshold)} ${options.unit}`;
  }

  return `${zoneKey}: ≤${formatCompactNumber(zone.maxRatio * threshold)} ${options.unit}`;
}

function getZoneKey(label: string): string {
  return label.trim().split(/\s+/)[0] || label;
}

function getPowerCurvePoints(activity: TrackActivity): PowerCurvePoint[] {
  const bestEfforts = asRecord(activity.metadata.bestEfforts);
  const powerW = asRecord(bestEfforts?.powerW);

  if (!powerW) {
    return [];
  }

  return POWER_CURVE_DURATIONS_SECONDS
    .map((durationSeconds): PowerCurvePoint | undefined => {
      const watts = Number(powerW[String(durationSeconds)]);
      return Number.isFinite(watts)
        ? { durationSeconds, watts }
        : undefined;
    })
    .filter((point): point is PowerCurvePoint => point !== undefined);
}

function hasTimedIntervals(points: TrackPoint[]): boolean {
  return points.some((point, index) => getPointDurationSeconds(points, index) > 0);
}

function getPointDurationSeconds(points: TrackPoint[], index: number): number {
  const current = points[index];
  const next = points[index + 1];
  if (!current || !next || !Number.isFinite(current.time) || !Number.isFinite(next.time)) {
    return 0;
  }
  return Math.max(0, (next.time || 0) - (current.time || 0));
}

function getPointDistanceM(points: TrackPoint[]): number | undefined {
  const distances = points
    .map((point) => point.distanceM)
    .filter((value): value is number => Number.isFinite(value));
  if (distances.length < 2) {
    return undefined;
  }
  return Math.max(...distances) - Math.min(...distances);
}

function getElevationGainM(points: TrackPoint[]): number {
  let gain = 0;
  let previous: number | undefined;

  points.forEach((point) => {
    if (!Number.isFinite(point.elevationM)) {
      return;
    }
    const elevation = point.elevationM || 0;
    if (previous != null && elevation > previous) {
      gain += elevation - previous;
    }
    previous = elevation;
  });

  return gain;
}


function haversineDistanceM(
  a: TrackPoint & { lat: number; lon: number },
  b: TrackPoint & { lat: number; lon: number },
): number {
  const earthRadiusM = 6371008.8;
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const deltaLat = degreesToRadians(b.lat - a.lat);
  const deltaLon = degreesToRadians(b.lon - a.lon);
  const sinHalfLat = Math.sin(deltaLat / 2);
  const sinHalfLon = Math.sin(deltaLon / 2);
  const h = sinHalfLat * sinHalfLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}


type CompressionStreamConstructor = new (
  format: string
) => TransformStream<Uint8Array, Uint8Array>;

function getCompressionStream(
  name: "CompressionStream" | "DecompressionStream",
): CompressionStreamConstructor | undefined {
  const win = window as typeof window & Partial<Record<
    "CompressionStream" | "DecompressionStream",
    CompressionStreamConstructor
  >>;
  return win[name];
}

function copyUint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function gzipText(text: string): Promise<Blob> {
  const streamCtor = getCompressionStream("CompressionStream");
  if (typeof streamCtor !== "function") {
    return new Blob([text], { type: "application/json" });
  }

  const stream = new Blob([text]).stream().pipeThrough(new streamCtor("gzip"));
  return new Response(stream).blob();
}

async function decompressGzipText(buffer: ArrayBuffer): Promise<string> {
  const streamCtor = getCompressionStream("DecompressionStream");
  if (typeof streamCtor !== "function") {
    throw new Error("This browser does not support TRJGZ decompression.");
  }

  const stream = new Blob([buffer]).stream().pipeThrough(new streamCtor("gzip"));
  return new Response(stream).text();
}

function summarizeSources(inputs: ParsedInput[]): string {
  const counts = inputs.reduce<Record<SourceType, number>>((acc, input) => {
    acc[input.sourceType] += 1;
    return acc;
  }, { fit: 0, gpx: 0, trackjson: 0, trjgz: 0 });

  return [
    counts.fit ? `${counts.fit} FIT` : "",
    counts.gpx ? `${counts.gpx} GPX` : "",
    counts.trackjson ? `${counts.trackjson} TrackJSON` : "",
    counts.trjgz ? `${counts.trjgz} TRJGZ` : "",
  ].filter(Boolean).join(" + ");
}

function parsePositiveInt(value: string, min: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, n) : min;
}

function parseNonNegativeInt(value: string): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function fileTitle(file: File | undefined): string {
  return safeBaseName(file?.name || "track");
}

function safeBaseName(name: string): string {
  return (name.replace(/\.[^.]*$/, "").trim() || "track").replace(/[^\w.-]+/g, "-");
}


function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getNumberProperty(value: Record<string, unknown> | undefined, key: string) {
  return value ? numberValue(value[key]) : undefined;
}

function getNestedNumber(value: Record<string, unknown> | undefined, key: string, childKey: string) {
  return getNumberProperty(asRecord(value?.[key]), childKey);
}

function getStringProperty(value: Record<string, unknown> | undefined, key: string) {
  const property = value?.[key];
  return typeof property === "string" ? property : undefined;
}

function formatNumber(value: number, fractionDigits: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}


function formatCompactNumber(value: number): string {
  return formatNumber(value, 1);
}

function formatDistance(distanceM: number): string {
  if (distanceM >= 1000) {
    return `${formatNumber(distanceM / 1000, 2)} km`;
  }
  return `${formatNumber(distanceM, 0)} m`;
}

function formatCoordinate(lon: number, lat: number): string {
  return `${formatDirectionalCoordinate(lon, "E", "W")}, ` +
    formatDirectionalCoordinate(lat, "N", "S");
}

function formatDirectionalCoordinate(
  value: number,
  positiveSuffix: string,
  negativeSuffix: string
): string {
  const suffix = value < 0 ? negativeSuffix : positiveSuffix;
  return `${Math.abs(value).toFixed(4)}${suffix}`;
}

function formatLocalDateTime(
  unixSeconds: number,
  offsetSeconds: number | undefined
): string {
  if (typeof offsetSeconds === "number" && Number.isFinite(offsetSeconds)) {
    return formatDateTimeParts(new Date((unixSeconds + offsetSeconds) * 1000), true);
  }

  return formatDateTimeParts(new Date(unixSeconds * 1000), false);
}

function formatDateTimeParts(date: Date, useUtcFields: boolean): string {
  const year = useUtcFields ? date.getUTCFullYear() : date.getFullYear();
  const month = useUtcFields ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = useUtcFields ? date.getUTCDate() : date.getDate();
  const hours = useUtcFields ? date.getUTCHours() : date.getHours();
  const minutes = useUtcFields ? date.getUTCMinutes() : date.getMinutes();
  const seconds = useUtcFields ? date.getUTCSeconds() : date.getSeconds();

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ` +
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    String(seconds).padStart(2, "0");
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDurationLabel(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${formatNumber(seconds / 60, seconds % 60 === 0 ? 0 : 1)}m`;
  }
  return `${formatNumber(seconds / 3600, seconds % 3600 === 0 ? 0 : 1)}h`;
}

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
