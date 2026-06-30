import {
  downsampleTrackActivity,
  parseFitBytes,
  trackActivityToTrackJson,
} from "./fit";
import type { TrackActivity } from "./fit";

type TrackRenderer = {
  hydrate: (root?: HTMLElement) => void;
};

type StgyTrackViewerGlobal = {
  StgyTrackRenderer: new () => TrackRenderer;
};

type StreamConstructor = new (
  format: string
) => TransformStream<Uint8Array, Uint8Array>;

type DownsampleStrategy = "uniform" | "aggregate";

type DemoElements = {
  fileInput: HTMLInputElement;
  titleInput: HTMLInputElement;
  downsampleInput: HTMLInputElement;
  downsampleStrategySelect: HTMLSelectElement;
  maxPointsInput: HTMLInputElement;
  preserveEndpointsInput: HTMLInputElement;
  prettyInput: HTMLInputElement;
  convertButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  downloadLink: HTMLAnchorElement;
  compressedDownloadLink: HTMLAnchorElement;
  statusOutput: HTMLElement;
  summaryOutput: HTMLElement;
  mapOutput: HTMLElement;
  trackJsonOutput: HTMLTextAreaElement;
};

type ConversionResult = {
  trackJson: string;
  trackJsonData: unknown;
  title: string;
  sourceType: "fit" | "trackjson" | "trjgz";
  originalPointCount?: number;
  renderedPointCount?: number;
  activity?: TrackActivity;
  renderedActivity?: TrackActivity;
};

declare global {
  interface Window {
    StgyTrackViewer?: StgyTrackViewerGlobal;
  }
}

let currentTrackJsonUrl: string | undefined;
let currentCompressedTrackJsonUrl: string | undefined;

export function initFitDemo(root: Document | HTMLElement = document) {
  const elements = getDemoElements(root);
  const renderer = createRenderer();

  syncDownsampleControls(elements);

  elements.downsampleInput.addEventListener("change", () => {
    syncDownsampleControls(elements);
  });

  elements.convertButton.addEventListener("click", () => {
    convertAndRender(elements, renderer).catch((e) => {
      clearOutput(elements);
      setStatus(elements, getErrorMessage(e), true);
    });
  });

  elements.copyButton.addEventListener("click", () => {
    copyTrackJson(elements).catch((e) => {
      setStatus(elements, getErrorMessage(e), true);
    });
  });
}

async function convertAndRender(elements: DemoElements, renderer: TrackRenderer) {
  const file = elements.fileInput.files?.[0];
  if (!file) {
    setStatus(elements, "Choose a FIT, TrackJSON, TRJ, or TRJGZ file first.", true);
    return;
  }

  setBusy(elements, true);
  clearOutput(elements);
  setStatus(elements, "Converting...");

  try {
    const result = await convertInputFile(file, elements);
    const trackJsonUrl = await updateTrackJsonDownload(
      elements,
      file,
      result.trackJson
    );

    elements.trackJsonOutput.value = result.trackJson;
    elements.copyButton.disabled = false;

    renderTrackJson(elements, renderer, trackJsonUrl, result.title);
    showSummary(elements, file, result);
    setStatus(elements, "Track data was rendered.");
  } finally {
    setBusy(elements, false);
  }
}

async function convertInputFile(
  file: File,
  elements: DemoElements
): Promise<ConversionResult> {
  const lowerName = file.name.toLowerCase();

  if (
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".geojson") ||
    lowerName.endsWith(".trj")
  ) {
    const text = await file.text();
    return convertTrackJsonText(file, text, elements, "trackjson");
  }

  if (lowerName.endsWith(".trjgz")) {
    const bytes = await file.arrayBuffer();
    const text = await decompressGzipText(bytes);
    return convertTrackJsonText(file, text, elements, "trjgz");
  }

  return convertFitFile(file, elements);
}

async function convertFitFile(
  file: File,
  elements: DemoElements
): Promise<ConversionResult> {
  const bytes = await file.arrayBuffer();
  const activity = parseFitBytes(bytes);
  const digest = maybeDownsample(activity, elements);
  const title = getRouteTitle(elements, file);

  const trackJson = trackActivityToTrackJson(digest, {
    title,
    description: `Converted from ${file.name}`,
    pretty: elements.prettyInput.checked,
  });
  const trackJsonData = JSON.parse(trackJson);

  return {
    trackJson,
    trackJsonData,
    title,
    sourceType: "fit",
    originalPointCount: activity.points.length,
    renderedPointCount: digest.points.length,
    activity,
    renderedActivity: digest,
  };
}

function convertTrackJsonText(
  file: File,
  text: string,
  elements: DemoElements,
  sourceType: "trackjson" | "trjgz"
): ConversionResult {
  const originalTrackJsonData = parseTrackJsonData(text);
  const title = getTrackJsonTitle(originalTrackJsonData) || getRouteTitle(elements, file);
  const originalPointCount = countTrackJsonPositionedPoints(originalTrackJsonData);
  const downsampledTrackJsonData = maybeDownsampleTrackJsonData(
    originalTrackJsonData,
    elements
  );
  const trackJsonData = compactTrackJsonData(downsampledTrackJsonData);
  const trackJson = JSON.stringify(
    trackJsonData,
    null,
    elements.prettyInput.checked ? 2 : 0
  );
  const renderedPointCount = countTrackJsonPositionedPoints(trackJsonData);

  return {
    trackJson,
    trackJsonData,
    title,
    sourceType,
    originalPointCount,
    renderedPointCount,
  };
}

function parseTrackJsonData(text: string): unknown {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`TrackJSON could not be parsed: ${getErrorMessage(e)}`);
  }

  if (!data || typeof data !== "object") {
    throw new Error("TrackJSON root must be an object.");
  }

  const type = (data as { type?: unknown }).type;
  if (type !== "FeatureCollection" && type !== "Feature") {
    throw new Error("TrackJSON must be a GeoJSON FeatureCollection or Feature.");
  }

  return data;
}

const TRACK_JSON_PRECISION = {
  coordinates: 5,
  times: 0,
  distances: 1,
  elevations: 1,
  heartRates: 1,
  cadences: 1,
  powers: 1,
  speeds: 1,
  metrics: 1,
  metadata: 1,
};

function compactTrackJsonData(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }

  if (data.type === "Feature") {
    return compactTrackJsonFeature(data);
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return compactTrackJsonValue(data, undefined);
  }

  const output: Record<string, unknown> = {
    ...data,
    features: data.features.map((feature) => {
      return isRecord(feature) ? compactTrackJsonFeature(feature) : feature;
    }),
  };

  if (isRecord(data.metadata)) {
    output.metadata = compactTrackJsonMetadata(data.metadata);
  }

  return output;
}

function compactTrackJsonFeature(
  feature: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...feature };
  const geometry = feature.geometry;

  if (isRecord(geometry)) {
    output.geometry = compactTrackJsonGeometry(geometry);
  }

  if (isRecord(feature.properties)) {
    output.properties = compactTrackJsonProperties(feature.properties);
  }

  return output;
}

function compactTrackJsonGeometry(
  geometry: Record<string, unknown>
): Record<string, unknown> {
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return compactTrackJsonValue(geometry, undefined) as Record<string, unknown>;
  }

  return {
    ...geometry,
    coordinates: geometry.coordinates.map(compactTrackJsonCoordinate),
  };
}

function compactTrackJsonCoordinate(coordinate: unknown): unknown {
  if (!Array.isArray(coordinate)) {
    return coordinate;
  }

  return coordinate.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return value;
    }

    return roundNumber(
      value,
      index < 2 ? TRACK_JSON_PRECISION.coordinates : TRACK_JSON_PRECISION.elevations
    );
  });
}

function compactTrackJsonProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...properties };

  if (isRecord(properties.coordinateProperties)) {
    output.coordinateProperties = compactCoordinateProperties(
      properties.coordinateProperties
    );
  }

  if (isRecord(properties.metadata)) {
    output.metadata = compactTrackJsonMetadata(properties.metadata);
  }

  return output;
}

function compactCoordinateProperties(
  coordinateProperties: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  Object.keys(coordinateProperties).forEach((name) => {
    const value = coordinateProperties[name];
    if (!Array.isArray(value)) {
      output[name] = value;
      return;
    }

    const precision = getCoordinatePropertyPrecision(name);
    output[name] = value.map((item) => {
      return typeof item === "number" && Number.isFinite(item)
        ? roundNumber(item, precision)
        : item;
    });
  });

  return output;
}

function getCoordinatePropertyPrecision(name: string): number {
  if (name === "times") {
    return TRACK_JSON_PRECISION.times;
  }

  if (name === "distances") {
    return TRACK_JSON_PRECISION.distances;
  }

  if (name === "elevations") {
    return TRACK_JSON_PRECISION.elevations;
  }

  if (name === "heartRates") {
    return TRACK_JSON_PRECISION.heartRates;
  }

  if (name === "cadences") {
    return TRACK_JSON_PRECISION.cadences;
  }

  if (name === "powers") {
    return TRACK_JSON_PRECISION.powers;
  }

  if (name === "speeds") {
    return TRACK_JSON_PRECISION.speeds;
  }

  return TRACK_JSON_PRECISION.metrics;
}

function compactTrackJsonMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return compactTrackJsonValue(metadata, undefined) as Record<string, unknown>;
}

function compactTrackJsonValue(value: unknown, key: string | undefined): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    return roundNumber(value, getMetadataPrecision(key));
  }

  if (Array.isArray(value)) {
    return value.map((item) => compactTrackJsonValue(item, key));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    Object.keys(value).forEach((childKey) => {
      output[childKey] = compactTrackJsonValue(value[childKey], childKey);
    });
    return output;
  }

  return value;
}

function getMetadataPrecision(key: string | undefined): number {
  if (
    key === "createdAt" ||
    key === "startTime" ||
    key === "timeCreated" ||
    key === "serialNumber"
  ) {
    return 0;
  }

  if (key === "totalElapsedTime" || key === "totalTimerTime") {
    return 0;
  }

  return TRACK_JSON_PRECISION.metadata;
}

function roundNumber(value: number, precision: number): number {
  if (precision <= 0) {
    return Math.round(value);
  }

  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function maybeDownsample(
  activity: TrackActivity,
  elements: DemoElements
): TrackActivity {
  if (!elements.downsampleInput.checked) {
    return activity;
  }

  return downsampleTrackActivity(activity, {
    maxPoints: getMaxPoints(elements),
    strategy: getDownsampleStrategy(elements),
    preserveEndpoints: elements.preserveEndpointsInput.checked,
  });
}

function maybeDownsampleTrackJsonData(
  data: unknown,
  elements: DemoElements
): unknown {
  if (!elements.downsampleInput.checked) {
    return data;
  }

  return downsampleTrackJsonData(
    data,
    getMaxPoints(elements),
    getDownsampleStrategy(elements),
    elements.preserveEndpointsInput.checked
  );
}

function downsampleTrackJsonData(
  data: unknown,
  maxPoints: number,
  strategy: DownsampleStrategy,
  preserveEndpoints: boolean
): unknown {
  if (!isRecord(data)) {
    return data;
  }

  if (data.type === "Feature") {
    return downsampleTrackJsonFeature(
      data,
      maxPoints,
      strategy,
      preserveEndpoints
    );
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return data;
  }

  return {
    ...data,
    features: data.features.map((feature) => {
      return isRecord(feature)
        ? downsampleTrackJsonFeature(
            feature,
            maxPoints,
            strategy,
            preserveEndpoints
          )
        : feature;
    }),
  };
}

function downsampleTrackJsonFeature(
  feature: Record<string, unknown>,
  maxPoints: number,
  strategy: DownsampleStrategy,
  preserveEndpoints: boolean
): Record<string, unknown> {
  const geometry = feature.geometry;
  if (!isRecord(geometry)) {
    return feature;
  }

  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return feature;
  }

  if (geometry.coordinates.length <= maxPoints) {
    return feature;
  }

  const ranges = createTrackJsonDownsampleRanges(
    geometry.coordinates.length,
    maxPoints,
    strategy,
    preserveEndpoints
  );
  const coordinates = ranges.map((range) => {
    return cloneTrackJsonCoordinate(geometry.coordinates[range.representative]);
  });
  const output: Record<string, unknown> = {
    ...feature,
    geometry: {
      ...geometry,
      coordinates,
    },
  };

  const properties = feature.properties;
  if (isRecord(properties) && isRecord(properties.coordinateProperties)) {
    output.properties = {
      ...properties,
      coordinateProperties: downsampleCoordinateProperties(
        properties.coordinateProperties,
        ranges,
        geometry.coordinates.length,
        strategy
      ),
    };
  }

  return output;
}

type TrackJsonDownsampleRange = {
  start: number;
  end: number;
  representative: number;
};

function createTrackJsonDownsampleRanges(
  length: number,
  maxPoints: number,
  strategy: DownsampleStrategy,
  preserveEndpoints: boolean
): TrackJsonDownsampleRange[] {
  if (length <= maxPoints) {
    return Array.from({ length }, (_, index) => {
      return { start: index, end: index + 1, representative: index };
    });
  }

  if (strategy === "uniform") {
    const indices = preserveEndpoints
      ? selectUniformIndicesWithEndpoints(length, maxPoints)
      : selectUniformIndices(length, maxPoints);
    return indices.map((index) => {
      return { start: index, end: index + 1, representative: index };
    });
  }

  if (!preserveEndpoints) {
    return createAggregateRanges(length, maxPoints, 0);
  }

  if (maxPoints <= 2) {
    return [
      { start: 0, end: 1, representative: 0 },
      { start: length - 1, end: length, representative: length - 1 },
    ];
  }

  return [
    { start: 0, end: 1, representative: 0 },
    ...createAggregateRanges(length - 2, maxPoints - 2, 1),
    { start: length - 1, end: length, representative: length - 1 },
  ];
}

function createAggregateRanges(
  length: number,
  count: number,
  offset: number
): TrackJsonDownsampleRange[] {
  return Array.from({ length: count }, (_, index) => {
    const start = offset + Math.floor((index * length) / count);
    const end = offset + Math.floor(((index + 1) * length) / count);
    return {
      start,
      end: Math.max(start + 1, end),
      representative: Math.floor((start + Math.max(start + 1, end) - 1) / 2),
    };
  });
}

function selectUniformIndices(length: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    return Math.floor((index * length) / count);
  });
}

function selectUniformIndicesWithEndpoints(length: number, count: number): number[] {
  if (count <= 1) {
    return [0];
  }

  return Array.from({ length: count }, (_, index) => {
    return Math.round((index * (length - 1)) / (count - 1));
  });
}

function cloneTrackJsonCoordinate(coordinate: unknown): unknown {
  return Array.isArray(coordinate) ? [...coordinate] : coordinate;
}

function downsampleCoordinateProperties(
  coordinateProperties: Record<string, unknown>,
  ranges: TrackJsonDownsampleRange[],
  sourceLength: number,
  strategy: DownsampleStrategy
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...coordinateProperties };

  Object.keys(coordinateProperties).forEach((name) => {
    const series = coordinateProperties[name];
    if (!Array.isArray(series) || series.length !== sourceLength) {
      return;
    }

    output[name] = downsampleCoordinatePropertySeries(
      name,
      series,
      ranges,
      strategy
    );
  });

  return output;
}

function downsampleCoordinatePropertySeries(
  name: string,
  series: unknown[],
  ranges: TrackJsonDownsampleRange[],
  strategy: DownsampleStrategy
): unknown[] {
  if (strategy === "uniform" || isRepresentativeCoordinateProperty(name)) {
    return ranges.map((range) => series[range.representative]);
  }

  return ranges.map((range) => {
    const average = averageCoordinatePropertyRange(series, range.start, range.end);
    return typeof average === "number" ? average : series[range.representative];
  });
}

function isRepresentativeCoordinateProperty(name: string): boolean {
  return name === "times" || name === "distances";
}

function averageCoordinatePropertyRange(
  series: unknown[],
  start: number,
  end: number
): number | undefined {
  let sum = 0;
  let count = 0;

  for (let index = start; index < end; index += 1) {
    const value = series[index];
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }

  return count > 0 ? sum / count : undefined;
}

function renderTrackJson(
  elements: DemoElements,
  renderer: TrackRenderer,
  trackJsonUrl: string,
  title: string
) {
  elements.mapOutput.textContent = "";

  const figure = document.createElement("figure");
  figure.className = "stgy-track-map";
  figure.style.height = "500px";
  figure.dataset.src = trackJsonUrl;

  const canvas = document.createElement("div");
  canvas.className = "stgy-track-canvas";
  canvas.textContent = "Map loading...";

  const caption = document.createElement("figcaption");
  caption.className = "stgy-track-caption";
  caption.textContent = title;

  figure.appendChild(canvas);
  figure.appendChild(caption);
  elements.mapOutput.appendChild(figure);

  renderer.hydrate(elements.mapOutput);
}

async function updateTrackJsonDownload(
  elements: DemoElements,
  file: File,
  trackJson: string
): Promise<string> {
  revokeCurrentTrackJsonUrls();

  const rawBlob = new Blob([trackJson], {
    type: "application/json",
  });
  const rawUrl = URL.createObjectURL(rawBlob);
  currentTrackJsonUrl = rawUrl;

  elements.downloadLink.href = rawUrl;
  elements.downloadLink.download = makeTrackJsonFileName(file, ".trj");
  elements.downloadLink.hidden = false;

  elements.compressedDownloadLink.removeAttribute("href");
  elements.compressedDownloadLink.hidden = true;

  const compressedBlob = await gzipText(trackJson);
  if (compressedBlob) {
    const compressedUrl = URL.createObjectURL(compressedBlob);
    currentCompressedTrackJsonUrl = compressedUrl;

    elements.compressedDownloadLink.href = compressedUrl;
    elements.compressedDownloadLink.download = makeTrackJsonFileName(file, ".trjgz");
    elements.compressedDownloadLink.hidden = false;
  }

  return rawUrl;
}

async function gzipText(text: string): Promise<Blob | null> {
  const CompressionStreamCtor = (
    globalThis as unknown as { CompressionStream?: StreamConstructor }
  ).CompressionStream;

  if (!CompressionStreamCtor) {
    return null;
  }

  const source = new Blob([text], {
    type: "application/json",
  });

  const compressedStream = source.stream().pipeThrough(
    new CompressionStreamCtor("gzip")
  );
  return new Response(compressedStream).blob();
}

async function decompressGzipText(bytes: ArrayBuffer): Promise<string> {
  const DecompressionStreamCtor = (
    globalThis as unknown as { DecompressionStream?: StreamConstructor }
  ).DecompressionStream;

  if (!DecompressionStreamCtor) {
    throw new Error("This browser does not support gzip decompression.");
  }

  const source = new Blob([bytes], {
    type: "application/gzip",
  });
  const decompressedStream = source.stream().pipeThrough(
    new DecompressionStreamCtor("gzip")
  );

  return new Response(decompressedStream).text();
}

async function copyTrackJson(elements: DemoElements) {
  const value = elements.trackJsonOutput.value;
  if (!value) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  } else {
    elements.trackJsonOutput.focus();
    elements.trackJsonOutput.select();
    document.execCommand("copy");
  }

  setStatus(elements, "TrackJSON was copied.");
}

function showSummary(
  elements: DemoElements,
  file: File,
  result: ConversionResult
) {
  const lines: string[] = [
    `file: ${file.name}`,
    `source: ${formatSourceType(result.sourceType)}`,
  ];

  if (typeof result.originalPointCount === "number") {
    lines.push(`original points: ${result.originalPointCount}`);
  }

  if (typeof result.renderedPointCount === "number") {
    lines.push(`rendered points: ${result.renderedPointCount}`);
  }

  const metadata = result.activity?.metadata ||
    getTrackJsonMetadata(result.trackJsonData);

  if (metadata) {
    const sport = getStringProperty(metadata, "sport");
    const subSport = getStringProperty(metadata, "subSport");
    const totalDistanceM = getNumberProperty(metadata, "totalDistanceM");
    const totalTimerTime = getNumberProperty(metadata, "totalTimerTime");
    const totalElapsedTime = getNumberProperty(metadata, "totalElapsedTime");

    if (sport) {
      lines.push(`sport: ${sport}`);
    }

    if (subSport) {
      lines.push(`sub sport: ${subSport}`);
    }

    if (typeof totalDistanceM === "number") {
      lines.push(`total distance: ${formatDistance(totalDistanceM)}`);
    }

    if (typeof totalTimerTime === "number") {
      lines.push(`timer time: ${formatDuration(totalTimerTime)}`);
    } else if (typeof totalElapsedTime === "number") {
      lines.push(`elapsed time: ${formatDuration(totalElapsedTime)}`);
    }
  }

  if (result.activity && result.activity.warnings.length > 0) {
    lines.push(`warnings: ${result.activity.warnings.length}`);
  }

  elements.summaryOutput.hidden = false;
  elements.summaryOutput.replaceChildren();

  lines.forEach((line) => {
    const div = document.createElement("div");
    div.textContent = line;
    elements.summaryOutput.appendChild(div);
  });
}

function clearOutput(elements: DemoElements) {
  revokeCurrentTrackJsonUrls();

  elements.mapOutput.textContent = "";
  elements.trackJsonOutput.value = "";
  elements.copyButton.disabled = true;

  elements.downloadLink.removeAttribute("href");
  elements.downloadLink.hidden = true;

  elements.compressedDownloadLink.removeAttribute("href");
  elements.compressedDownloadLink.hidden = true;

  elements.summaryOutput.textContent = "";
  elements.summaryOutput.hidden = true;
}

function revokeCurrentTrackJsonUrls() {
  if (currentTrackJsonUrl) {
    URL.revokeObjectURL(currentTrackJsonUrl);
    currentTrackJsonUrl = undefined;
  }

  if (currentCompressedTrackJsonUrl) {
    URL.revokeObjectURL(currentCompressedTrackJsonUrl);
    currentCompressedTrackJsonUrl = undefined;
  }
}

function syncDownsampleControls(elements: DemoElements) {
  const enabled = elements.downsampleInput.checked;
  elements.downsampleStrategySelect.disabled = !enabled;
  elements.maxPointsInput.disabled = !enabled;
  elements.preserveEndpointsInput.disabled = !enabled;
}

function setBusy(elements: DemoElements, busy: boolean) {
  elements.convertButton.disabled = busy;
  elements.fileInput.disabled = busy;
}

function setStatus(elements: DemoElements, message: string, isError = false) {
  elements.statusOutput.textContent = message;
  elements.statusOutput.classList.toggle("is-error", isError);
}

function getDemoElements(root: Document | HTMLElement): DemoElements {
  const downloadLink = getElement<HTMLAnchorElement>(root, "fit-demo-download");
  const compressedDownloadLink = getOrCreateCompressedDownloadLink(
    root,
    downloadLink
  );

  return {
    fileInput: getElement<HTMLInputElement>(root, "fit-demo-file"),
    titleInput: getElement<HTMLInputElement>(root, "fit-demo-title"),
    downsampleInput: getElement<HTMLInputElement>(root, "fit-demo-downsample"),
    downsampleStrategySelect: getElement<HTMLSelectElement>(
      root,
      "fit-demo-downsample-strategy"
    ),
    maxPointsInput: getElement<HTMLInputElement>(root, "fit-demo-max-points"),
    preserveEndpointsInput: getElement<HTMLInputElement>(
      root,
      "fit-demo-preserve-endpoints"
    ),
    prettyInput: getElement<HTMLInputElement>(root, "fit-demo-pretty"),
    convertButton: getElement<HTMLButtonElement>(root, "fit-demo-convert"),
    copyButton: getElement<HTMLButtonElement>(root, "fit-demo-copy"),
    downloadLink,
    compressedDownloadLink,
    statusOutput: getElement<HTMLElement>(root, "fit-demo-status"),
    summaryOutput: getElement<HTMLElement>(root, "fit-demo-summary"),
    mapOutput: getElement<HTMLElement>(root, "fit-demo-map-output"),
    trackJsonOutput: getElement<HTMLTextAreaElement>(root, "fit-demo-track-json"),
  };
}

function getOrCreateCompressedDownloadLink(
  root: Document | HTMLElement,
  downloadLink: HTMLAnchorElement
): HTMLAnchorElement {
  const existing = root.querySelector<HTMLAnchorElement>(
    "#fit-demo-download-compressed"
  );
  if (existing) {
    return existing;
  }

  const link = document.createElement("a");
  link.id = "fit-demo-download-compressed";
  link.href = "#";
  link.download = "track.trjgz";
  link.hidden = true;
  link.textContent = "(compressed)";

  downloadLink.insertAdjacentText("afterend", " ");
  downloadLink.insertAdjacentElement("afterend", link);

  return link;
}

function getElement<T extends HTMLElement>(
  root: Document | HTMLElement,
  id: string
): T {
  const element = root.querySelector<T>(`#${id}`);
  if (!element) {
    throw new Error(`Element #${id} was not found.`);
  }
  return element;
}

function createRenderer(): TrackRenderer {
  const constructor = window.StgyTrackViewer?.StgyTrackRenderer;
  if (!constructor) {
    throw new Error("StgyTrackViewer.StgyTrackRenderer was not found.");
  }
  return new constructor();
}

function getMaxPoints(elements: DemoElements): number {
  const value = Number(elements.maxPointsInput.value);
  if (!Number.isFinite(value) || value < 2) {
    return 3000;
  }

  return Math.floor(value);
}

function getDownsampleStrategy(elements: DemoElements): DownsampleStrategy {
  return elements.downsampleStrategySelect.value === "aggregate"
    ? "aggregate"
    : "uniform";
}

function getRouteTitle(elements: DemoElements, file: File): string {
  const title = elements.titleInput.value.trim();
  return title || stripExtension(file.name) || "Track";
}

function getTrackJsonTitle(data: unknown): string | undefined {
  const feature = getFirstFeature(data);
  const properties = feature?.properties;
  if (!properties || typeof properties !== "object") {
    return undefined;
  }

  const title = (properties as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title.trim() : undefined;
}

function getTrackJsonMetadata(data: unknown): Record<string, unknown> | undefined {
  const root = data as Record<string, unknown>;
  if (root && typeof root === "object" && isRecord(root.metadata)) {
    return root.metadata;
  }

  const feature = getFirstFeature(data);
  const properties = feature?.properties;
  if (!properties || typeof properties !== "object") {
    return undefined;
  }

  const metadata = (properties as Record<string, unknown>).metadata;
  return isRecord(metadata) ? metadata : undefined;
}

function getFirstFeature(data: unknown): { properties?: unknown } | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const root = data as Record<string, unknown>;
  if (root.type === "Feature") {
    return root as { properties?: unknown };
  }

  if (root.type !== "FeatureCollection" || !Array.isArray(root.features)) {
    return undefined;
  }

  return root.features.find((feature) => {
    return isRecord(feature) && feature.type === "Feature";
  }) as { properties?: unknown } | undefined;
}

function countTrackJsonPositionedPoints(data: unknown): number {
  if (!data || typeof data !== "object") {
    return 0;
  }

  const root = data as Record<string, unknown>;
  if (root.type === "Feature") {
    return countFeaturePositionedPoints(root);
  }

  if (root.type !== "FeatureCollection" || !Array.isArray(root.features)) {
    return 0;
  }

  return root.features.reduce((sum, feature) => {
    return isRecord(feature) ? sum + countFeaturePositionedPoints(feature) : sum;
  }, 0);
}

function countFeaturePositionedPoints(feature: Record<string, unknown>): number {
  const geometry = feature.geometry;
  if (!isRecord(geometry)) {
    return 0;
  }

  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.length;
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.reduce((sum, line) => {
      return Array.isArray(line) ? sum + line.length : sum;
    }, 0);
  }

  return 0;
}

function makeTrackJsonFileName(file: File, extension: ".trj" | ".trjgz"): string {
  return `${stripExtension(file.name) || "track"}${extension}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]*$/, "");
}

function formatSourceType(sourceType: ConversionResult["sourceType"]): string {
  if (sourceType === "fit") {
    return "FIT";
  }

  if (sourceType === "trjgz") {
    return "TrackJSON gzip";
  }

  return "TrackJSON";
}

function formatDistance(distanceM: number): string {
  if (distanceM >= 1000) {
    return `${(distanceM / 1000).toFixed(2)} km`;
  }

  return `${Math.round(distanceM)} m`;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const restSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${restSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
}

function getStringProperty(
  object: Record<string, unknown>,
  key: string
): string | undefined {
  const value = object[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumberProperty(
  object: Record<string, unknown>,
  key: string
): number | undefined {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
