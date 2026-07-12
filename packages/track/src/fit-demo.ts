import {
  computeHeartRateZoneSummary,
  computePowerZoneSummary,
  downsampleTrackActivity,
  mergeTrackActivities,
  trimTrackActivity,
} from "./activity";
import {
  TRACK_SCATTER_METRICS,
  buildScatterPlotPoints,
  buildSmoothedScatterSamples,
  createRangeTicks,
  getActivityHistogramDisplay,
  getActivityMetadataSummaryLines,
  getActivityPowerCurvePoints,
  getAvailableScatterMetrics,
  getHeartRateZoneDisplayRows,
  getPowerZoneDisplayRows,
  getScatterAxisRange,
} from "./analysis";
import {
  parseFitBytes,
  trackActivityToFit,
  trackActivityToTrackJson,
  trackJsonDataToTrackActivity,
} from "./fit";
import { parseGpxText, trackActivityToGpx } from "./gpx";
import {
  getTrackJsonMetadata,
  getTrackJsonPoi,
  parseTrackJsonData,
} from "./trackjson";
import type { TrackActivity, TrackPoint } from "./activity";
import type {
  TrackAnalysisDisplayRow,
  TrackPowerCurvePoint,
  TrackScatterMetricDefinition,
  TrackScatterPoint,
} from "./analysis";
import type { TrackJsonDownsampleStrategy } from "./trackjson";

const SCATTER_AXIS_TICK_TARGET = 8;

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
  trimActivityInput: HTMLInputElement;
  trimStartSecondsInput: HTMLInputElement;
  trimEndSecondsInput: HTMLInputElement;
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
  gpxDownloadLink: HTMLAnchorElement;
  fitDownloadLink: HTMLAnchorElement;
  statusOutput: HTMLElement;
  summaryOutput: HTMLElement;
  mapOutput: HTMLElement;
  trackJsonOutput: HTMLTextAreaElement;
};

type InputSourceType = "fit" | "gpx" | "trackjson" | "trjgz";

type ConversionResult = {
  trackJson: string;
  trackJsonData: unknown;
  title: string;
  sourceType: InputSourceType | "merged";
  originalPointCount?: number;
  renderedPointCount?: number;
  activity?: TrackActivity;
  renderedActivity?: TrackActivity;
  analysisPoints?: TrackPoint[];
  trimApplied?: boolean;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  trimmedPointCount?: number;
  obfuscatedPrivacyApplied?: boolean;
  privacyStartDistanceM?: number;
  privacyEndDistanceM?: number;
};

type ParsedInputActivity = {
  file: File;
  activity: TrackActivity;
  sourceType: InputSourceType;
  originalPointCount: number;
};

declare global {
  interface Window {
    StgyTrackViewer?: StgyTrackViewerGlobal;
  }
}

let currentTrackJsonUrl: string | undefined;
let currentCompressedTrackJsonUrl: string | undefined;
let currentGpxUrl: string | undefined;
let currentFitUrl: string | undefined;

export function initFitDemo(root: Document | HTMLElement = document) {
  const elements = getDemoElements(root);
  const renderer = createRenderer();

  syncDownsampleControls(elements);
  syncTrimControls(elements);
  syncPrivacyControls(elements);
  syncAnalysisControls(elements);

  elements.downsampleInput.addEventListener("change", () => {
    syncDownsampleControls(elements);
  });

  elements.trimActivityInput.addEventListener("change", () => {
    syncTrimControls(elements);
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
    setStatus(elements, "Choose FIT, GPX, TrackJSON, TRJ, or TRJGZ file(s) first.", true);
    return;
  }

  setBusy(elements, true);
  clearOutput(elements);
  setStatus(elements, files.length > 1 ? "Converting and merging..." : "Converting...");

  try {
    const result = await convertInputFiles(files, elements);
    const trackJsonUrl = await updateActivityDownloads(
      elements,
      getDownloadBaseName(files, result),
      result
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
  const parsedInputs = await Promise.all(
    files.map((file) => convertInputFileToActivity(file))
  );

  if (parsedInputs.length === 1) {
    const input = parsedInputs[0];
    return buildConversionResultFromActivity({
      activity: input.activity,
      elements,
      title: getRouteTitle(input.file),
      description: `Converted from ${input.file.name}`,
      sourceType: input.sourceType,
      originalPointCount: input.originalPointCount,
    });
  }

  const title = getMergedRouteTitle(files);
  const description = `Merged from ${files.map((file) => file.name).join(", ")}`;
  const mergedActivity = mergeTrackActivities(
    parsedInputs.map((input) => input.activity),
    { name: title, description }
  );

  return buildConversionResultFromActivity({
    activity: mergedActivity,
    elements,
    title,
    description,
    sourceType: "merged",
    originalPointCount: parsedInputs.reduce(
      (sum, input) => sum + input.originalPointCount,
      0
    ),
  });
}

async function convertInputFileToActivity(file: File): Promise<ParsedInputActivity> {
  const lowerName = file.name.toLowerCase();

  if (
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".geojson") ||
    lowerName.endsWith(".trj")
  ) {
    return convertTrackJsonTextToActivity(
      file,
      await file.text(),
      "trackjson"
    );
  }

  if (lowerName.endsWith(".trjgz")) {
    const bytes = await file.arrayBuffer();
    return convertTrackJsonTextToActivity(
      file,
      await decompressGzipText(bytes),
      "trjgz"
    );
  }

  if (lowerName.endsWith(".gpx")) {
    return convertGpxTextToActivity(file, await file.text());
  }

  return convertFitBytesToActivity(file, await file.arrayBuffer());
}

function convertTrackJsonTextToActivity(
  file: File,
  text: string,
  sourceType: "trackjson" | "trjgz"
): ParsedInputActivity {
  const activity = trackJsonDataToTrackActivity(parseTrackJsonData(text), {
    sourceType,
    name: getRouteTitle(file),
  });

  return {
    file,
    activity,
    sourceType,
    originalPointCount: activity.points.length,
  };
}

function convertGpxTextToActivity(file: File, text: string): ParsedInputActivity {
  const activity = parseGpxText(text);

  return {
    file,
    activity,
    sourceType: "gpx",
    originalPointCount: activity.points.length,
  };
}

function convertFitBytesToActivity(file: File, bytes: ArrayBuffer): ParsedInputActivity {
  const activity = parseFitBytes(bytes);

  return {
    file,
    activity,
    sourceType: "fit",
    originalPointCount: activity.points.length,
  };
}

type BuildConversionResultOptions = {
  activity: TrackActivity;
  elements: DemoElements;
  title: string;
  description: string;
  sourceType: ConversionResult["sourceType"];
  originalPointCount: number;
};

function buildConversionResultFromActivity(
  options: BuildConversionResultOptions
): ConversionResult {
  const trimmedActivity = maybeTrimActivity(options.activity, options.elements);
  const activity = maybeObfuscateActivityPrivacy(trimmedActivity, options.elements);
  const renderedActivity = maybeDownsample(activity, options.elements);
  const trackJson = trackActivityToTrackJson(renderedActivity, {
    title: options.title,
    description: options.description,
    pretty: options.elements.prettyInput.checked,
  });
  const trackJsonData = JSON.parse(trackJson);
  const privacyOptions = getPrivacyObfuscationOptions(options.elements);
  const trimOptions = getTrimActivityOptions(options.elements);
  const trimApplied = isTrimActivityEnabled(options.elements) &&
    (trimOptions.trimStartSeconds > 0 || trimOptions.trimEndSeconds > 0);

  return {
    trackJson,
    trackJsonData,
    title: options.title,
    sourceType: options.sourceType,
    originalPointCount: options.originalPointCount,
    renderedPointCount: renderedActivity.points.length,
    activity,
    renderedActivity,
    analysisPoints: activity.points,
    trimApplied,
    trimStartSeconds: trimOptions.trimStartSeconds,
    trimEndSeconds: trimOptions.trimEndSeconds,
    trimmedPointCount: trimmedActivity.points.length,
    obfuscatedPrivacyApplied: options.elements.obfuscatePrivacyInput.checked,
    privacyStartDistanceM: privacyOptions.startDistanceM,
    privacyEndDistanceM: privacyOptions.endDistanceM,
  };
}

function maybeTrimActivity(
  activity: TrackActivity,
  elements: DemoElements
): TrackActivity {
  if (!isTrimActivityEnabled(elements)) {
    return activity;
  }

  const options = getTrimActivityOptions(elements);
  if (options.trimStartSeconds === 0 && options.trimEndSeconds === 0) {
    return activity;
  }

  return trimTrackActivity(activity, options);
}

function maybeObfuscateActivityPrivacy(
  activity: TrackActivity,
  elements: DemoElements
): TrackActivity {
  if (!elements.obfuscatePrivacyInput.checked) {
    return activity;
  }

  const options = getPrivacyObfuscationOptions(elements);
  const startDistanceM = options.startDistanceM;
  const endDistanceM = options.endDistanceM;
  if (startDistanceM === 0 && endDistanceM === 0) {
    return activity;
  }

  const points = activity.points.map((point) => ({
    ...point,
    ...(point.metrics ? { metrics: { ...point.metrics } } : {}),
  }));
  const positionedIndices = points
    .map((point, index) => {
      return hasActivityPosition(point) ? index : -1;
    })
    .filter((index) => index >= 0);
  const totalDistanceM = getActivityPrivacyDistance(points, positionedIndices);

  if (!Number.isFinite(totalDistanceM) || totalDistanceM <= 0) {
    return {
      ...activity,
      metadata: { ...activity.metadata },
      points,
      warnings: [...activity.warnings],
    };
  }

  if (startDistanceM + endDistanceM >= totalDistanceM) {
    const anchorIndex = findActivityDistanceIndex(
      points,
      positionedIndices,
      totalDistanceM / 2
    );
    clampActivityPositionRange(
      points,
      positionedIndices,
      0,
      positionedIndices.length - 1,
      anchorIndex
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
          anchorIndex
        );
      }
    }
  }

  return {
    ...activity,
    metadata: { ...activity.metadata },
    points,
    warnings: [...activity.warnings],
  };
}

function hasActivityPosition(point: TrackPoint): boolean {
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    typeof point.lon === "number" &&
    Number.isFinite(point.lon)
  );
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
  thresholdM: number
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
  anchorIndex: number
) {
  const anchor = points[anchorIndex];
  if (!hasActivityPosition(anchor)) {
    return;
  }

  for (let position = startPosition; position <= endPosition; position += 1) {
    const point = points[positionedIndices[position]];
    if (point && hasActivityPosition(point)) {
      point.lat = anchor.lat;
      point.lon = anchor.lon;
    }
  }
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

async function updateActivityDownloads(
  elements: DemoElements,
  baseName: string,
  result: ConversionResult
): Promise<string> {
  revokeCurrentDownloadUrls();

  const rawBlob = new Blob([result.trackJson], {
    type: "application/json",
  });
  const rawUrl = URL.createObjectURL(rawBlob);
  currentTrackJsonUrl = rawUrl;

  elements.downloadLink.href = rawUrl;
  elements.downloadLink.download = makeTrackJsonFileName(baseName, ".trj");
  elements.downloadLink.hidden = false;

  elements.compressedDownloadLink.removeAttribute("href");
  elements.compressedDownloadLink.hidden = true;

  const compressedBlob = await gzipText(result.trackJson);
  if (compressedBlob) {
    const compressedUrl = URL.createObjectURL(compressedBlob);
    currentCompressedTrackJsonUrl = compressedUrl;

    elements.compressedDownloadLink.href = compressedUrl;
    elements.compressedDownloadLink.download = makeTrackJsonFileName(baseName, ".trjgz");
    elements.compressedDownloadLink.hidden = false;
  }

  const exportActivity = result.renderedActivity ?? result.activity;
  if (exportActivity) {
    const gpx = trackActivityToGpx(exportActivity, {
      name: result.title,
      description: `Converted from ${formatSourceType(result.sourceType)}`,
    });
    const gpxUrl = URL.createObjectURL(new Blob([gpx], {
      type: "application/gpx+xml",
    }));
    currentGpxUrl = gpxUrl;
    elements.gpxDownloadLink.href = gpxUrl;
    elements.gpxDownloadLink.download = makeTrackJsonFileName(baseName, ".gpx");
    elements.gpxDownloadLink.hidden = false;

    const fitBytes = trackActivityToFit(exportActivity);
    const fitUrl = URL.createObjectURL(new Blob([copyUint8ArrayToArrayBuffer(fitBytes)], {
      type: "application/octet-stream",
    }));
    currentFitUrl = fitUrl;
    elements.fitDownloadLink.href = fitUrl;
    elements.fitDownloadLink.download = makeTrackJsonFileName(baseName, ".fit");
    elements.fitDownloadLink.hidden = false;
  } else {
    elements.gpxDownloadLink.removeAttribute("href");
    elements.gpxDownloadLink.hidden = true;
    elements.fitDownloadLink.removeAttribute("href");
    elements.fitDownloadLink.hidden = true;
  }

  return rawUrl;
}

function copyUint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
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

  if (result.trimApplied) {
    lines.push(
      `trim: start ${formatNumber(result.trimStartSeconds || 0, 0)} s, ` +
      `end ${formatNumber(result.trimEndSeconds || 0, 0)} s`
    );
    if (typeof result.trimmedPointCount === "number") {
      lines.push(`trimmed points: ${result.trimmedPointCount}`);
    }
  }

  appendBboxSummaryLine(lines, result.trackJsonData);
  appendPoiSummaryLines(lines, result.trackJsonData);

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

    appendMetadataSummaryLines(lines, result, metadata);
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

function appendPoiSummaryLines(lines: string[], data: unknown) {
  getTrackJsonPoi(data).forEach((point) => {
    lines.push(
      `poi ${point.role}: lon ${formatNumber(point.coordinates[0], 5)}, ` +
      `lat ${formatNumber(point.coordinates[1], 5)}`,
    );
  });
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
  result: ConversionResult,
  metadata: Record<string, unknown>
) {
  const activity = result.renderedActivity || result.activity;
  const input = activity || { metadata };
  getActivityMetadataSummaryLines(input).forEach((line) => {
    lines.push(line.text);
  });
}

type ZoneHistogramRow = TrackAnalysisDisplayRow;
type PowerCurvePoint = TrackPowerCurvePoint;
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
  let heartRateBracketHistogramAppended = false;
  let powerBracketHistogramAppended = false;
  if (points.length > 0) {
    appendMetadataSpeedHistogram(container, metadata);
    appendMetadataCadenceHistogram(container, metadata);

    const lthrBpm = getPositiveNumber(elements.lthrInput);
    if (typeof lthrBpm === "number") {
      appendHeartRateHistogram(container, points, lthrBpm);
      appendMetadataHeartRateHistogram(container, metadata);
      heartRateBracketHistogramAppended = true;
    }

    const ftpW = getPositiveNumber(elements.ftpInput);
    if (typeof ftpW === "number") {
      appendPowerHistogram(container, points, ftpW);
      appendMetadataPowerHistogram(container, metadata);
      powerBracketHistogramAppended = true;
    }
  }

  if (points.length === 0) {
    appendMetadataSpeedHistogram(container, metadata);
    appendMetadataCadenceHistogram(container, metadata);
  }
  if (!heartRateBracketHistogramAppended) {
    appendMetadataHeartRateHistogram(container, metadata);
  }
  if (!powerBracketHistogramAppended) {
    appendMetadataPowerHistogram(container, metadata);
  }
  appendPowerCurve(container, metadata);
  appendSmoothedScatterPlots(container, points);
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
    getHeartRateZoneDisplayRows(summary, lthrBpm)
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
    getPowerZoneDisplayRows(summary, ftpW)
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

function appendMetadataSpeedHistogram(
  container: HTMLElement,
  metadata: Record<string, unknown> | undefined
) {
  appendMetadataHistogram(container, metadata, "speedKph");
}

function appendMetadataCadenceHistogram(
  container: HTMLElement,
  metadata: Record<string, unknown> | undefined
) {
  appendMetadataHistogram(container, metadata, "cadenceRpm");
}

function appendMetadataPowerHistogram(
  container: HTMLElement,
  metadata: Record<string, unknown> | undefined
) {
  appendMetadataHistogram(container, metadata, "powerW");
}

function appendMetadataHeartRateHistogram(
  container: HTMLElement,
  metadata: Record<string, unknown> | undefined
) {
  appendMetadataHistogram(container, metadata, "heartRateBpm");
}

function appendMetadataHistogram(
  container: HTMLElement,
  metadata: Record<string, unknown> | undefined,
  key: "speedKph" | "cadenceRpm" | "heartRateBpm" | "powerW"
) {
  const display = getActivityHistogramDisplay(metadata, key);
  if (!display) {
    return;
  }

  appendHistogramSection(container, display.title, display.rows);
}
function appendPowerCurve(
  container: HTMLElement,
  metadata: Record<string, unknown> | undefined
) {
  const points = getActivityPowerCurvePoints(metadata);
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

function appendSmoothedScatterPlots(
  container: HTMLElement,
  points: TrackPoint[]
) {
  const smoothed = buildSmoothedScatterSamples(points, {
    windowSeconds: 30,
    maxPoints: 1000,
  });
  const availableMetrics = getAvailableScatterMetrics(
    smoothed,
    TRACK_SCATTER_METRICS
  );
  if (availableMetrics.length === 0) {
    return;
  }

  const section = document.createElement("section");
  section.className = "fit-demo-power-curve fit-demo-scatter-plot";

  const title = document.createElement("div");
  title.className = "fit-demo-zone-title";
  title.textContent = "Scatter plot";
  section.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "fit-demo-scatter-controls";

  const xSelect = createScatterMetricSelect(availableMetrics);
  const ySelect = createScatterMetricSelect(availableMetrics);
  const defaultPair = getDefaultScatterPair(availableMetrics);
  xSelect.value = defaultPair.x.key;
  ySelect.value = defaultPair.y.key;

  const xLabel = document.createElement("label");
  xLabel.textContent = "X ";
  xLabel.appendChild(xSelect);

  const yLabel = document.createElement("label");
  yLabel.textContent = "Y ";
  yLabel.appendChild(ySelect);

  const trimInput = document.createElement("input");
  trimInput.type = "checkbox";

  const trimLabel = document.createElement("label");
  trimLabel.appendChild(trimInput);
  trimLabel.appendChild(document.createTextNode(" Trim outliers (2–98%)"));

  controls.appendChild(xLabel);
  controls.appendChild(yLabel);
  controls.appendChild(trimLabel);
  section.appendChild(controls);

  const plotContainer = document.createElement("div");
  plotContainer.className = "fit-demo-scatter-plot-output";
  section.appendChild(plotContainer);

  const redraw = () => {
    const xMetric = findScatterMetric(availableMetrics, xSelect.value);
    const yMetric = findScatterMetric(availableMetrics, ySelect.value);
    plotContainer.replaceChildren();
    if (!xMetric || !yMetric) {
      return;
    }

    const scatterPoints = buildScatterPlotPoints(
      smoothed,
      xMetric.key,
      yMetric.key,
      1000
    );
    if (scatterPoints.length === 0) {
      const message = document.createElement("div");
      message.textContent = "No matching points for this metric pair.";
      plotContainer.appendChild(message);
      return;
    }

    plotContainer.appendChild(
      buildScatterPlotSvg(scatterPoints, {
        xLabel: xMetric.axisLabel,
        yLabel: yMetric.axisLabel,
        pointColor: "#0078A8",
        trimPercentile: trimInput.checked,
      })
    );
  };

  xSelect.addEventListener("change", redraw);
  ySelect.addEventListener("change", redraw);
  trimInput.addEventListener("change", redraw);
  redraw();

  container.appendChild(section);
}

function createScatterMetricSelect(
  metrics: TrackScatterMetricDefinition[]
): HTMLSelectElement {
  const select = document.createElement("select");
  metrics.forEach((metric) => {
    const option = document.createElement("option");
    option.value = metric.key;
    option.textContent = metric.label;
    select.appendChild(option);
  });
  return select;
}

function getDefaultScatterPair(metrics: TrackScatterMetricDefinition[]): {
  x: TrackScatterMetricDefinition;
  y: TrackScatterMetricDefinition;
} {
  const cadence = findScatterMetric(metrics, "cadenceRpm");
  const speed = findScatterMetric(metrics, "speedKph");
  if (cadence && speed) {
    return { x: cadence, y: speed };
  }
  return { x: metrics[0], y: metrics[1] || metrics[0] };
}

function findScatterMetric(
  metrics: TrackScatterMetricDefinition[],
  key: string
): TrackScatterMetricDefinition | undefined {
  return metrics.find((metric) => metric.key === key);
}

function buildScatterPlotSvg(
  points: TrackScatterPoint[],
  options: {
    xLabel: string;
    yLabel: string;
    pointColor: string;
    trimPercentile: boolean;
  }
): SVGSVGElement {
  const width = 760;
  const height = 300;
  const marginTop = 16;
  const marginRight = 20;
  const marginBottom = 46;
  const marginLeft = 56;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;
  const xRange = getScatterAxisRange(
    points.map((point) => point.x),
    options.trimPercentile
  );
  const yRange = getScatterAxisRange(
    points.map((point) => point.y),
    options.trimPercentile
  );
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "fit-demo-power-curve-svg fit-demo-scatter-plot-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${options.yLabel} versus ${options.xLabel} scatter plot`
  );

  const xValue = (value: number) => {
    const ratio = (value - xRange.min) / (xRange.max - xRange.min);
    return marginLeft + ratio * plotWidth;
  };
  const yValue = (value: number) => {
    const ratio = (value - yRange.min) / (yRange.max - yRange.min);
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

  createRangeTicks(
    xRange.min,
    xRange.max,
    SCATTER_AXIS_TICK_TARGET
  ).forEach((tick) => {
    const x = xValue(tick);
    appendSvgLine(svg, x, marginTop, x, marginTop + plotHeight, "#e5e5e5");
    appendSvgText(
      svg,
      x,
      marginTop + plotHeight + 20,
      formatScatterTick(tick, xRange.max - xRange.min),
      "middle",
      "11px"
    );
  });

  createRangeTicks(
    yRange.min,
    yRange.max,
    SCATTER_AXIS_TICK_TARGET
  ).forEach((tick) => {
    const y = yValue(tick);
    appendSvgLine(svg, marginLeft, y, marginLeft + plotWidth, y, "#e5e5e5");
    appendSvgText(
      svg,
      marginLeft - 8,
      y + 4,
      formatScatterTick(tick, yRange.max - yRange.min),
      "end",
      "11px"
    );
  });

  points.forEach((point) => {
    if (
      point.x < xRange.min ||
      point.x > xRange.max ||
      point.y < yRange.min ||
      point.y > yRange.max
    ) {
      return;
    }
    const circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", String(xValue(point.x)));
    circle.setAttribute("cy", String(yValue(point.y)));
    circle.setAttribute("r", "2.2");
    circle.setAttribute("fill", options.pointColor);
    circle.setAttribute("fill-opacity", "0.45");
    circle.setAttribute(
      "aria-label",
      `${options.xLabel} ${formatNumber(point.x, 1)}, ${options.yLabel} ${formatNumber(point.y, 1)}`
    );
    svg.appendChild(circle);
  });

  appendSvgText(
    svg,
    marginLeft + plotWidth / 2,
    height - 8,
    options.xLabel,
    "middle",
    "11px"
  );
  appendSvgText(svg, marginLeft, marginTop - 4, options.yLabel, "start", "11px");

  return svg;
}

function formatScatterTick(value: number, range: number): string {
  return formatNumber(value, range < 10 ? 1 : 0);
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

function clampPercentage(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(1, value));
}

function clearOutput(elements: DemoElements) {
  revokeCurrentDownloadUrls();

  elements.mapOutput.textContent = "";
  elements.trackJsonOutput.value = "";
  elements.copyButton.disabled = true;

  elements.downloadLink.removeAttribute("href");
  elements.downloadLink.hidden = true;

  elements.compressedDownloadLink.removeAttribute("href");
  elements.compressedDownloadLink.hidden = true;

  elements.gpxDownloadLink.removeAttribute("href");
  elements.gpxDownloadLink.hidden = true;

  elements.fitDownloadLink.removeAttribute("href");
  elements.fitDownloadLink.hidden = true;

  elements.summaryOutput.textContent = "";
  elements.summaryOutput.hidden = true;
}

function revokeCurrentDownloadUrls() {
  if (currentTrackJsonUrl) {
    URL.revokeObjectURL(currentTrackJsonUrl);
    currentTrackJsonUrl = undefined;
  }

  if (currentCompressedTrackJsonUrl) {
    URL.revokeObjectURL(currentCompressedTrackJsonUrl);
    currentCompressedTrackJsonUrl = undefined;
  }

  if (currentGpxUrl) {
    URL.revokeObjectURL(currentGpxUrl);
    currentGpxUrl = undefined;
  }

  if (currentFitUrl) {
    URL.revokeObjectURL(currentFitUrl);
    currentFitUrl = undefined;
  }
}

function syncDownsampleControls(elements: DemoElements) {
  const enabled = elements.downsampleInput.checked;
  elements.downsampleStrategySelect.disabled = !enabled;
  elements.maxPointsInput.disabled = !enabled;
  elements.preserveEndpointsInput.disabled = !enabled;
}

function syncTrimControls(elements: DemoElements) {
  const enabled = elements.trimActivityInput.checked;
  elements.trimStartSecondsInput.disabled = !enabled;
  elements.trimEndSecondsInput.disabled = !enabled;
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

function isTrimActivityEnabled(elements: DemoElements): boolean {
  return elements.trimActivityInput.checked;
}

function getTrimActivityOptions(elements: DemoElements) {
  return {
    trimStartSeconds: getNonNegativeSeconds(elements.trimStartSecondsInput),
    trimEndSeconds: getNonNegativeSeconds(elements.trimEndSecondsInput),
  };
}

function getPrivacyObfuscationOptions(elements: DemoElements) {
  return {
    startDistanceM: getNonNegativeDistance(elements.obfuscateStartDistanceInput),
    endDistanceM: getNonNegativeDistance(elements.obfuscateEndDistanceInput),
  };
}

function getNonNegativeDistance(input: HTMLInputElement): number {
  return getNonNegativeInteger(input);
}

function getNonNegativeSeconds(input: HTMLInputElement): number {
  return getNonNegativeInteger(input);
}

function getNonNegativeInteger(input: HTMLInputElement): number {
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
  elements.downsampleInput.disabled = busy;
  elements.trimActivityInput.disabled = busy;
  elements.obfuscatePrivacyInput.disabled = busy;

  if (busy) {
    elements.downsampleStrategySelect.disabled = true;
    elements.maxPointsInput.disabled = true;
    elements.preserveEndpointsInput.disabled = true;
    elements.trimStartSecondsInput.disabled = true;
    elements.trimEndSecondsInput.disabled = true;
    elements.obfuscateStartDistanceInput.disabled = true;
    elements.obfuscateEndDistanceInput.disabled = true;
    return;
  }

  syncDownsampleControls(elements);
  syncTrimControls(elements);
  syncPrivacyControls(elements);
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
  const gpxDownloadLink = getOrCreateSiblingDownloadLink(
    root,
    compressedDownloadLink,
    "fit-demo-download-gpx",
    "Download GPX",
    "track.gpx"
  );
  const fitDownloadLink = getOrCreateSiblingDownloadLink(
    root,
    gpxDownloadLink,
    "fit-demo-download-fit",
    "Download FIT",
    "track.fit"
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
    trimActivityInput: getElement<HTMLInputElement>(
      root,
      "fit-demo-trim-activity"
    ),
    trimStartSecondsInput: getElement<HTMLInputElement>(
      root,
      "fit-demo-trim-start-seconds"
    ),
    trimEndSecondsInput: getElement<HTMLInputElement>(
      root,
      "fit-demo-trim-end-seconds"
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
    gpxDownloadLink,
    fitDownloadLink,
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

function getOrCreateSiblingDownloadLink(
  root: Document | HTMLElement,
  afterLink: HTMLAnchorElement,
  id: string,
  label: string,
  downloadName: string
): HTMLAnchorElement {
  const existing = root.querySelector<HTMLAnchorElement>(`#${id}`);
  if (existing) {
    return existing;
  }

  const link = document.createElement("a");
  link.id = id;
  link.href = "#";
  link.download = downloadName;
  link.hidden = true;
  link.textContent = label;

  afterLink.insertAdjacentText("afterend", " ");
  afterLink.insertAdjacentElement("afterend", link);

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

function makeTrackJsonFileName(
  baseName: string,
  extension: ".trj" | ".trjgz" | ".gpx" | ".fit",
): string {
  return `${stripExtension(baseName) || "track"}${extension}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]*$/, "");
}

function formatSourceType(sourceType: ConversionResult["sourceType"]): string {
  if (sourceType === "fit") {
    return "FIT";
  }

  if (sourceType === "gpx") {
    return "GPX";
  }

  if (sourceType === "trjgz") {
    return "TrackJSON gzip";
  }

  if (sourceType === "merged") {
    return "Merged";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits);
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
