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
    setStatus(elements, "Choose a FIT, TrackJSON, or TRJGZ file first.", true);
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

  if (lowerName.endsWith(".json") || lowerName.endsWith(".geojson")) {
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
  const trackJsonData = parseTrackJsonData(text);
  const title = getTrackJsonTitle(trackJsonData) || getRouteTitle(elements, file);
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
  elements.downloadLink.download = makeTrackJsonFileName(file, ".json");
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

function makeTrackJsonFileName(file: File, extension: ".json" | ".trjgz"): string {
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
