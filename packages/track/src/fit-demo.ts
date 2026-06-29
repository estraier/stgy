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

declare global {
  interface Window {
    StgyTrackViewer?: StgyTrackViewerGlobal;
  }
}

type DemoElements = {
  fileInput: HTMLInputElement;
  titleInput: HTMLInputElement;
  downsampleInput: HTMLInputElement;
  maxPointsInput: HTMLInputElement;
  preserveEndpointsInput: HTMLInputElement;
  prettyInput: HTMLInputElement;
  convertButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  downloadLink: HTMLAnchorElement;
  status: HTMLElement;
  summary: HTMLElement;
  mapOutput: HTMLElement;
  trackJsonOutput: HTMLTextAreaElement;
};

let currentTrackJsonUrl: string | undefined;

export function initFitDemo(root: ParentNode = document) {
  const elements = getDemoElements(root);
  const renderer = createRenderer(elements);

  syncDownsampleControls(elements);

  elements.downsampleInput.addEventListener("change", () => {
    syncDownsampleControls(elements);
  });

  elements.convertButton.addEventListener("click", () => {
    void convertAndRender(elements, renderer);
  });

  elements.copyButton.addEventListener("click", () => {
    void copyTrackJson(elements);
  });
}

async function convertAndRender(elements: DemoElements, renderer: TrackRenderer) {
  const file = elements.fileInput.files?.[0];
  if (!file) {
    setStatus(elements, "Select a FIT file first.", true);
    return;
  }

  setBusy(elements, true);
  setStatus(elements, "Converting FIT file...", false);
  clearOutput(elements);

  try {
    const bytes = await file.arrayBuffer();
    const activity = parseFitBytes(bytes);
    const digest = maybeDownsample(activity, elements);
    const title = getRouteTitle(elements, file);
    const trackJson = trackActivityToTrackJson(digest, {
      title,
      description: `Converted from ${file.name}`,
      pretty: elements.prettyInput.checked,
    });

    const trackJsonUrl = updateTrackJsonDownload(elements, file, trackJson);

    elements.trackJsonOutput.value = trackJson;
    elements.copyButton.disabled = false;
    renderTrackJson(elements, renderer, trackJsonUrl, title);
    showSummary(elements, activity, digest, file);
    setStatus(elements, "Converted and rendered successfully.", false);
  } catch (e) {
    setStatus(elements, getErrorMessage(e), true);
  } finally {
    setBusy(elements, false);
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

function updateTrackJsonDownload(
  elements: DemoElements,
  file: File,
  trackJson: string
): string {
  if (currentTrackJsonUrl) {
    URL.revokeObjectURL(currentTrackJsonUrl);
  }

  const blob = new Blob([trackJson], {
    type: "application/json",
  });

  currentTrackJsonUrl = URL.createObjectURL(blob);
  elements.downloadLink.href = currentTrackJsonUrl;
  elements.downloadLink.download = makeTrackJsonFileName(file.name);
  elements.downloadLink.hidden = false;

  return currentTrackJsonUrl;
}

async function copyTrackJson(elements: DemoElements) {
  const text = elements.trackJsonOutput.value;
  if (!text) {
    setStatus(elements, "There is no TrackJSON to copy.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus(elements, "Copied TrackJSON to clipboard.", false);
  } catch {
    elements.trackJsonOutput.focus();
    elements.trackJsonOutput.select();
    setStatus(elements, "Clipboard API failed. TrackJSON was selected.", true);
  }
}

function showSummary(
  elements: DemoElements,
  activity: TrackActivity,
  digest: TrackActivity,
  file: File
) {
  const lines = [
    `File: ${file.name}`,
    `Original points: ${activity.points.length}`,
    `Original positioned points: ${countPositionedPoints(activity)}`,
    `Rendered points: ${digest.points.length}`,
    `Rendered positioned points: ${countPositionedPoints(digest)}`,
  ];

  if (activity.metadata.sport) {
    lines.push(`Sport: ${activity.metadata.sport}`);
  }

  if (activity.metadata.subSport) {
    lines.push(`Sub sport: ${activity.metadata.subSport}`);
  }

  if (typeof activity.metadata.totalDistanceM === "number") {
    lines.push(`Total distance: ${formatDistance(activity.metadata.totalDistanceM)}`);
  }

  if (typeof activity.metadata.totalTimerTime === "number") {
    lines.push(`Timer time: ${formatDuration(activity.metadata.totalTimerTime)}`);
  }

  if (activity.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    activity.warnings.forEach((warning) => {
      lines.push(`- ${warning.code}: ${warning.message}`);
    });
  }

  elements.summary.textContent = lines.join("\n");
  elements.summary.hidden = false;
}

function clearOutput(elements: DemoElements) {
  elements.mapOutput.textContent = "";
  elements.trackJsonOutput.value = "";
  elements.copyButton.disabled = true;
  elements.downloadLink.hidden = true;
  elements.summary.hidden = true;
  elements.summary.textContent = "";

  if (currentTrackJsonUrl) {
    URL.revokeObjectURL(currentTrackJsonUrl);
    currentTrackJsonUrl = undefined;
  }
}

function syncDownsampleControls(elements: DemoElements) {
  const enabled = elements.downsampleInput.checked;
  elements.maxPointsInput.disabled = !enabled;
  elements.preserveEndpointsInput.disabled = !enabled;
}

function setBusy(elements: DemoElements, busy: boolean) {
  elements.convertButton.disabled = busy;
  elements.fileInput.disabled = busy;
  elements.titleInput.disabled = busy;
  elements.downsampleInput.disabled = busy;
  elements.maxPointsInput.disabled = busy || !elements.downsampleInput.checked;
  elements.preserveEndpointsInput.disabled = busy || !elements.downsampleInput.checked;
  elements.prettyInput.disabled = busy;
}

function setStatus(elements: DemoElements, message: string, isError: boolean) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
}

function getDemoElements(root: ParentNode): DemoElements {
  return {
    fileInput: getElement<HTMLInputElement>(root, "#fit-demo-file"),
    titleInput: getElement<HTMLInputElement>(root, "#fit-demo-title"),
    downsampleInput: getElement<HTMLInputElement>(root, "#fit-demo-downsample"),
    maxPointsInput: getElement<HTMLInputElement>(root, "#fit-demo-max-points"),
    preserveEndpointsInput: getElement<HTMLInputElement>(
      root,
      "#fit-demo-preserve-endpoints"
    ),
    prettyInput: getElement<HTMLInputElement>(root, "#fit-demo-pretty"),
    convertButton: getElement<HTMLButtonElement>(root, "#fit-demo-convert"),
    copyButton: getElement<HTMLButtonElement>(root, "#fit-demo-copy"),
    downloadLink: getElement<HTMLAnchorElement>(root, "#fit-demo-download"),
    status: getElement<HTMLElement>(root, "#fit-demo-status"),
    summary: getElement<HTMLElement>(root, "#fit-demo-summary"),
    mapOutput: getElement<HTMLElement>(root, "#fit-demo-map-output"),
    trackJsonOutput: getElement<HTMLTextAreaElement>(root, "#fit-demo-track-json"),
  };
}

function getElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element as T;
}

function createRenderer(elements: DemoElements): TrackRenderer {
  const viewer = window.StgyTrackViewer;
  if (!viewer) {
    setStatus(elements, "StgyTrackViewer is not loaded.", true);
    throw new Error("StgyTrackViewer is not loaded.");
  }

  return new viewer.StgyTrackRenderer();
}

function getMaxPoints(elements: DemoElements): number {
  const value = Number(elements.maxPointsInput.value);
  if (!Number.isFinite(value) || value < 2) {
    throw new Error("Max points must be greater than or equal to 2.");
  }

  return Math.floor(value);
}

function getRouteTitle(elements: DemoElements, file: File): string {
  const title = elements.titleInput.value.trim();
  return title || stripExtension(file.name) || "FIT route";
}

function makeTrackJsonFileName(fileName: string): string {
  const baseName = stripExtension(fileName) || "track";
  return `${baseName}.track.json`;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]*$/, "");
}

function countPositionedPoints(activity: TrackActivity): number {
  return activity.points.filter((point) => {
    return Number.isFinite(point.lat) && Number.isFinite(point.lon);
  }).length;
}

function formatDistance(distanceM: number): string {
  if (distanceM >= 1000) {
    return `${(distanceM / 1000).toFixed(2)} km`;
  }

  return `${Math.round(distanceM)} m`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }

  return `${secs}s`;
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
