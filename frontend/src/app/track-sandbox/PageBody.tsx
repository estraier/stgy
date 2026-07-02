"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { GeoJSON as LeafletGeoJson, Map as LeafletMap } from "leaflet";
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
  obfuscateFitPrivacy,
  parseFitBytes,
  trackActivityToTrackJson,
} from "stgy-track/fit";
import type { TrackActivity, TrackPoint } from "stgy-track/fit";
import {
  countTrackJsonPositionedPoints,
  obfuscateTrackJsonPrivacy,
  parseTrackJsonData,
} from "stgy-track/trackjson";

type SourceType = "fit" | "trackjson" | "trjgz";
type DownsampleStrategy = "uniform" | "aggregate";

type ParsedInput = {
  file: File;
  activity: TrackActivity;
  sourceType: SourceType;
  originalPointCount: number;
  fitBytes?: Uint8Array;
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
  activity: TrackActivity;
  renderedActivity: TrackActivity;
  originalPointCount: number;
  renderedPointCount: number;
  sourceLabel: string;
  fitBytes?: Uint8Array;
};

type ObjectUrlSet = {
  raw?: string;
  gzip?: string;
  fit?: string;
};

type SummaryCard = {
  label: string;
  value: string;
  sub?: string;
  icon: ComponentType<{ className?: string }>;
};

type ZoneRow = {
  label: string;
  seconds: number;
  percentage: number;
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
  { label: "Z3 Tempo", maxRatio: 0.93 },
  { label: "Z4 Threshold", maxRatio: 0.99 },
  { label: "Z5 Hard", maxRatio: Number.POSITIVE_INFINITY },
];

export default function TrackSandbox() {
  const [files, setFiles] = useState<File[]>([]);
  const [downsample, setDownsample] = useState(false);
  const [strategy, setStrategy] = useState<DownsampleStrategy>("aggregate");
  const [maxPoints, setMaxPoints] = useState(DEFAULT_MAX_POINTS);
  const [preserveEndpoints, setPreserveEndpoints] = useState(true);
  const [obfuscatePrivacy, setObfuscatePrivacy] = useState(false);
  const [privacyStartDistanceM, setPrivacyStartDistanceM] = useState(1000);
  const [privacyEndDistanceM, setPrivacyEndDistanceM] = useState(1000);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [ftpW, setFtpW] = useState(DEFAULT_FTP_W);
  const [lthrBpm, setLthrBpm] = useState(DEFAULT_LTHR_BPM);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Choose FIT, TrackJSON, or TRJGZ files.");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackResult | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<ObjectUrlSet>({});

  const revokeUrls = useCallback((urls: ObjectUrlSet) => {
    if (urls.raw) URL.revokeObjectURL(urls.raw);
    if (urls.gzip) URL.revokeObjectURL(urls.gzip);
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
      setError("Choose at least one FIT, TrackJSON, or TRJGZ file.");
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
      const fitUrl = nextResult.fitBytes
        ? URL.createObjectURL(new Blob([nextResult.fitBytes], {
          type: "application/octet-stream",
        }))
        : undefined;

      setDownloadUrls((current) => {
        revokeUrls(current);
        return { raw: rawUrl, gzip: gzipUrl, fit: fitUrl };
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
    setFiles([]);
    setResult(null);
    setError(null);
    setStatus("Choose FIT, TrackJSON, or TRJGZ files.");
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
              Convert FIT / TrackJSON rides, preview them on a cycling map,
              and download public-safe TrackJSON.
            </p>
          </div>
          <div className="rounded-full border border-sky-100 bg-white px-4 py-2 text-xs text-slate-500">
            Default map: <span className="font-semibold text-slate-800">CyclOSM</span>
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
                type="file"
                multiple
                accept=".fit,.trj,.json,.geojson,.trjgz,application/json,application/gzip"
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
                <TrackMap trackJsonData={result.trackJsonData} />
              </section>

              <section className="space-y-4">
                <RideSummary activity={result.activity} />

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

function TrackMap({ trackJsonData }: { trackJsonData: unknown }) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let disposed = false;
    let routeLayer: LeafletGeoJson | null = null;

    (async () => {
      const L = await import("leaflet");
      const canvas = canvasRef.current;
      if (!canvas || disposed) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const cyclosm = L.tileLayer(
        "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
        { attribution: "&copy; CyclOSM", maxNativeZoom: 20, maxZoom: 20 },
      );
      const osm = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { attribution: "&copy; OpenStreetMap", maxNativeZoom: 19, maxZoom: 20 },
      );
      const opentopo = L.tileLayer(
        "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        { attribution: "&copy; OpenTopoMap", maxNativeZoom: 17, maxZoom: 20 },
      );
      const gsiPale = L.tileLayer(
        "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
        { attribution: "&copy; GSI Japan", maxNativeZoom: 18, maxZoom: 20 },
      );

      const map = L.map(canvas, {
        center: [35.681, 139.767],
        zoom: 13,
        layers: [cyclosm],
        scrollWheelZoom: false,
      });
      mapRef.current = map;

      L.control.layers({
        CyclOSM: cyclosm,
        OpenStreetMap: osm,
        OpenTopoMap: opentopo,
        "GSI Pale": gsiPale,
      }).addTo(map);

      routeLayer = L.geoJSON(trackJsonData as GeoJSON.GeoJsonObject, {
        style: {
          color: "#0f80c9",
          weight: 5,
          opacity: 0.88,
        },
      }).addTo(map);

      const bounds = routeLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [28, 28] });
      }
    })().catch(() => {});

    return () => {
      disposed = true;
      if (routeLayer) {
        routeLayer.remove();
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [trackJsonData]);

  return <div ref={canvasRef} className="h-[520px] w-full bg-slate-100" />;
}

function RideSummary({ activity }: { activity: TrackActivity }) {
  const cards = useMemo(() => buildSummaryCards(activity), [activity]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Ride summary</h2>
        <Bike className="h-5 w-5 text-sky-700" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl bg-slate-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
              <card.icon className="h-4 w-4 text-sky-700" />
              {card.label}
            </div>
            <div className="text-xl font-bold tabular-nums text-slate-950">{card.value}</div>
            {card.sub && <div className="mt-1 text-xs text-slate-500">{card.sub}</div>}
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
    }, [
      { label: "≤15 km/h", matches: (value) => value <= 15 },
      { label: "15–20", matches: (value) => value > 15 && value <= 20 },
      { label: "20–25", matches: (value) => value > 20 && value <= 25 },
      { label: "25–30", matches: (value) => value > 25 && value <= 30 },
      { label: "30–35", matches: (value) => value > 30 && value <= 35 },
      { label: ">35", matches: (value) => value > 35 },
    ]);
  }, [activity.points]);
  const cadenceRows = useMemo(() => {
    return computeHistogramRows(activity.points, (point) => point.cadenceRpm, [
      { label: "≤50 rpm", matches: (value) => value <= 50 },
      { label: "50–60", matches: (value) => value > 50 && value <= 60 },
      { label: "60–70", matches: (value) => value > 60 && value <= 70 },
      { label: "70–80", matches: (value) => value > 70 && value <= 80 },
      { label: "80–90", matches: (value) => value > 80 && value <= 90 },
      { label: "90–100", matches: (value) => value > 90 && value <= 100 },
      { label: ">100", matches: (value) => value > 100 },
    ]);
  }, [activity.points]);
  const powerZones = useMemo(() => {
    return computeZoneRows(activity.points, (point) => point.powerW, ftpW, POWER_ZONES);
  }, [activity.points, ftpW]);
  const heartRateZones = useMemo(() => {
    return computeZoneRows(
      activity.points,
      (point) => point.heartRateBpm,
      lthrBpm,
      HEART_RATE_ZONES,
    );
  }, [activity.points, lthrBpm]);
  const powerCurve = useMemo(() => getPowerCurvePoints(activity), [activity]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-slate-900">Analysis</h2>
      <div className="grid gap-5 lg:grid-cols-2">
        {speedRows.length > 0 && <ZoneBars title="Speed histogram" rows={speedRows} />}
        {cadenceRows.length > 0 && <ZoneBars title="Cadence histogram" rows={cadenceRows} />}
        {powerZones.length > 0 && (
          <ZoneBars title={`Power zones · FTP ${ftpW} W`} rows={powerZones} />
        )}
        {heartRateZones.length > 0 && (
          <ZoneBars title={`Heart-rate zones · LTHR ${lthrBpm} bpm`} rows={heartRateZones} />
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
  const minDuration = points[0]?.durationSeconds || 5;
  const maxDuration = points[points.length - 1]?.durationSeconds || 7200;
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
        <path d={path} fill="none" stroke="#0f80c9" strokeWidth="2.6" />
        {points.map((point) => (
          <g key={point.durationSeconds}>
            <circle cx={xValue(point.durationSeconds)} cy={yValue(point.watts)} r="2.5"
              fill="#0f80c9" />
            <text x={xValue(point.durationSeconds)} y={height - 9} textAnchor="middle"
              fontSize="7" fill="#64748b">
              {formatDurationLabel(point.durationSeconds)}
            </text>
          </g>
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
          <div key={row.label} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2">
            <div className="text-xs text-slate-600">{row.label}</div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-sky-600"
                style={{ width: `${Math.max(2, row.percentage)}%` }}
              />
            </div>
            <div className="text-right text-xs tabular-nums text-slate-500">
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

  const parsed = await Promise.all(files.map((file) => parseInputFile(file, options)));
  const firstParsed = parsed[0];
  if (!firstParsed) {
    throw new Error("No track file could be parsed.");
  }

  const title = files.length === 1 ? fileTitle(firstFile) : `${fileTitle(firstFile)} merged`;
  const activity = parsed.length === 1
    ? firstParsed.activity
    : mergeLocalTrackActivities(parsed.map((item) => item.activity), {
      name: title,
      description: `Merged from ${files.map((file) => file.name).join(", ")}`,
    });
  const renderedActivity = options.downsample
    ? downsampleTrackActivity(activity, {
      maxPoints: options.maxPoints,
      strategy: options.strategy,
      preserveEndpoints: options.preserveEndpoints,
    })
    : activity;
  const trackJson = trackActivityToTrackJson(renderedActivity, {
    title,
    description: files.length === 1
      ? `Converted from ${firstFile.name}`
      : `Merged from ${files.map((file) => file.name).join(", ")}`,
    includeMetadata: true,
    pretty: false,
  });

  return {
    title,
    trackJson,
    trackJsonData: JSON.parse(trackJson),
    activity,
    renderedActivity,
    originalPointCount: parsed.reduce((sum, item) => sum + item.originalPointCount, 0),
    renderedPointCount: renderedActivity.points.length,
    sourceLabel: summarizeSources(parsed),
    fitBytes: activityToFitBytes(renderedActivity),
  };
}

async function parseInputFile(file: File, options: ConvertOptions): Promise<ParsedInput> {
  const lowerName = file.name.toLowerCase();

  if (
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".geojson") ||
    lowerName.endsWith(".trj")
  ) {
    const text = await file.text();
    return parseTrackJsonInput(file, text, options, "trackjson");
  }

  if (lowerName.endsWith(".trjgz")) {
    const text = await decompressGzipText(await file.arrayBuffer());
    return parseTrackJsonInput(file, text, options, "trjgz");
  }

  const originalBytes = await file.arrayBuffer();
  const privacyOptions = {
    startDistanceM: options.privacyStartDistanceM,
    endDistanceM: options.privacyEndDistanceM,
  };
  const fitBytes = options.obfuscatePrivacy
    ? obfuscateFitPrivacy(originalBytes, privacyOptions)
    : new Uint8Array(originalBytes);
  const activity = parseFitBytes(fitBytes);
  activity.metadata.name = fileTitle(file);

  return {
    file,
    activity,
    sourceType: "fit",
    originalPointCount: activity.points.length,
    fitBytes,
  };
}

function parseTrackJsonInput(
  file: File,
  text: string,
  options: ConvertOptions,
  sourceType: "trackjson" | "trjgz",
): ParsedInput {
  const originalData = parseTrackJsonData(text);
  const privacyOptions = {
    startDistanceM: options.privacyStartDistanceM,
    endDistanceM: options.privacyEndDistanceM,
  };
  const publicData = options.obfuscatePrivacy
    ? obfuscateTrackJsonPrivacy(originalData, privacyOptions)
    : originalData;
  const activity = trackJsonDataToLocalActivity(publicData, {
    sourceType,
    name: fileTitle(file),
  });

  return {
    file,
    activity,
    sourceType,
    originalPointCount: countTrackJsonPositionedPoints(originalData),
  };
}

type LocalTrackJsonActivityOptions = {
  sourceType: SourceType;
  name: string;
};

type LocalMergeOptions = {
  name: string;
  description: string;
};

type IndexedPoint = {
  activityIndex: number;
  pointIndex: number;
  point: TrackPoint;
};

function trackJsonDataToLocalActivity(
  data: unknown,
  options: LocalTrackJsonActivityOptions,
): TrackActivity {
  const features = getTrackJsonLineStringFeatures(data);
  const points: TrackPoint[] = [];

  features.forEach((feature) => {
    const geometry = asRecord(feature.geometry);
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
    const properties = asRecord(feature.properties);
    const coordinateProperties = asRecord(properties?.coordinateProperties);

    coordinates.forEach((coordinate, index) => {
      const point = trackJsonCoordinateToPoint(coordinate, coordinateProperties, index);
      if (hasPointValue(point)) {
        points.push(point);
      }
    });
  });

  const metadata = {
    name: options.name,
    source: { type: options.sourceType },
  } as TrackActivity["metadata"];

  applyLocalComputedMetadata(metadata, points);

  return {
    schemaVersion: 1,
    metadata,
    points,
    warnings: [],
  };
}

function mergeLocalTrackActivities(
  activities: TrackActivity[],
  options: LocalMergeOptions,
): TrackActivity {
  const indexedPoints: IndexedPoint[] = [];
  let distanceOffsetM = 0;

  getActivityMergeOrder(activities).forEach((activity, activityIndex) => {
    const points = normalizeActivityDistances(activity.points, distanceOffsetM);
    const delta = getActivityDistanceDelta(points);

    points.forEach((point, pointIndex) => {
      indexedPoints.push({ activityIndex, pointIndex, point });
    });

    if (typeof delta === "number" && delta > 0) {
      distanceOffsetM += delta;
    }
  });

  indexedPoints.sort(compareIndexedPoints);
  const points = indexedPoints.map((item) => ({ ...item.point }));
  const metadata = {
    ...activities[0]?.metadata,
    name: options.name,
    description: options.description,
    source: { type: "merged" },
  } as TrackActivity["metadata"];

  const times = points.map((point) => point.time).filter(isFiniteNumber);
  if (times.length > 0) {
    metadata.startTime = Math.min(...times);
    metadata.totalElapsedTime = Math.max(...times) - metadata.startTime;
  }

  const totalDistanceM = getPointDistanceM(points);
  if (typeof totalDistanceM === "number") {
    metadata.totalDistanceM = totalDistanceM;
  }

  const movingTime = calculateMovingTime(indexedPoints);
  if (movingTime > 0) {
    metadata.totalTimerTime = movingTime;
  }

  applyLocalComputedMetadata(metadata, points);

  return {
    schemaVersion: 1,
    metadata,
    points,
    warnings: activities.flatMap((activity) => activity.warnings || []),
  };
}

function getTrackJsonLineStringFeatures(data: unknown): Record<string, unknown>[] {
  const record = asRecord(data);
  if (!record) {
    return [];
  }

  if (record.type === "Feature") {
    return isTrackJsonLineStringFeature(record) ? [record] : [];
  }

  if (record.type !== "FeatureCollection" || !Array.isArray(record.features)) {
    return [];
  }

  return record.features.filter(isTrackJsonLineStringFeature);
}

function isTrackJsonLineStringFeature(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value);
  const geometry = asRecord(record?.geometry);
  return geometry?.type === "LineString" && Array.isArray(geometry.coordinates);
}

function trackJsonCoordinateToPoint(
  coordinate: unknown,
  coordinateProperties: Record<string, unknown> | undefined,
  index: number,
): TrackPoint {
  const point: TrackPoint = {};

  if (Array.isArray(coordinate)) {
    const lon = numberValue(coordinate[0]);
    const lat = numberValue(coordinate[1]);
    const elevation = numberValue(coordinate[2]);
    if (typeof lon === "number") point.lon = lon;
    if (typeof lat === "number") point.lat = lat;
    if (typeof elevation === "number") point.elevationM = elevation;
  }

  if (!coordinateProperties) {
    return point;
  }

  assignPointSeries(point, "time", coordinateProperties.times, index);
  assignPointSeries(point, "distanceM", coordinateProperties.distances, index);
  assignPointSeries(point, "elevationM", coordinateProperties.elevations, index);
  assignPointSeries(point, "heartRateBpm", coordinateProperties.heartRates, index);
  assignPointSeries(point, "cadenceRpm", coordinateProperties.cadences, index);
  assignPointSeries(point, "powerW", coordinateProperties.powers, index);
  assignPointSeries(point, "speedMps", coordinateProperties.speeds, index, (value) => value / 3.6);

  return point;
}

function assignPointSeries(
  point: TrackPoint,
  key: keyof TrackPoint,
  series: unknown,
  index: number,
  convert: (value: number) => number = (value) => value,
) {
  if (!Array.isArray(series)) {
    return;
  }

  const value = numberValue(series[index]);
  if (typeof value === "number") {
    point[key] = convert(value) as never;
  }
}

function hasPointValue(point: TrackPoint): boolean {
  return Object.values(point).some((value) => typeof value !== "undefined");
}

function getActivityMergeOrder(activities: TrackActivity[]): TrackActivity[] {
  return [...activities].sort((a, b) => {
    const left = getActivityStartTime(a);
    const right = getActivityStartTime(b);
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    if (typeof left === "number") {
      return -1;
    }
    if (typeof right === "number") {
      return 1;
    }
    return 0;
  });
}

function getActivityStartTime(activity: TrackActivity): number | undefined {
  const pointTimes = activity.points.map((point) => point.time).filter(isFiniteNumber);
  if (pointTimes.length > 0) {
    return Math.min(...pointTimes);
  }
  return numberValue(activity.metadata.startTime);
}

function normalizeActivityDistances(points: TrackPoint[], offsetM: number): TrackPoint[] {
  const cloned = points.map((point) => ({ ...point }));
  const distances = cloned.map((point) => point.distanceM).filter(isFiniteNumber);

  if (distances.length > 0) {
    const first = distances[0] || 0;
    cloned.forEach((point) => {
      if (typeof point.distanceM === "number") {
        point.distanceM = Math.max(0, point.distanceM - first) + offsetM;
      }
    });
    return cloned;
  }

  let cumulative = offsetM;
  let previous: TrackPoint | undefined;

  cloned.forEach((point) => {
    if (hasPosition(point)) {
      if (previous && hasPosition(previous)) {
        cumulative += haversineDistanceM(previous, point);
      }
      point.distanceM = cumulative;
      previous = point;
    }
  });

  return cloned;
}

function getActivityDistanceDelta(points: TrackPoint[]): number | undefined {
  const distances = points.map((point) => point.distanceM).filter(isFiniteNumber);
  if (distances.length < 2) {
    return undefined;
  }
  return Math.max(0, distances[distances.length - 1] - distances[0]);
}

function compareIndexedPoints(a: IndexedPoint, b: IndexedPoint): number {
  if (typeof a.point.time === "number" && typeof b.point.time === "number") {
    return a.point.time - b.point.time ||
      a.activityIndex - b.activityIndex ||
      a.pointIndex - b.pointIndex;
  }
  if (typeof a.point.time === "number") {
    return -1;
  }
  if (typeof b.point.time === "number") {
    return 1;
  }
  return a.activityIndex - b.activityIndex || a.pointIndex - b.pointIndex;
}

function calculateMovingTime(indexedPoints: IndexedPoint[]): number {
  const groups = new Map<number, IndexedPoint[]>();
  indexedPoints.forEach((item) => {
    const group = groups.get(item.activityIndex) || [];
    group.push(item);
    groups.set(item.activityIndex, group);
  });

  let total = 0;
  groups.forEach((group) => {
    const ordered = [...group].sort(compareIndexedPoints);
    for (let index = 1; index < ordered.length; index += 1) {
      const prev = ordered[index - 1].point;
      const cur = ordered[index].point;
      if (typeof prev.time !== "number" || typeof cur.time !== "number") {
        continue;
      }

      const dt = cur.time - prev.time;
      if (dt <= 0) {
        continue;
      }

      if (isMovingInterval(prev, cur)) {
        total += dt;
      }
    }
  });

  return total;
}

function isMovingInterval(prev: TrackPoint, cur: TrackPoint): boolean {
  if (typeof prev.speedMps === "number" || typeof cur.speedMps === "number") {
    return (prev.speedMps || 0) > 0.5 || (cur.speedMps || 0) > 0.5;
  }
  if (typeof prev.distanceM === "number" && typeof cur.distanceM === "number") {
    return cur.distanceM > prev.distanceM;
  }
  return hasPosition(prev) && hasPosition(cur) && (prev.lat !== cur.lat || prev.lon !== cur.lon);
}

function applyLocalComputedMetadata(metadata: TrackActivity["metadata"], points: TrackPoint[]) {
  const distanceM = getPointDistanceM(points);
  if (typeof distanceM === "number" && typeof metadata.totalDistanceM !== "number") {
    metadata.totalDistanceM = distanceM;
  }

  if (!metadata.statistics) {
    metadata.statistics = buildLocalStatistics(points);
  }
}

function buildLocalStatistics(points: TrackPoint[]): TrackActivity["metadata"]["statistics"] {
  return {
    speedKph: numericStats(points
      .map((point) => typeof point.speedMps === "number" ? point.speedMps * 3.6 : undefined)),
    cadenceRpm: numericStats(points.map((point) => point.cadenceRpm)),
    heartRateBpm: numericStats(points.map((point) => point.heartRateBpm)),
    powerW: numericStats(points.map((point) => point.powerW)),
    temperatureC: numericStats(points.map((point) => point.temperatureC)),
  };
}

function numericStats(values: (number | undefined)[]) {
  const nums = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (nums.length === 0) {
    return undefined;
  }

  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 === 0
    ? ((nums[mid - 1] || 0) + (nums[mid] || 0)) / 2
    : nums[mid];

  return {
    avg: nums.reduce((sum, value) => sum + value, 0) / nums.length,
    median,
    max: nums[nums.length - 1],
  };
}

function hasPosition(point: TrackPoint): point is TrackPoint & { lat: number; lon: number } {
  return typeof point.lat === "number" && typeof point.lon === "number";
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const FIT_EPOCH_UNIX_SECONDS = 631065600;
const FIT_CRC_TABLE = [
  0x0000,
  0xcc01,
  0xd801,
  0x1400,
  0xf001,
  0x3c00,
  0x2800,
  0xe401,
  0xa001,
  0x6c00,
  0x7800,
  0xb401,
  0x5000,
  0x9c01,
  0x8801,
  0x4400,
] as const;

type FitFieldDefinition = {
  num: number;
  size: number;
  baseType: number;
};

type FitRecordField = FitFieldDefinition & {
  write: (view: DataView, offset: number, point: TrackPoint, fallbackTime: number) => void;
};

function activityToFitBytes(activity: TrackActivity): Uint8Array {
  const points = activity.points.filter((point) => {
    return hasPosition(point) || typeof point.time === "number";
  });
  const chunks: number[] = [];

  writeDefinitionMessage(chunks, 0, 0, [
    { num: 0, size: 1, baseType: 0x00 },
    { num: 4, size: 4, baseType: 0x86 },
  ]);
  writeFileIdMessage(chunks, getActivityFitStartTime(activity, points));
  writeDefinitionMessage(chunks, 1, 20, getFitRecordFields());

  points.forEach((point, index) => {
    writeRecordMessage(chunks, point, index);
  });

  const data = new Uint8Array(chunks);
  const header = new Uint8Array(14);
  const headerView = new DataView(header.buffer);
  header[0] = 14;
  header[1] = 16;
  headerView.setUint16(2, 2135, true);
  headerView.setUint32(4, data.length, true);
  header[8] = 0x2e;
  header[9] = 0x46;
  header[10] = 0x49;
  header[11] = 0x54;
  const headerCrc = calculateFitCrc(header.subarray(0, 12));
  headerView.setUint16(12, headerCrc, true);

  const body = new Uint8Array(header.length + data.length + 2);
  body.set(header, 0);
  body.set(data, header.length);
  const fileCrc = calculateFitCrc(body.subarray(0, header.length + data.length));
  new DataView(body.buffer).setUint16(header.length + data.length, fileCrc, true);
  return body;
}

function writeDefinitionMessage(
  chunks: number[],
  localMessageType: number,
  globalMessageNumber: number,
  fields: FitFieldDefinition[],
) {
  chunks.push(0x40 | localMessageType);
  chunks.push(0);
  chunks.push(0);
  pushUint16(chunks, globalMessageNumber);
  chunks.push(fields.length);

  fields.forEach((field) => {
    chunks.push(field.num);
    chunks.push(field.size);
    chunks.push(field.baseType);
  });
}

function writeFileIdMessage(chunks: number[], fitStartTime: number) {
  chunks.push(0);
  chunks.push(4);
  pushUint32(chunks, fitStartTime);
}

function getFitRecordFields(): FitRecordField[] {
  return [
    {
      num: 253,
      size: 4,
      baseType: 0x86,
      write: (view, offset, _point, fallbackTime) => view.setUint32(offset, fallbackTime, true),
    },
    {
      num: 0,
      size: 4,
      baseType: 0x85,
      write: (view, offset, point) => writeFitSemicircles(view, offset, point.lat),
    },
    {
      num: 1,
      size: 4,
      baseType: 0x85,
      write: (view, offset, point) => writeFitSemicircles(view, offset, point.lon),
    },
    {
      num: 2,
      size: 2,
      baseType: 0x84,
      write: (view, offset, point) => writeFitScaledUint16(view, offset, point.elevationM, 5, 500),
    },
    {
      num: 5,
      size: 4,
      baseType: 0x86,
      write: (view, offset, point) => writeFitScaledUint32(view, offset, point.distanceM, 100, 0),
    },
    {
      num: 6,
      size: 2,
      baseType: 0x84,
      write: (view, offset, point) => writeFitScaledUint16(view, offset, point.speedMps, 1000, 0),
    },
    {
      num: 3,
      size: 1,
      baseType: 0x02,
      write: (view, offset, point) => writeFitUint8(view, offset, point.heartRateBpm),
    },
    {
      num: 4,
      size: 1,
      baseType: 0x02,
      write: (view, offset, point) => writeFitUint8(view, offset, point.cadenceRpm),
    },
    {
      num: 7,
      size: 2,
      baseType: 0x84,
      write: (view, offset, point) => writeFitUint16(view, offset, point.powerW),
    },
    {
      num: 13,
      size: 1,
      baseType: 0x01,
      write: (view, offset, point) => writeFitSint8(view, offset, point.temperatureC),
    },
  ];
}

function writeRecordMessage(chunks: number[], point: TrackPoint, index: number) {
  const fields = getFitRecordFields();
  const size = fields.reduce((sum, field) => sum + field.size, 0);
  const record = new Uint8Array(size);
  const view = new DataView(record.buffer);
  const fallbackTime = getPointFitTimestamp(point, index);
  let offset = 0;

  fields.forEach((field) => {
    field.write(view, offset, point, fallbackTime);
    offset += field.size;
  });

  chunks.push(1);
  chunks.push(...record);
}

function getActivityFitStartTime(activity: TrackActivity, points: TrackPoint[]): number {
  const startTime = numberValue(activity.metadata.startTime) ??
    points.map((point) => point.time).filter(isFiniteNumber)[0] ??
    Math.floor(Date.now() / 1000);
  return unixTimeToFitTime(startTime);
}

function getPointFitTimestamp(point: TrackPoint, index: number): number {
  const time = typeof point.time === "number"
    ? point.time
    : Math.floor(Date.now() / 1000) + index;
  return unixTimeToFitTime(time);
}

function unixTimeToFitTime(unixTimeSeconds: number): number {
  return Math.max(0, Math.round(unixTimeSeconds - FIT_EPOCH_UNIX_SECONDS));
}

function writeFitSemicircles(view: DataView, offset: number, degrees: number | undefined) {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) {
    view.setInt32(offset, 0x7fffffff, true);
    return;
  }
  view.setInt32(offset, Math.round((degrees * 0x80000000) / 180), true);
}

function writeFitScaledUint32(
  view: DataView,
  offset: number,
  value: number | undefined,
  scale: number,
  offsetValue: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    view.setUint32(offset, 0xffffffff, true);
    return;
  }
  view.setUint32(offset, Math.max(0, Math.round((value + offsetValue) * scale)), true);
}

function writeFitScaledUint16(
  view: DataView,
  offset: number,
  value: number | undefined,
  scale: number,
  offsetValue: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    view.setUint16(offset, 0xffff, true);
    return;
  }
  view.setUint16(offset, Math.max(0, Math.round((value + offsetValue) * scale)), true);
}

function writeFitUint16(view: DataView, offset: number, value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    view.setUint16(offset, 0xffff, true);
    return;
  }
  view.setUint16(offset, Math.max(0, Math.round(value)), true);
}

function writeFitUint8(view: DataView, offset: number, value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    view.setUint8(offset, 0xff);
    return;
  }
  view.setUint8(offset, Math.max(0, Math.min(254, Math.round(value))));
}

function writeFitSint8(view: DataView, offset: number, value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    view.setInt8(offset, 0x7f);
    return;
  }
  view.setInt8(offset, Math.max(-127, Math.min(126, Math.round(value))));
}

function pushUint16(chunks: number[], value: number) {
  chunks.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(chunks: number[], value: number) {
  chunks.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function calculateFitCrc(bytes: Uint8Array): number {
  let crc = 0;

  bytes.forEach((byte) => {
    let tmp = FIT_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte & 0x0f];

    tmp = FIT_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[(byte >> 4) & 0x0f];
  });

  return crc & 0xffff;
}

function buildSummaryCards(activity: TrackActivity): SummaryCard[] {
  const metadata = activity.metadata;
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

  return cards;
}

function computeZoneRows(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  threshold: number,
  zones: { label: string; maxRatio: number }[],
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
    const zoneIndex = zones.findIndex((zone) => ratio <= zone.maxRatio);
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
    label: zone.label,
    seconds: seconds[index],
    percentage: (seconds[index] / totalSeconds) * 100,
  }));
}

function computeHistogramRows(
  points: TrackPoint[],
  getValue: (point: TrackPoint) => number | undefined,
  bins: { label: string; matches: (value: number) => boolean }[],
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

    const binIndex = bins.findIndex((bin) => bin.matches(value));
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

function getPowerCurvePoints(activity: TrackActivity): PowerCurvePoint[] {
  const bestEfforts = asRecord(activity.metadata.bestEfforts);
  const powerW = asRecord(bestEfforts?.powerW);

  if (!powerW) {
    return [];
  }

  return Object.entries(powerW)
    .map(([duration, watts]) => {
      const durationSeconds = Number(duration);
      const power = Number(watts);
      return Number.isFinite(durationSeconds) && Number.isFinite(power)
        ? { durationSeconds, watts: power }
        : undefined;
    })
    .filter((point): point is PowerCurvePoint => Boolean(point))
    .sort((a, b) => a.durationSeconds - b.durationSeconds);
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
  }, { fit: 0, trackjson: 0, trjgz: 0 });

  return [
    counts.fit ? `${counts.fit} FIT` : "",
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

function getNumberProperty(value: Record<string, unknown> | undefined, key: string) {
  return value ? numberValue(value[key]) : undefined;
}

function getNestedNumber(value: Record<string, unknown> | undefined, key: string, childKey: string) {
  return getNumberProperty(asRecord(value?.[key]), childKey);
}

function formatNumber(value: number, fractionDigits: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function formatDistance(distanceM: number): string {
  if (distanceM >= 1000) {
    return `${formatNumber(distanceM / 1000, 2)} km`;
  }
  return `${formatNumber(distanceM, 0)} m`;
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
