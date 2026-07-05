import {
  computeHeartRateZoneSummary,
  computePowerZoneSummary,
  downsampleTrackActivity,
  mergeTrackActivities,
} from "./activity";
import {
  addTrackJsonBbox,
  parseFitBytes,
  obfuscateFitPrivacy,
  trackActivityToTrackJson,
  trackJsonDataToTrackActivity,
} from "./fit";
import {
  compactTrackJsonData,
  obfuscateTrackJsonPrivacy,
  countTrackJsonPositionedPoints,
  downsampleTrackJsonData,
  getTrackJsonMetadata,
  parseTrackJsonData,
} from "./trackjson";
import type { TrackActivity, TrackPoint } from "./activity";
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
  downsampleInput: HTMLInputElement;
  downsampleStrategySelect: HTMLSelectElement;
  maxPointsInput: HTMLInputElement;
  preserveEndpointsInput: HTMLInputElement;
  obfuscatePrivacyInput: HTMLInputElement;
  obfuscateStartDistanceInput: HTMLInputElement;
  obfuscateEndDistanceInput: HTMLInputElement;
  ftpInput: HTMLInputElement;
  lthrInput: HTMLInputElement;
  printAnalysisInput: HTMLInputElement;
  prettyInput: HTMLInputElement;
  convertButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  downloadLink: HTMLAnchorElement;
  compressedDownloadLink: HTMLAnchorElement;
  obfuscatedFitDownloadLink: HTMLAnchorElement;
  statusOutput: HTMLElement;
  summaryOutput: HTMLElement;
  mapOutput: HTMLElement;
  trackJsonOutput: HTMLTextAreaElement;
};

type ConversionResult = {
  trackJson: string;
  trackJsonData: unknown;
  title: string;
  sourceType: "fit" | "trackjson" | "trjgz" | "merged";
  originalPointCount?: number;
  renderedPointCount?: number;
  activity?: TrackActivity;
  renderedActivity?: TrackActivity;
  analysisPoints?: TrackPoint[];
  obfuscatedFitBytes?: Uint8Array;
  obfuscatedPrivacyApplied?: boolean;
  privacyStartDistanceM?: number;
  privacyEndDistanceM?: number;
};

type ParsedInputActivity = {
  file: File;
  activity: TrackActivity;
  sourceType: "fit" | "trackjson" | "trjgz";
  originalPointCount: number;
  obfuscatedFitBytes?: Uint8Array;
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
  syncPrivacyControls(elements);
  syncAnalysisControls(elements);

  elements.downsampleInput.addEventListener("change", () => {
    syncDownsampleControls(elements);
  });

  elements.obfuscatePrivacyInput.addEventListener("change", () => {
    syncPrivacyControls(elements);
  });

  elements.printAnalysisInput.addEventListener("change", () => {
    syncAnalysisControls(elements);
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
  const files = Array.from(elements.fileInput.files || []);
  if (files.length === 0) {
    setStatus(elements, "Choose FIT, TrackJSON, TRJ, or TRJGZ file(s) first.", true);
    return;
  }

  setBusy(elements, true);
  clearOutput(elements);
  setStatus(elements, files.length > 1 ? "Converting and merging..." : "Converting...");

  try {
    const result = await convertInputFiles(files, elements);
    const trackJsonUrl = await updateTrackJsonDownload(
      elements,
      getDownloadBaseName(files, result),
      result.trackJson
    );
    updateObfuscatedFitDownload(
      elements,
      files.length === 1 ? files[0] : undefined,
      result.obfuscatedFitBytes
    );

    elements.trackJsonOutput.value = result.trackJson;
    elements.copyButton.disabled = false;

    renderTrackJson(elements, renderer, trackJsonUrl, result.title);
    showSummary(elements, files, result);
    setStatus(elements, "Track data was rendered.");
  } finally {
    setBusy(elements, false);
  }
}

async function convertInputFiles(
  files: File[],
  elements: DemoElements
): Promise<ConversionResult> {
  if (files.length === 1) {
    return convertInputFile(files[0], elements);
  }

  const parsedInputs = await Promise.all(
    files.map((file) => convertInputFileToActivity(file, elements))
  );
  const title = getMergedRouteTitle(files);
  const mergedActivity = mergeTrackActivities(
    parsedInputs.map((input) => input.activity),
    {
      name: title,
      description: `Merged from ${files.map((file) => file.name).join(", ")}`,
    }
  );
  const renderedActivity = maybeDownsample(mergedActivity, elements);
  const trackJson = trackActivityToTrackJson(renderedActivity, {
    title,
    description: `Merged from ${files.map((file) => file.name).join(", ")}`,
    pretty: elements.prettyInput.checked,
  });
  const trackJsonData = JSON.parse(trackJson);
  const obfuscatedFitBytes = parsedInputs.length === 1
    ? parsedInputs[0].obfuscatedFitBytes
    : undefined;

  return {
    trackJson,
    trackJsonData,
    title,
    sourceType: "merged",
    originalPointCount: parsedInputs.reduce(
      (sum, input) => sum + input.originalPointCount,
      0
    ),
    renderedPointCount: renderedActivity.points.length,
    activity: mergedActivity,
    renderedActivity,
    analysisPoints: mergedActivity.points,
    obfuscatedFitBytes,
    obfuscatedPrivacyApplied: elements.obfuscatePrivacyInput.checked,
    privacyStartDistanceM: getPrivacyObfuscationOptions(elements).startDistanceM,
    privacyEndDistanceM: getPrivacyObfuscationOptions(elements).endDistanceM,
  };
}

async function convertInputFileToActivity(
  file: File,
  elements: DemoElements
): Promise<ParsedInputActivity> {
  const lowerName = file.name.toLowerCase();

  if (
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".geojson") ||
    lowerName.endsWith(".trj")
  ) {
    const text = await file.text();
    return convertTrackJsonTextToActivity(file, text, elements, "trackjson");
  }

  if (lowerName.endsWith(".trjgz")) {
    const bytes = await file.arrayBuffer();
    const text = await decompressGzipText(bytes);
    return convertTrackJsonTextToActivity(file, text, elements, "trjgz");
  }

  const originalBytes = await file.arrayBuffer();
  const privacyOptions = getPrivacyObfuscationOptions(elements);
  const obfuscatedFitBytes = elements.obfuscatePrivacyInput.checked
    ? obfuscateFitPrivacy(originalBytes, privacyOptions)
    : undefined;
  const fitBytes = obfuscatedFitBytes || originalBytes;
  const activity = parseFitBytes(fitBytes);

  return {
    file,
    activity,
    sourceType: "fit",
    originalPointCount: activity.points.length,
    obfuscatedFitBytes,
  };
}

function convertTrackJsonTextToActivity(
  file: File,
  text: string,
  elements: DemoElements,
  sourceType: "trackjson" | "trjgz"
): ParsedInputActivity {
  const originalTrackJsonData = parseTrackJsonData(text);
  const privacyOptions = getPrivacyObfuscationOptions(elements);
  const obfuscatedTrackJsonData = elements.obfuscatePrivacyInput.checked
    ? obfuscateTrackJsonPrivacy(originalTrackJsonData, privacyOptions)
    : originalTrackJsonData;
  const activity = trackJsonDataToTrackActivity(obfuscatedTrackJsonData, {
    sourceType,
    name: getRouteTitle(file),
  });

  return {
    file,
    activity,
    sourceType,
    originalPointCount: countTrackJsonPositionedPoints(originalTrackJsonData),
  };
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
  const title = getRouteTitle(file);

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
    analysisPoints: activity.points,
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
  const title = getRouteTitle(file);
  const originalPointCount = countTrackJsonPositionedPoints(originalTrackJsonData);
  const downsampledTrackJsonData = maybeDownsampleTrackJsonData(
    obfuscatedTrackJsonData,
    elements
  );
  const trackJsonData = addTrackJsonBbox(
    compactTrackJsonData(downsampledTrackJsonData)
  );
  const trackJson = JSON.stringify(
    trackJsonData,
    null,
    elements.prettyInput.checked ? 2 : 0
  );
  const renderedPointCount = countTrackJsonPositionedPoints(trackJsonData);
  const analysisPoints = extractTrackJsonAnalysisPoints(obfuscatedTrackJsonData);

  return {
    trackJson,
    trackJsonData,
    title,
    sourceType,
    originalPointCount,
    renderedPointCount,
    analysisPoints,
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
  baseName: string,
  trackJson: string
): Promise<string> {
  revokeCurrentTrackJsonUrls();

  const rawBlob = new Blob([trackJson], {
    type: "application/json",
  });
  const rawUrl = URL.createObjectURL(rawBlob);
  currentTrackJsonUrl = rawUrl;

  elements.downloadLink.href = rawUrl;
  elements.downloadLink.download = makeTrackJsonFileName(baseName, ".trj");
  elements.downloadLink.hidden = false;

  elements.compressedDownloadLink.removeAttribute("href");
  elements.compressedDownloadLink.hidden = true;

  const compressedBlob = await gzipText(trackJson);
  if (compressedBlob) {
    const compressedUrl = URL.createObjectURL(compressedBlob);
    currentCompressedTrackJsonUrl = compressedUrl;

    elements.compressedDownloadLink.href = compressedUrl;
    elements.compressedDownloadLink.download = makeTrackJsonFileName(baseName, ".trjgz");
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
  file: File | undefined,
  bytes: Uint8Array | undefined
) {
  if (currentObfuscatedFitUrl) {
    URL.revokeObjectURL(currentObfuscatedFitUrl);
    currentObfuscatedFitUrl = undefined;
  }

  elements.obfuscatedFitDownloadLink.removeAttribute("href");
  elements.obfuscatedFitDownloadLink.hidden = true;

  if (!bytes || !file) {
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
  files: File[],
  result: ConversionResult
) {
  const lines: string[] = [
    files.length === 1
      ? `file: ${files[0].name}`
      : `files: ${files.length} (${files.map((file) => file.name).join(", ")})`,
    `source: ${formatSourceType(result.sourceType)}`,
  ];

  if (typeof result.originalPointCount === "number") {
    lines.push(`original points: ${result.originalPointCount}`);
  }

  if (typeof result.renderedPointCount === "number") {
    lines.push(`rendered points: ${result.renderedPointCount}`);
  }

  appendBboxSummaryLine(lines, result.trackJsonData);
  appendRcenterSummaryLine(lines, result.trackJsonData);

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
    const createdAt = getNumberProperty(metadata, "createdAt");
    const startTime = getNumberProperty(metadata, "startTime");
    const totalDistanceM = getNumberProperty(metadata, "totalDistanceM");
    const totalTimerTime = getNumberProperty(metadata, "totalTimerTime");
    const totalElapsedTime = getNumberProperty(metadata, "totalElapsedTime");
    const localTimeOffsetSeconds = getNumberProperty(
      metadata,
      "localTimeOffsetSeconds"
    );

    if (sport) {
      lines.push(`sport: ${sport}`);
    }

    if (subSport) {
      lines.push(`sub sport: ${subSport}`);
    }

    if (typeof createdAt === "number") {
      lines.push(`created at: ${formatUtcDateTime(createdAt)}`);
    }

    if (typeof startTime === "number") {
      lines.push(`start time: ${formatUtcDateTime(startTime)}`);
    }

    const endTime = getActivityEndTime(metadata);
    if (typeof endTime === "number") {
      lines.push(`end time: ${formatUtcDateTime(endTime)}`);
    }

    if (typeof totalDistanceM === "number") {
      lines.push(`total distance: ${formatDistance(totalDistanceM)}`);
    }

    if (typeof totalTimerTime === "number") {
      lines.push(`timer time: ${formatDuration(totalTimerTime)}`);
    } else if (typeof totalElapsedTime === "number") {
      lines.push(`elapsed time: ${formatDuration(totalElapsedTime)}`);
    }

    if (typeof localTimeOffsetSeconds === "number") {
      lines.push(`local time offset: ${formatTimeOffset(localTimeOffsetSeconds)}`);
    }

    appendMetadataSummaryLines(lines, metadata);
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

  appendAnalysisSections(elements.summaryOutput, result, elements, metadata);
}

function appendBboxSummaryLine(lines: string[], data: unknown) {
  const bbox = getTrackJsonBbox(data);
  if (!bbox) {
    return;
  }

  lines.push(
    `bbox: west ${formatNumber(bbox[0], 5)}, ` +
    `south ${formatNumber(bbox[1], 5)}, ` +
    `east ${formatNumber(bbox[2], 5)}, ` +
    `north ${formatNumber(bbox[3], 5)}`
  );
}

function appendRcenterSummaryLine(lines: string[], data: unknown) {
  const rcenter = getTrackJsonRcenter(data);
  if (!rcenter) {
    return;
  }

  lines.push(
    `rcenter: lon ${formatNumber(rcenter[0], 5)}, ` +
    `lat ${formatNumber(rcenter[1], 5)}`
  );
}

function getTrackJsonBbox(data: unknown): [number, number, number, number] | undefined {
  if (!isRecord(data) || !Array.isArray(data.bbox) || data.bbox.length < 4) {
    return undefined;
  }

  const bbox = data.bbox.slice(0, 4);
  if (!bbox.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return undefined;
  }

  return bbox as [number, number, number, number];
}

function getTrackJsonRcenter(data: unknown): [number, number] | undefined {
  if (!isRecord(data) || !Array.isArray(data.rcenter) || data.rcenter.length < 2) {
    return undefined;
  }

  const rcenter = data.rcenter.slice(0, 2);
  if (!rcenter.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return undefined;
  }

  return rcenter as [number, number];
}

function getResultMetadata(result: ConversionResult): Record<string, unknown> | undefined {
  const trackJsonMetadata = getTrackJsonMetadata(result.trackJsonData);
  if (trackJsonMetadata) {
    return trackJsonMetadata;
  }

  const activityMetadata = result.renderedActivity?.metadata || result.activity?.metadata;
  return isRecord(activityMetadata) ? activityMetadata : undefined;
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

type ZoneSummary = {
  totalSeconds: number;
  durations: Record<string, number>;
  percentages: Record<string, number>;
};

type ZoneHistogramRow = {
  label: string;
  seconds: number;
  percentage: number;
  color: string;
};

type PowerCurvePoint = {
  durationSeconds: number;
  watts: number;
};

type HistogramBin = {
  label: string;
  color: string;
  matches: (value: number) => boolean;
};

function appendAnalysisSections(
  container: HTMLElement,
  result: ConversionResult,
  elements: DemoElements,
  metadata: Record<string, unknown> | undefined
) {
  if (!elements.printAnalysisInput.checked) {
    return;
  }

  const points = result.analysisPoints || [];
  if (points.length > 0) {
    appendSpeedHistogram(container, points);
    appendCadenceHistogram(container, points);

    const lthrBpm = getPositiveNumber(elements.lthrInput);
    if (typeof lthrBpm === "number") {
      appendHeartRateHistogram(container, points, lthrBpm);
    }

    const ftpW = getPositiveNumber(elements.ftpInput);
    if (typeof ftpW === "number") {
      appendPowerHistogram(container, points, ftpW);
    }
  }

  appendPowerCurve(container, metadata);
}

function appendSpeedHistogram(container: HTMLElement, points: TrackPoint[]) {
  const rows = computeHistogramRows(points, {
    title: "Speed histogram",
    getValue: (point) => {
      if (typeof point.speedMps !== "number" || !Number.isFinite(point.speedMps)) {
        return undefined;
      }
      return point.speedMps * 3.6;
    },
    ignoreZero: true,
    bins: [
      {
        label: "≤15 km/h",
        color: "#6fd3ff",
        matches: (value) => value <= 15,
      },
      {
        label: "≤20 km/h",
        color: "#2f7df6",
        matches: (value) => value > 15 && value <= 20,
      },
      {
        label: "≤25 km/h",
        color: "#2fa84f",
        matches: (value) => value > 20 && value <= 25,
      },
      {
        label: "≤30 km/h",
        color: "#f2d33b",
        matches: (value) => value > 25 && value <= 30,
      },
      {
        label: "≤35 km/h",
        color: "#e14545",
        matches: (value) => value > 30 && value <= 35,
      },
      {
        label: "≤40 km/h",
        color: "#7a3db8",
        matches: (value) => value > 35 && value <= 40,
      },
      {
        label: ">40 km/h",
        color: "#7a3db8",
        matches: (value) => value > 40,
      },
    ],
  });

  if (rows) {
    appendHistogramSection(container, rows.title, rows.rows);
  }
}

function appendCadenceHistogram(container: HTMLElement, points: TrackPoint[]) {
  const rows = computeHistogramRows(points, {
    title: "Cadence histogram",
    getValue: (point) => point.cadenceRpm,
    ignoreZero: true,
    bins: [
      {
        label: "≤50 rpm",
        color: "#6fd3ff",
        matches: (value) => value <= 50,
      },
      {
        label: "≤60 rpm",
        color: "#2f7df6",
        matches: (value) => value > 50 && value <= 60,
      },
      {
        label: "≤70 rpm",
        color: "#2fa84f",
        matches: (value) => value > 60 && value <= 70,
      },
      {
        label: "≤80 rpm",
        color: "#f2d33b",
        matches: (value) => value > 70 && value <= 80,
      },
      {
        label: "≤90 rpm",
        color: "#f39c34",
        matches: (value) => value > 80 && value <= 90,
      },
      {
        label: "≤100 rpm",
        color: "#e14545",
        matches: (value) => value > 90 && value <= 100,
      },
      {
        label: ">100 rpm",
        color: "#7a3db8",
        matches: (value) => value > 100,
      },
    ],
  });

  if (rows) {
    appendHistogramSection(container, rows.title, rows.rows);
  }
}

function appendHeartRateHistogram(
  container: HTMLElement,
  points: TrackPoint[],
  lthrBpm: number
) {
  const summary = computeHeartRateZoneSummary(points, lthrBpm);
  if (summary.totalSeconds <= 0) {
    return;
  }

  appendHistogramSection(
    container,
    `Heart-rate histogram by LTHR ${formatNumber(lthrBpm, 0)} bpm`,
    createHeartRateZoneRows(summary, lthrBpm)
  );
}

function appendPowerHistogram(
  container: HTMLElement,
  points: TrackPoint[],
  ftpW: number
) {
  const summary = computePowerZoneSummary(points, ftpW);
  if (summary.totalSeconds <= 0) {
    return;
  }

  appendHistogramSection(
    container,
    `Power histogram by FTP ${formatNumber(ftpW, 0)} W`,
    createPowerZoneRows(summary, ftpW)
  );
}

function appendHistogramSection(
  container: HTMLElement,
  titleText: string,
  rows: ZoneHistogramRow[]
) {
  if (rows.every((row) => row.seconds <= 0)) {
    return;
  }

  const section = document.createElement("section");
  section.className = "fit-demo-zone-histogram";

  const title = document.createElement("div");
  title.className = "fit-demo-zone-title";
  title.textContent = titleText;
  section.appendChild(title);

  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "fit-demo-zone-row";

    const label = document.createElement("div");
    label.className = "fit-demo-zone-label";
    label.textContent = `${row.label}: ${formatDuration(row.seconds)} (${formatNumber(
      row.percentage,
      0
    )}%)`;

    const track = document.createElement("div");
    track.className = "fit-demo-zone-bar-track";

    const bar = document.createElement("div");
    bar.className = "fit-demo-zone-bar";
    bar.style.width = `${clampPercentage(row.percentage)}%`;
    bar.title = label.textContent || "";

    track.appendChild(bar);
    item.appendChild(label);
    item.appendChild(track);
    section.appendChild(item);
  });

  container.appendChild(section);
}

function appendPowerCurve(
  container: HTMLElement,
  metadata: Record<string, unknown> | undefined
) {
  const points = getPowerCurvePoints(metadata);
  if (points.length === 0) {
    return;
  }

  const section = document.createElement("section");
  section.className = "fit-demo-power-curve";

  const title = document.createElement("div");
  title.className = "fit-demo-zone-title";
  title.textContent = "Power curve";
  section.appendChild(title);

  const svg = buildPowerCurveSvg(points);
  section.appendChild(svg);

  container.appendChild(section);
}

function getPowerCurvePoints(
  metadata: Record<string, unknown> | undefined
): PowerCurvePoint[] {
  if (!metadata) {
    return [];
  }

  const bestEfforts = getRecordProperty(metadata, "bestEfforts");
  const powerW = bestEfforts ? getRecordProperty(bestEfforts, "powerW") : undefined;
  if (!powerW) {
    return [];
  }

  return Object.entries(powerW)
    .map(([duration, watts]) => {
      const durationSeconds = Number(duration);
      return typeof watts === "number" && Number.isFinite(watts) &&
        Number.isFinite(durationSeconds) && durationSeconds > 0
        ? { durationSeconds, watts }
        : undefined;
    })
    .filter((point): point is PowerCurvePoint => Boolean(point))
    .sort((left, right) => left.durationSeconds - right.durationSeconds);
}

function buildPowerCurveSvg(points: PowerCurvePoint[]): SVGSVGElement {
  const width = 760;
  const height = 260;
  const marginTop = 16;
  const marginRight = 16;
  const marginBottom = 40;
  const marginLeft = 52;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;
  const minDuration = points[0].durationSeconds;
  const maxDuration = points[points.length - 1].durationSeconds;
  const maxPower = Math.max(...points.map((point) => point.watts));
  const yMax = getNiceCeiling(maxPower);
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "fit-demo-power-curve-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Power curve chart");

  const xValue = (seconds: number) => {
    if (maxDuration <= minDuration) {
      return marginLeft + plotWidth / 2;
    }
    const minLog = Math.log10(minDuration);
    const maxLog = Math.log10(maxDuration);
    const valueLog = Math.log10(seconds);
    const ratio = (valueLog - minLog) / (maxLog - minLog);
    return marginLeft + ratio * plotWidth;
  };
  const yValue = (watts: number) => {
    const ratio = yMax <= 0 ? 0 : watts / yMax;
    return marginTop + plotHeight - ratio * plotHeight;
  };

  appendSvgLine(svg, marginLeft, marginTop, marginLeft, marginTop + plotHeight, "#666");
  appendSvgLine(
    svg,
    marginLeft,
    marginTop + plotHeight,
    marginLeft + plotWidth,
    marginTop + plotHeight,
    "#666"
  );

  const yTicks = createLinearTicks(yMax, 5);
  yTicks.forEach((tick) => {
    const y = yValue(tick);
    appendSvgLine(svg, marginLeft, y, marginLeft + plotWidth, y, "#e5e5e5");
    appendSvgText(svg, marginLeft - 8, y + 4, formatNumber(tick, 0), "end", "11px");
  });

  points.forEach((point) => {
    const x = xValue(point.durationSeconds);
    appendSvgLine(
      svg,
      x,
      marginTop + plotHeight,
      x,
      marginTop + plotHeight + 6,
      "#666"
    );
    appendSvgText(
      svg,
      x,
      marginTop + plotHeight + 20,
      formatDurationLabel(point.durationSeconds),
      "middle",
      "11px"
    );
  });

  const polyline = document.createElementNS(svgNs, "polyline");
  polyline.setAttribute(
    "points",
    points
      .map((point) => `${xValue(point.durationSeconds)},${yValue(point.watts)}`)
      .join(" ")
  );
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#0078A8");
  polyline.setAttribute("stroke-width", "2.5");
  svg.appendChild(polyline);

  appendSvgText(
    svg,
    marginLeft + plotWidth / 2,
    height - 8,
    "Duration",
    "middle",
    "11px"
  );

  points.forEach((point) => {
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(xValue(point.durationSeconds)));
    circle.setAttribute("cy", String(yValue(point.watts)));
    circle.setAttribute("r", "3");
    circle.setAttribute("fill", "#0078A8");
    circle.setAttribute(
      "aria-label",
      `${formatDurationLabel(point.durationSeconds)} ${formatNumber(point.watts, 0)} W`
    );
    svg.appendChild(circle);
  });

  appendSvgText(svg, marginLeft, marginTop - 4, "Power (W)", "start", "11px");

  return svg;
}

function appendSvgLine(
  svg: SVGSVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string
) {
  const svgNs = "http://www.w3.org/2000/svg";
  const line = document.createElementNS(svgNs, "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", stroke);
  line.setAttribute("stroke-width", "1");
  svg.appendChild(line);
}

function appendSvgText(
  svg: SVGSVGElement,
  x: number,
  y: number,
  text: string,
  anchor: "start" | "middle" | "end",
  fontSize: string
) {
  const svgNs = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(svgNs, "text");
  node.setAttribute("x", String(x));
  node.setAttribute("y", String(y));
  node.setAttribute("text-anchor", anchor);
  node.setAttribute("font-size", fontSize);
  node.setAttribute("fill", "#444");
  node.textContent = text;
  svg.appendChild(node);
}

function createLinearTicks(maxValue: number, targetCount: number): number[] {
  if (maxValue <= 0) {
    return [0];
  }

  const step = getNiceTickStep(maxValue / targetCount);
  const ticks: number[] = [];
  for (let value = 0; value <= maxValue + step * 0.5; value += step) {
    ticks.push(value);
  }
  return ticks;
}

function getNiceTickStep(value: number): number {
  if (value <= 0 || !Number.isFinite(value)) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(value));
  const fraction = value / Math.pow(10, exponent);
  let niceFraction = 1;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

function getNiceCeiling(value: number): number {
  if (value <= 0 || !Number.isFinite(value)) {
    return 1;
  }
  return Math.ceil(value / getNiceTickStep(value / 5)) * getNiceTickStep(value / 5);
}

function formatDurationLabel(seconds: number): string {
  if (seconds < 60) {
    return `${formatNumber(seconds, 0)}s`;
  }
  if (seconds < 3600) {
    return `${formatNumber(seconds / 60, seconds % 60 === 0 ? 0 : 1)}m`;
  }
  return `${formatNumber(seconds / 3600, seconds % 3600 === 0 ? 0 : 1)}h`;
}

function computeHistogramRows(
  points: TrackPoint[],
  options: {
    title: string;
    getValue: (point: TrackPoint) => number | undefined;
    bins: HistogramBin[];
    ignoreZero: boolean;
  }
): { title: string; rows: ZoneHistogramRow[] } | undefined {
  const durations = options.bins.map(() => 0);
  const useTimedDurations = hasTimedAnalysisPoints(points);
  let totalSeconds = 0;

  if (useTimedDurations) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const value = options.getValue(points[index]);
      const duration = getPointDurationSeconds(points, index);
      if (duration <= 0 || !isHistogramValueValid(value, options.ignoreZero)) {
        continue;
      }
      const binIndex = options.bins.findIndex((bin) => bin.matches(value));
      if (binIndex < 0) {
        continue;
      }
      durations[binIndex] += duration;
      totalSeconds += duration;
    }
  } else {
    points.forEach((point) => {
      const value = options.getValue(point);
      if (!isHistogramValueValid(value, options.ignoreZero)) {
        return;
      }
      const binIndex = options.bins.findIndex((bin) => bin.matches(value));
      if (binIndex < 0) {
        return;
      }
      durations[binIndex] += 1;
      totalSeconds += 1;
    });
  }

  if (totalSeconds <= 0) {
    return undefined;
  }

  return {
    title: options.title,
    rows: options.bins.map((bin, index) => ({
      label: bin.label,
      seconds: durations[index],
      percentage: (durations[index] / totalSeconds) * 100,
      color: bin.color,
    })),
  };
}

function isHistogramValueValid(
  value: number | undefined,
  ignoreZero: boolean
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  if (ignoreZero && value <= 0) {
    return false;
  }
  return true;
}

function hasTimedAnalysisPoints(points: TrackPoint[]): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (getPointDurationSeconds(points, index) > 0) {
      return true;
    }
  }
  return false;
}

function getPointDurationSeconds(points: TrackPoint[], index: number): number {
  const current = points[index]?.time;
  const next = points[index + 1]?.time;
  if (
    typeof current !== "number" ||
    !Number.isFinite(current) ||
    typeof next !== "number" ||
    !Number.isFinite(next)
  ) {
    return 0;
  }
  return next > current ? next - current : 0;
}

function formatZoneLimit(value: number): string {
  return Number.isInteger(value)
    ? formatNumber(value, 0)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function createPowerZoneRows(
  summary: ZoneSummary,
  ftpW: number
): ZoneHistogramRow[] {
  const z1Max = ftpW * 0.55;
  const z2Max = ftpW * 0.75;
  const z3Max = ftpW * 0.9;
  const z4Max = ftpW * 1.05;
  const z5Max = ftpW * 1.2;
  const z6Max = ftpW * 1.5;

  return [
    createZoneHistogramRow(
      summary,
      "z1",
      `Z1 ≤55% FTP, ≤${formatZoneLimit(z1Max)} W`,
      "#6fd3ff"
    ),
    createZoneHistogramRow(
      summary,
      "z2",
      `Z2 ≤75% FTP, ≤${formatZoneLimit(z2Max)} W`,
      "#2f7df6"
    ),
    createZoneHistogramRow(
      summary,
      "z3",
      `Z3 ≤90% FTP, ≤${formatZoneLimit(z3Max)} W`,
      "#2fa84f"
    ),
    createZoneHistogramRow(
      summary,
      "z4",
      `Z4 ≤105% FTP, ≤${formatZoneLimit(z4Max)} W`,
      "#f2d33b"
    ),
    createZoneHistogramRow(
      summary,
      "z5",
      `Z5 ≤120% FTP, ≤${formatZoneLimit(z5Max)} W`,
      "#f39c34"
    ),
    createZoneHistogramRow(
      summary,
      "z6",
      `Z6 ≤150% FTP, ≤${formatZoneLimit(z6Max)} W`,
      "#e14545"
    ),
    createZoneHistogramRow(
      summary,
      "z7",
      `Z7 >150% FTP, >${formatZoneLimit(z6Max)} W`,
      "#7a3db8"
    ),
  ];
}

function createHeartRateZoneRows(
  summary: ZoneSummary,
  lthrBpm: number
): ZoneHistogramRow[] {
  const z1Max = lthrBpm * 0.81;
  const z2Max = lthrBpm * 0.89;
  const z3Max = lthrBpm * 0.94;
  const z4Max = lthrBpm;

  return [
    createZoneHistogramRow(
      summary,
      "z1",
      `Z1 ≤81% LTHR, ≤${formatZoneLimit(z1Max)} bpm`,
      "#2f7df6"
    ),
    createZoneHistogramRow(
      summary,
      "z2",
      `Z2 ≤89% LTHR, ≤${formatZoneLimit(z2Max)} bpm`,
      "#2fa84f"
    ),
    createZoneHistogramRow(
      summary,
      "z3",
      `Z3 ≤94% LTHR, ≤${formatZoneLimit(z3Max)} bpm`,
      "#f2d33b"
    ),
    createZoneHistogramRow(
      summary,
      "z4",
      `Z4 ≤100% LTHR, ≤${formatZoneLimit(z4Max)} bpm`,
      "#f39c34"
    ),
    createZoneHistogramRow(
      summary,
      "z5",
      `Z5 >100% LTHR, >${formatZoneLimit(z4Max)} bpm`,
      "#e14545"
    ),
  ];
}

function createZoneHistogramRow(
  summary: ZoneSummary,
  zone: string,
  label: string,
  color: string
): ZoneHistogramRow {
  return {
    label,
    seconds: summary.durations[zone] || 0,
    percentage: summary.percentages[zone] || 0,
    color,
  };
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(1, value));
}

function extractTrackJsonAnalysisPoints(data: unknown): TrackPoint[] {
  const points: TrackPoint[] = [];

  getTrackJsonFeatures(data).forEach((feature) => {
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (!isRecord(geometry) || geometry.type !== "LineString") {
      return;
    }
    if (!Array.isArray(geometry.coordinates) || !isRecord(properties)) {
      return;
    }

    const coordinateProperties = properties.coordinateProperties;
    if (!isRecord(coordinateProperties)) {
      return;
    }

    geometry.coordinates.forEach((_, index) => {
      const point: TrackPoint = {};
      assignTrackJsonSeriesNumber(
        point,
        "time",
        coordinateProperties.times,
        index,
        normalizeTrackJsonTime
      );
      assignTrackJsonSeriesNumber(
        point,
        "powerW",
        coordinateProperties.powers,
        index
      );
      assignTrackJsonSeriesNumber(
        point,
        "heartRateBpm",
        coordinateProperties.heartRates,
        index
      );
      assignTrackJsonSeriesNumber(
        point,
        "cadenceRpm",
        coordinateProperties.cadences,
        index
      );
      assignTrackJsonSeriesNumber(
        point,
        "speedMps",
        coordinateProperties.speeds,
        index,
        normalizeTrackJsonSpeedKph
      );
      if (Object.keys(point).length > 0) {
        points.push(point);
      }
    });
  });

  return points;
}

function getTrackJsonFeatures(data: unknown): Array<Record<string, unknown>> {
  if (!isRecord(data)) {
    return [];
  }

  if (data.type === "Feature") {
    return [data];
  }

  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    return [];
  }

  return data.features.filter(isRecord);
}

function assignTrackJsonSeriesNumber<K extends keyof TrackPoint>(
  point: TrackPoint,
  key: K,
  series: unknown,
  index: number,
  convert: (value: number) => number | undefined = (value) => value
) {
  if (!Array.isArray(series)) {
    return;
  }

  const value = series[index];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  const converted = convert(value);
  if (typeof converted === "number" && Number.isFinite(converted)) {
    point[key] = converted as TrackPoint[K];
  }
}

function normalizeTrackJsonTime(value: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return value > 100000000000 ? value / 1000 : value;
}


function normalizeTrackJsonSpeedKph(value: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return value / 3.6;
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

function syncPrivacyControls(elements: DemoElements) {
  const enabled = elements.obfuscatePrivacyInput.checked;
  elements.obfuscateStartDistanceInput.disabled = !enabled;
  elements.obfuscateEndDistanceInput.disabled = !enabled;
}

function syncAnalysisControls(elements: DemoElements) {
  const enabled = elements.printAnalysisInput.checked;
  elements.ftpInput.disabled = !enabled;
  elements.lthrInput.disabled = !enabled;
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

function getPositiveNumber(input: HTMLInputElement): number | undefined {
  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? value : undefined;
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
    ftpInput: getElement<HTMLInputElement>(root, "fit-demo-ftp"),
    lthrInput: getElement<HTMLInputElement>(root, "fit-demo-lthr"),
    printAnalysisInput: getElement<HTMLInputElement>(
      root,
      "fit-demo-print-analysis"
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

function getRouteTitle(file: File): string {
  return stripExtension(file.name) || "Track";
}

function getMergedRouteTitle(files: File[]): string {
  const firstName = stripExtension(files[0]?.name || "");
  return firstName ? `${firstName} merged` : "Merged track";
}

function getDownloadBaseName(files: File[], result: ConversionResult): string {
  if (files.length === 1) {
    return stripExtension(files[0].name) || "track";
  }

  const title = result.title.trim();
  return title || "merged-track";
}

function makeTrackJsonFileName(baseName: string, extension: ".trj" | ".trjgz"): string {
  return `${stripExtension(baseName) || "track"}${extension}`;
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

function getActivityEndTime(metadata: Record<string, unknown>): number | undefined {
  const endTime = getNumberProperty(metadata, "endTime");
  if (typeof endTime === "number") {
    return endTime;
  }

  const startTime = getNumberProperty(metadata, "startTime");
  const totalElapsedTime = getNumberProperty(metadata, "totalElapsedTime");
  if (typeof startTime === "number" && typeof totalElapsedTime === "number") {
    return startTime + totalElapsedTime;
  }

  return undefined;
}

function formatUtcDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function formatTimeOffset(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const sign = totalSeconds < 0 ? "-" : "+";
  const absoluteSeconds = Math.abs(totalSeconds);
  const hours = Math.floor(absoluteSeconds / 3600);
  const minutes = Math.floor((absoluteSeconds % 3600) / 60);
  const restSeconds = absoluteSeconds % 60;
  const prefix = `UTC${sign}${hours.toString().padStart(2, "0")}:` +
    minutes.toString().padStart(2, "0");

  if (restSeconds > 0) {
    return `${prefix}:${restSeconds.toString().padStart(2, "0")}`;
  }

  return prefix;
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
