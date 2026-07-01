import {
  downsampleTrackActivity,
  parseFitBytes,
  obfuscateFitPrivacy,
  trackActivityToTrackJson,
} from "./fit";
import {
  compactTrackJsonData,
  obfuscateTrackJsonPrivacy,
  countTrackJsonPositionedPoints,
  downsampleTrackJsonData,
  getTrackJsonMetadata,
  getTrackJsonTitle,
  parseTrackJsonData,
} from "./trackjson";
import type { TrackActivity } from "./fit";
import type { TrackJsonDownsampleStrategy } from "./trackjson";

type TrackRenderer = {
  hydrate: (root?: HTMLElement) => void;
};

type StgyTrackViewerGlobal = {
  StgyTrackRenderer: new () => TrackRenderer;
};

type StreamConstructor = new (
  format: string
) => TransformStream<Uint8Array, Uint8Array>;

type DemoElements = {
  fileInput: HTMLInputElement;
  titleInput: HTMLInputElement;
  downsampleInput: HTMLInputElement;
  downsampleStrategySelect: HTMLSelectElement;
  maxPointsInput: HTMLInputElement;
  preserveEndpointsInput: HTMLInputElement;
  obfuscatePrivacyInput: HTMLInputElement;
  obfuscateStartDistanceInput: HTMLInputElement;
  obfuscateEndDistanceInput: HTMLInputElement;
  prettyInput: HTMLInputElement;
  convertButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  downloadLink: HTMLAnchorElement;
  compressedDownloadLink: HTMLAnchorElement;
  obfuscatedFitDownloadLink: HTMLAnchorElement;
  statusOutput: HTMLElement;
  summaryOutput: HTMLElement;
  metadataOutput: HTMLElement;
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
  obfuscatedFitBytes?: Uint8Array;
  obfuscatedPrivacyApplied?: boolean;
  privacyStartDistanceM?: number;
  privacyEndDistanceM?: number;
};

declare global {
  interface Window {
    StgyTrackViewer?: StgyTrackViewerGlobal;
  }
}

let currentTrackJsonUrl: string | undefined;
let currentCompressedTrackJsonUrl: string | undefined;
let currentObfuscatedFitUrl: string | undefined;

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
    updateObfuscatedFitDownload(elements, file, result.obfuscatedFitBytes);

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
  const originalBytes = await file.arrayBuffer();
  const privacyOptions = getPrivacyObfuscationOptions(elements);
  const obfuscatedFitBytes = elements.obfuscatePrivacyInput.checked
    ? obfuscateFitPrivacy(originalBytes, privacyOptions)
    : undefined;
  const fitBytes = obfuscatedFitBytes || originalBytes;
  const activity = parseFitBytes(fitBytes);
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
    obfuscatedFitBytes,
    obfuscatedPrivacyApplied: Boolean(obfuscatedFitBytes),
    privacyStartDistanceM: privacyOptions.startDistanceM,
    privacyEndDistanceM: privacyOptions.endDistanceM,
  };
}

function convertTrackJsonText(
  file: File,
  text: string,
  elements: DemoElements,
  sourceType: "trackjson" | "trjgz"
): ConversionResult {
  const originalTrackJsonData = parseTrackJsonData(text);
  const privacyOptions = getPrivacyObfuscationOptions(elements);
  const obfuscatedTrackJsonData = elements.obfuscatePrivacyInput.checked
    ? obfuscateTrackJsonPrivacy(originalTrackJsonData, privacyOptions)
    : originalTrackJsonData;
  const title = getTrackJsonTitle(obfuscatedTrackJsonData) || getRouteTitle(elements, file);
  const originalPointCount = countTrackJsonPositionedPoints(originalTrackJsonData);
  const downsampledTrackJsonData = maybeDownsampleTrackJsonData(
    obfuscatedTrackJsonData,
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
    obfuscatedPrivacyApplied: elements.obfuscatePrivacyInput.checked,
    privacyStartDistanceM: privacyOptions.startDistanceM,
    privacyEndDistanceM: privacyOptions.endDistanceM,
  };
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

  return downsampleTrackJsonData(data, {
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

function copyUint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function updateObfuscatedFitDownload(
  elements: DemoElements,
  file: File,
  bytes: Uint8Array | undefined
) {
  if (currentObfuscatedFitUrl) {
    URL.revokeObjectURL(currentObfuscatedFitUrl);
    currentObfuscatedFitUrl = undefined;
  }

  elements.obfuscatedFitDownloadLink.removeAttribute("href");
  elements.obfuscatedFitDownloadLink.hidden = true;

  if (!bytes) {
    return;
  }

  const blob = new Blob([copyUint8ArrayToArrayBuffer(bytes)], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  currentObfuscatedFitUrl = url;

  elements.obfuscatedFitDownloadLink.href = url;
  elements.obfuscatedFitDownloadLink.download = makeObfuscatedFitFileName(file);
  elements.obfuscatedFitDownloadLink.hidden = false;
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

  if (result.obfuscatedPrivacyApplied) {
    lines.push(
      `Privacy obfuscation: start ${formatNumber(
        result.privacyStartDistanceM || 0,
        0
      )} m, end ${formatNumber(result.privacyEndDistanceM || 0, 0)} m`
    );
  }

  const metadata = getResultMetadata(result);

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

    appendMetadataSummaryLines(lines, metadata);
  }

  showMetadata(elements, metadata);

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

function getResultMetadata(result: ConversionResult): Record<string, unknown> | undefined {
  const trackJsonMetadata = getTrackJsonMetadata(result.trackJsonData);
  if (trackJsonMetadata) {
    return trackJsonMetadata;
  }

  const activityMetadata = result.renderedActivity?.metadata || result.activity?.metadata;
  return isRecord(activityMetadata) ? activityMetadata : undefined;
}

function showMetadata(
  elements: DemoElements,
  metadata: Record<string, unknown> | undefined
) {
  elements.metadataOutput.textContent = "";

  if (!metadata) {
    elements.metadataOutput.hidden = true;
    return;
  }

  const details = document.createElement("details");
  details.open = true;

  const summary = document.createElement("summary");
  summary.textContent = "Metadata";

  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(metadata, null, 2);

  details.appendChild(summary);
  details.appendChild(pre);

  elements.metadataOutput.hidden = false;
  elements.metadataOutput.appendChild(details);
}

function appendMetadataSummaryLines(
  lines: string[],
  metadata: Record<string, unknown>
) {
  const statistics = getRecordProperty(metadata, "statistics");
  if (statistics) {
    appendStatsLine(lines, statistics, "speedKph", "speed", "km/h");
    appendStatsLine(lines, statistics, "cadenceRpm", "cadence", "rpm");
    appendStatsLine(lines, statistics, "heartRateBpm", "heart rate", "bpm");
    appendStatsLine(lines, statistics, "powerW", "power", "W");
    appendStatsLine(lines, statistics, "temperatureC", "temperature", "°C");
  }

  appendDeviceSummaryLines(lines, metadata);

  const training = getRecordProperty(metadata, "training");
  if (!training) {
    return;
  }

  const normalizedPowerW = getNumberProperty(training, "normalizedPowerW");
  const totalWorkJ = getNumberProperty(training, "totalWorkJ");
  const totalCaloriesCal = getNumberProperty(training, "totalCaloriesCal");

  if (typeof normalizedPowerW === "number") {
    lines.push(`normalized power: ${formatNumber(normalizedPowerW, 0)} W`);
  }

  if (typeof totalWorkJ === "number") {
    lines.push(`total work: ${formatNumber(totalWorkJ, 0)} J`);
  }

  if (typeof totalCaloriesCal === "number") {
    lines.push(`calories: ${formatNumber(totalCaloriesCal, 0)} cal`);
  }
}

function appendStatsLine(
  lines: string[],
  statistics: Record<string, unknown>,
  key: string,
  label: string,
  unit: string
) {
  const stats = getRecordProperty(statistics, key);
  if (!stats) {
    return;
  }

  const avg = getNumberProperty(stats, "avg");
  const median = getNumberProperty(stats, "median");
  const max = getNumberProperty(stats, "max");
  const parts: string[] = [];

  if (typeof avg === "number") {
    parts.push(`avg ${formatNumber(avg, getStatsPrecision(unit))}`);
  }

  if (typeof median === "number") {
    parts.push(`median ${formatNumber(median, getStatsPrecision(unit))}`);
  }

  if (typeof max === "number") {
    parts.push(`max ${formatNumber(max, getStatsPrecision(unit))}`);
  }

  if (parts.length > 0) {
    lines.push(`${label}: ${parts.join(", ")} ${unit}`);
  }
}

function appendDeviceSummaryLines(
  lines: string[],
  metadata: Record<string, unknown>
) {
  const recordingDevice = getRecordProperty(metadata, "recordingDevice");
  const recordingDeviceLabel = recordingDevice
    ? formatDeviceSummary(recordingDevice)
    : undefined;
  if (recordingDeviceLabel) {
    lines.push(`recording device: ${recordingDeviceLabel}`);
  }

  const devices = metadata.devices;
  if (!Array.isArray(devices)) {
    return;
  }

  const labels = devices
    .filter(isRecord)
    .map(formatDeviceSummary)
    .filter((label): label is string => Boolean(label));

  if (labels.length > 0) {
    lines.push(`devices: ${labels.join("; ")}`);
  }
}

function formatDeviceSummary(device: Record<string, unknown>): string | undefined {
  const parts = [
    getStringProperty(device, "manufacturer"),
    getStringProperty(device, "productName") || getStringProperty(device, "product"),
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" ");
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

  elements.obfuscatedFitDownloadLink.removeAttribute("href");
  elements.obfuscatedFitDownloadLink.hidden = true;

  elements.summaryOutput.textContent = "";
  elements.summaryOutput.hidden = true;

  elements.metadataOutput.textContent = "";
  elements.metadataOutput.hidden = true;
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

  if (currentObfuscatedFitUrl) {
    URL.revokeObjectURL(currentObfuscatedFitUrl);
    currentObfuscatedFitUrl = undefined;
  }
}

function syncDownsampleControls(elements: DemoElements) {
  const enabled = elements.downsampleInput.checked;
  elements.downsampleStrategySelect.disabled = !enabled;
  elements.maxPointsInput.disabled = !enabled;
  elements.preserveEndpointsInput.disabled = !enabled;
}

function getPrivacyObfuscationOptions(elements: DemoElements) {
  return {
    startDistanceM: getNonNegativeDistance(elements.obfuscateStartDistanceInput),
    endDistanceM: getNonNegativeDistance(elements.obfuscateEndDistanceInput),
  };
}

function getNonNegativeDistance(input: HTMLInputElement): number {
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
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
    obfuscatePrivacyInput: getElement<HTMLInputElement>(
      root,
      "fit-demo-obfuscate-privacy"
    ),
    obfuscateStartDistanceInput: getElement<HTMLInputElement>(
      root,
      "fit-demo-obfuscate-start-distance"
    ),
    obfuscateEndDistanceInput: getElement<HTMLInputElement>(
      root,
      "fit-demo-obfuscate-end-distance"
    ),
    prettyInput: getElement<HTMLInputElement>(root, "fit-demo-pretty"),
    convertButton: getElement<HTMLButtonElement>(root, "fit-demo-convert"),
    copyButton: getElement<HTMLButtonElement>(root, "fit-demo-copy"),
    downloadLink,
    compressedDownloadLink,
    obfuscatedFitDownloadLink: getElement<HTMLAnchorElement>(
      root,
      "fit-demo-download-obfuscated-fit"
    ),
    statusOutput: getElement<HTMLElement>(root, "fit-demo-status"),
    summaryOutput: getElement<HTMLElement>(root, "fit-demo-summary"),
    metadataOutput: getElement<HTMLElement>(root, "fit-demo-metadata"),
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

function getDownsampleStrategy(
  elements: DemoElements
): TrackJsonDownsampleStrategy {
  return elements.downsampleStrategySelect.value === "aggregate"
    ? "aggregate"
    : "uniform";
}

function getRouteTitle(elements: DemoElements, file: File): string {
  const title = elements.titleInput.value.trim();
  return title || stripExtension(file.name) || "Track";
}

function makeTrackJsonFileName(file: File, extension: ".trj" | ".trjgz"): string {
  return `${stripExtension(file.name) || "track"}${extension}`;
}

function makeObfuscatedFitFileName(file: File): string {
  return `${stripExtension(file.name) || "track"}.obfuscated.fit`;
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

function getRecordProperty(
  object: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = object[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits);
}

function getStatsPrecision(unit: string): number {
  return unit === "rpm" || unit === "bpm" || unit === "W" ? 0 : 1;
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
