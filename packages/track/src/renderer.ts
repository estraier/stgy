import L from "leaflet";
import { isJapan } from "./geo";
import { TrackLoader } from "./loader";
import { getTrackJsonDisplayMetadataLines } from "./metadata";
import { getFiniteNumberRange } from "./numeric";
import { getTrackJsonTitle } from "./trackjson";
import {
  getHistogramBarScaleMaxPercentage,
  type TrackPowerCurvePoint,
} from "./analysis";
import {
  getTrackJsonAnalysis,
  type TrackJsonAnalysisDisplay,
} from "./trackjson-analysis";

const DEFAULT_PIN_COLOR = "#3388ff";
const DEFAULT_ROUTE_COLOR = "#0078A8";
const DEFAULT_PIN_SCALE = 0.85;
const TEN_PIN_SCALE = 0.75;
const THIRTY_PIN_SCALE = 0.65;
const PIN_ICON_WIDTH = 25;
const PIN_ICON_HEIGHT = 41;
const PIN_ICON_ANCHOR_X = 12;
const PIN_POPUP_ANCHOR_X = 1;
const PIN_POPUP_ANCHOR_Y = -34;
const PIN_TOOLTIP_ANCHOR_X = 16;
const PIN_TOOLTIP_ANCHOR_Y = -28;
const PIN_SHADOW_SIZE = 41;
const DEFAULT_DOWNLOAD_LABEL = "Download original data";
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_MAP_COLORS = new Set([
  "red",
  "green",
  "blue",
  "orange",
  "purple",
  "gold",
  "black",
  "white",
  "gray",
  "grey",
]);

export const STGY_TRACK_DATA_LOADED_EVENT = "stgy-track-data-loaded";

const formatHemisphereCoordinate = (
  value: number,
  positiveHemisphere: "E" | "N",
  negativeHemisphere: "W" | "S",
) => `${Math.abs(value).toFixed(5)}${value < 0 ? negativeHemisphere : positiveHemisphere}`;

const formatCoordinatePopupText = (latitude: number, longitude: number) =>
  `${formatHemisphereCoordinate(latitude, "N", "S")}, ${formatHemisphereCoordinate(longitude, "E", "W")}`;

const formatMapCoordinateCopyText = (latitude: number, longitude: number) =>
  `${longitude.toFixed(5)},${latitude.toFixed(5)}`;

const COORDINATE_COPY_FEEDBACK_DURATION_MS = 1000;

const copyTextToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const createCoordinateCopyButton = (text: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "stgy-track-coordinate-copy";
  button.setAttribute("aria-label", "Copy map coordinates");
  button.title = "Copy map coordinates";

  const svgNs = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNs, "svg");
  icon.classList.add("stgy-track-coordinate-copy-icon");
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", "M7 7h9v9H7zM4 4h9v3M4 4v9h3");
  icon.appendChild(path);
  button.appendChild(icon);

  const feedback = document.createElement("span");
  feedback.className = "stgy-track-coordinate-copy-feedback";
  feedback.textContent = "Copied";
  feedback.hidden = true;
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  button.appendChild(feedback);

  let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  button.addEventListener("click", () => {
    void copyTextToClipboard(text)
      .then(() => {
        feedback.hidden = false;
        if (feedbackTimeout !== null) {
          clearTimeout(feedbackTimeout);
        }
        feedbackTimeout = setTimeout(() => {
          feedback.hidden = true;
          feedbackTimeout = null;
        }, COORDINATE_COPY_FEEDBACK_DURATION_MS);
      })
      .catch(() => undefined);
  });

  return button;
};

const DEFAULT_SINGLE_POINT_ZOOM = 12;
const ROUTE_VIEW_PADDING_RATIO = 0.04;
const PIN_VIEW_PADDING_RATIO = 0.08;
const FALLBACK_MAX_AUTO_ZOOM = 20;
const TRACK_GRAPH_SMOOTHING_WINDOWS = [
  1,
  3,
  5,
  7,
  11,
  15,
  31,
  61,
  121,
  241,
  481,
  961,
] as const;
const TARGET_GRAPH_X_TICKS = 5;
const TARGET_GRAPH_Y_TICKS = 5;
const TRACK_GRAPH_VIEWBOX_WIDTH = 800;
const TRACK_GRAPH_VIEWBOX_HEIGHT = 180;
const TRACK_GRAPH_SERIES_ORDER = [
  "altitudes",
  "speeds",
  "cadences",
  "heartRates",
  "powers",
  "torqueEffectivenessPercentage",
  "pedalSmoothnessPercentage",
] as const;
const TRACK_GRAPH_SERIES_ORDER_SET = new Set<string>(TRACK_GRAPH_SERIES_ORDER);
const TRACK_GRAPH_SERIES_LABELS: Record<string, string> = {
  altitudes: "Altitude",
  speeds: "Speed",
  cadences: "Cadence",
  heartRates: "Heart rate",
  powers: "Power",
  torqueEffectivenessPercentage: "Torque efficiency",
  pedalSmoothnessPercentage: "Pedal smoothness",
};
const TRACK_GRAPH_X_AXIS_LABELS: Record<TrackGraphXAxisKind, string> = {
  distance: "Distance",
  time: "Time",
  sample: "Sample",
};

type BaseLayerKey =
  | "gsi-pale"
  | "gsi-standard"
  | "gsi-photo"
  | "cyclosm"
  | "openstreetmap"
  | "opentopomap";

type BaseLayerDefinition = {
  key: BaseLayerKey;
  label: string;
  layer: L.TileLayer;
  japanOnly?: boolean;
};

const BASE_LAYER_ALIASES: Record<string, BaseLayerKey> = {
  "gsi-pale": "gsi-pale",
  pale: "gsi-pale",
  "gsi-standard": "gsi-standard",
  "gsi-std": "gsi-standard",
  standard: "gsi-standard",
  std: "gsi-standard",
  "gsi-photo": "gsi-photo",
  "gsi-seamlessphoto": "gsi-photo",
  "seamless-photo": "gsi-photo",
  seamlessphoto: "gsi-photo",
  photo: "gsi-photo",
  cyclosm: "cyclosm",
  cycle: "cyclosm",
  openstreetmap: "openstreetmap",
  "open-street-map": "openstreetmap",
  osm: "openstreetmap",
  opentopomap: "opentopomap",
  "open-topo-map": "opentopomap",
  opentopo: "opentopomap",
  topo: "opentopomap",
};

type BoundsAccumulator = {
  hasValue: boolean;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

type AutoViewBounds = {
  bounds: L.LatLngBounds;
  paddingRatio: number;
};

type AutoMapView = {
  center: L.LatLng;
  zoom: number;
};

type PreloadedTrackData = {
  source: string;
  data: unknown;
};

type TrackAnalysisOverlaySection = {
  title?: string;
  displays: TrackJsonAnalysisDisplay[];
  powerCurve: TrackPowerCurvePoint[];
};

type JsonRecord = Record<string, unknown>;

export type TrackImageUrlRewriter = (src: string) => string | null;

export type StgyTrackRendererOptions = {
  allowedImagePatterns?: RegExp[];
  rewriteImageUrl?: TrackImageUrlRewriter;
};
type CoordinateProperties = JsonRecord;
type GeoJsonInput = Parameters<typeof L.geoJSON>[0];
type GeoJsonFeatureLike = {
  geometry?: unknown;
  properties?: unknown;
};

type CoordinateMarkerState = {
  marker: L.CircleMarker | null;
};

type TrackGraphXAxisKind = "distance" | "time" | "sample";
type TrackGraphSmoothingWindow = typeof TRACK_GRAPH_SMOOTHING_WINDOWS[number];

type TrackGraphSeries = {
  name: string;
  values: number[];
};

type TrackGraphDataset = {
  xAxes: Partial<Record<TrackGraphXAxisKind, number[]>>;
  defaultXAxis: TrackGraphXAxisKind;
  series: TrackGraphSeries[];
  latLngs: L.LatLngExpression[];
  coordinateProperties: CoordinateProperties;
};

type SelectedCoordinateSample = {
  latLng: L.LatLngExpression;
  coordinateProperties: CoordinateProperties;
  index: number;
};

type GraphHoverState = {
  dataset: TrackGraphDataset;
  selectedXAxis: TrackGraphXAxisKind;
  series: TrackGraphSeries;
  xValues: number[];
  displayValues: number[];
  scaledXValues: number[];
  yScale: (value: number) => number;
  hoverLine: SVGLineElement;
  hoverPoint: SVGCircleElement;
  readout: HTMLElement;
};

type CoordinateInteractionContext = {
  map: L.Map;
  hud: HTMLElement | null;
  markerState: CoordinateMarkerState;
  graphPanel: HTMLElement | null;
  graphRestoreButton: HTMLButtonElement | null;
  graphCollapsed: boolean;
  graphHoverState: GraphHoverState | null;
  routeDatasetByLayer: WeakMap<L.Layer, TrackGraphDataset>;
  routeStyleByLayer: WeakMap<L.Layer, L.PathOptions>;
  activeGraphDataset: TrackGraphDataset | null;
  activeGraphLayer: L.Layer | null;
  pinnedSample: SelectedCoordinateSample | null;
  ignoreNextMapClick: boolean;
};

type StyleableLayer = L.Layer & {
  setStyle?: (style: L.PathOptions) => unknown;
  bringToFront?: () => unknown;
};

type LeafletMapWithRemovalTimers = L.Map & {
  _transitionEndTimer?: ReturnType<typeof setTimeout>;
  _sizeTimer?: ReturnType<typeof setTimeout>;
};

const trackMapsByCanvas = new WeakMap<HTMLElement, L.Map>();

const getPinScale = (pinCount: number): number => {
  if (pinCount >= 30) {
    return THIRTY_PIN_SCALE;
  }
  if (pinCount >= 10) {
    return TEN_PIN_SCALE;
  }
  return DEFAULT_PIN_SCALE;
};

const createDefaultPinIcon = (scale: number) => {
  const iconUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
  const iconRetinaUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png";
  const shadowUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

  return L.icon({
    iconUrl,
    iconRetinaUrl,
    shadowUrl,
    iconSize: [PIN_ICON_WIDTH * scale, PIN_ICON_HEIGHT * scale],
    iconAnchor: [PIN_ICON_ANCHOR_X * scale, PIN_ICON_HEIGHT * scale],
    popupAnchor: [PIN_POPUP_ANCHOR_X * scale, PIN_POPUP_ANCHOR_Y * scale],
    tooltipAnchor: [PIN_TOOLTIP_ANCHOR_X * scale, PIN_TOOLTIP_ANCHOR_Y * scale],
    shadowSize: [PIN_SHADOW_SIZE * scale, PIN_SHADOW_SIZE * scale],
  });
};

const fixLeafletIcons = () => {
  delete (L.Marker.prototype as unknown as Record<string, unknown>)._getIconUrl;
  L.Marker.prototype.options.icon = createDefaultPinIcon(DEFAULT_PIN_SCALE);
};

const isRecord = (value: unknown): value is JsonRecord => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const asGeoJsonInput = (value: unknown): GeoJsonInput => {
  return value as GeoJsonInput;
};

const getFeatureProperties = (feature: GeoJsonFeatureLike | null | undefined): JsonRecord => {
  return isRecord(feature?.properties) ? feature.properties : {};
};

const getFiniteNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const parsePositiveDatasetNumber = (
  value: string | undefined,
): number | undefined => {
  if (!value) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const normalizeMapColor = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const color = value.trim();

  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return color;
  }

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color;
  }

  const lowerColor = color.toLowerCase();
  if (ALLOWED_MAP_COLORS.has(lowerColor)) {
    return lowerColor;
  }

  return null;
};

const createCustomPinIcon = (color: string, scale: number) => {
  const safeColor = normalizeMapColor(color) || DEFAULT_PIN_COLOR;
  const width = PIN_ICON_WIDTH * scale;
  const height = PIN_ICON_HEIGHT * scale;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="${width}px" height="${height}px" style="filter: drop-shadow(2px 4px 2px rgba(0,0,0,0.3));">
      <path fill="${safeColor}" stroke="#ffffff" stroke-width="1.5" d="M12 0C5.373 0 0 5.373 0 12c0 8.442 11.373 23.36 11.706 23.784.144.184.364.288.594.288.23 0 .45-.104.594-.288C13.227 35.36 24 20.442 24 12 24 5.373 18.627 0 12 0zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/>
    </svg>`;

  return L.divIcon({
    className: "stgy-custom-pin",
    html: svg,
    iconSize: [width, height],
    iconAnchor: [PIN_ICON_ANCHOR_X * scale, height],
    popupAnchor: [0, PIN_POPUP_ANCHOR_Y * scale],
  });
};

const isGeoJsonPosition = (value: unknown): boolean => {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
};

const countGeoJsonGeometryPins = (geometry: unknown): number => {
  if (!isRecord(geometry)) {
    return 0;
  }

  if (geometry.type === "Point") {
    return isGeoJsonPosition(geometry.coordinates) ? 1 : 0;
  }

  if (geometry.type === "MultiPoint") {
    return Array.isArray(geometry.coordinates)
      ? geometry.coordinates.filter(isGeoJsonPosition).length
      : 0;
  }

  if (geometry.type === "GeometryCollection") {
    return Array.isArray(geometry.geometries)
      ? geometry.geometries.reduce(
          (total, child) => total + countGeoJsonGeometryPins(child),
          0,
        )
      : 0;
  }

  return 0;
};

const countGeoJsonPins = (value: unknown): number => {
  if (!isRecord(value)) {
    return 0;
  }

  if (value.type === "FeatureCollection") {
    return Array.isArray(value.features)
      ? value.features.reduce(
          (total, feature) => total + countGeoJsonPins(feature),
          0,
        )
      : 0;
  }

  if (value.type === "Feature") {
    return countGeoJsonGeometryPins(value.geometry);
  }

  return countGeoJsonGeometryPins(value);
};

export class StgyTrackRenderer {
  private loader: TrackLoader;
  private allowedImagePatterns?: RegExp[];
  private rewriteImageUrl?: TrackImageUrlRewriter;

  constructor(options: StgyTrackRendererOptions = {}) {
    fixLeafletIcons();
    this.loader = new TrackLoader();
    this.allowedImagePatterns = this.normalizeAllowedImagePatterns(
      options.allowedImagePatterns,
    );
    this.rewriteImageUrl = options.rewriteImageUrl;
  }

  public hydrate(rootElement: HTMLElement = document.body) {
    const figures = this.getTrackMapFigures(rootElement);
    figures.forEach((figure) => this.initMap(figure));
  }

  public destroy(rootElement: HTMLElement = document.body) {
    const figures = this.getTrackMapFigures(rootElement);
    figures.forEach((figure) => {
      const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
      if (canvas) {
        const map = trackMapsByCanvas.get(canvas);
        if (map) {
          this.removeLeafletMap(map);
          trackMapsByCanvas.delete(canvas);
        }
      }
      this.removeGraphPanel(figure);
      this.removeGraphRestoreButton(figure);
      this.removeMetadataOverlay(figure);
      this.removeAnalysisOverlay(figure);
      this.removeDownloadActions(figure);
      delete figure.dataset.stgyTrackInitialized;
    });
  }

  private removeLeafletMap(map: L.Map) {
    const internalMap = map as LeafletMapWithRemovalTimers;
    if (internalMap._transitionEndTimer != null) {
      clearTimeout(internalMap._transitionEndTimer);
      internalMap._transitionEndTimer = undefined;
    }
    if (internalMap._sizeTimer != null) {
      clearTimeout(internalMap._sizeTimer);
      internalMap._sizeTimer = undefined;
    }
    map.remove();
  }

  private getTrackMapFigures(rootElement: HTMLElement): HTMLElement[] {
    const figures = Array.from(
      rootElement.querySelectorAll<HTMLElement>(".stgy-track-map")
    );
    if (rootElement.matches(".stgy-track-map")) {
      figures.unshift(rootElement);
    }
    return figures;
  }

  private createBoundsAccumulator(): BoundsAccumulator {
    return {
      hasValue: false,
      minLat: Number.POSITIVE_INFINITY,
      minLng: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
    };
  }

  private extendBoundsWithLatLng(bounds: BoundsAccumulator, lat: number, lng: number) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }

    if (!bounds.hasValue) {
      bounds.hasValue = true;
      bounds.minLat = lat;
      bounds.maxLat = lat;
      bounds.minLng = lng;
      bounds.maxLng = lng;
      return;
    }

    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
    bounds.minLng = Math.min(bounds.minLng, lng);
    bounds.maxLng = Math.max(bounds.maxLng, lng);
  }

  private extendBoundsWithLeafletBounds(bounds: BoundsAccumulator, leafletBounds: L.LatLngBounds) {
    if (!leafletBounds.isValid()) {
      return;
    }

    const southWest = leafletBounds.getSouthWest();
    const northEast = leafletBounds.getNorthEast();

    this.extendBoundsWithLatLng(bounds, southWest.lat, southWest.lng);
    this.extendBoundsWithLatLng(bounds, northEast.lat, northEast.lng);
  }

  private extendBoundsWithGeoJson(bounds: BoundsAccumulator, geoJsonData: unknown) {
    const layer = L.geoJSON(asGeoJsonInput(geoJsonData));
    this.extendBoundsWithLeafletBounds(bounds, layer.getBounds());
  }

  private extendBoundsWithCoordinates(bounds: BoundsAccumulator, coordinates: unknown) {
    if (!Array.isArray(coordinates)) {
      return;
    }

    if (
      coordinates.length >= 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      this.extendBoundsWithLatLng(bounds, coordinates[1], coordinates[0]);
      return;
    }

    coordinates.forEach((child) => {
      this.extendBoundsWithCoordinates(bounds, child);
    });
  }

  private extendTypedBoundsWithGeoJson(
    routeBounds: BoundsAccumulator,
    pinBounds: BoundsAccumulator,
    geoJsonData: unknown,
  ) {
    if (!isRecord(geoJsonData)) {
      return;
    }

    const type = geoJsonData.type;

    if (type === "FeatureCollection") {
      const features = geoJsonData.features;
      if (Array.isArray(features)) {
        features.forEach((feature) => {
          this.extendTypedBoundsWithGeoJson(routeBounds, pinBounds, feature);
        });
      }
      return;
    }

    if (type === "Feature") {
      this.extendTypedBoundsWithGeoJson(routeBounds, pinBounds, geoJsonData.geometry);
      return;
    }

    if (type === "GeometryCollection") {
      const geometries = geoJsonData.geometries;
      if (Array.isArray(geometries)) {
        geometries.forEach((geometry) => {
          this.extendTypedBoundsWithGeoJson(routeBounds, pinBounds, geometry);
        });
      }
      return;
    }

    if (type === "Point" || type === "MultiPoint") {
      this.extendBoundsWithCoordinates(pinBounds, geoJsonData.coordinates);
      return;
    }

    this.extendBoundsWithCoordinates(routeBounds, geoJsonData.coordinates);
  }

  private toLeafletBounds(bounds: BoundsAccumulator): L.LatLngBounds | null {
    if (!bounds.hasValue) {
      return null;
    }

    return L.latLngBounds(
      [bounds.minLat, bounds.minLng],
      [bounds.maxLat, bounds.maxLng]
    );
  }

  private getAutoMapView(
    map: L.Map,
    autoViewBounds: AutoViewBounds[],
  ): AutoMapView | null {
    if (autoViewBounds.length === 0) {
      return null;
    }

    const mapSize = map.getSize();
    if (mapSize.x <= 0 || mapSize.y <= 0) {
      return null;
    }

    const reportedMaxZoom = map.getMaxZoom();
    const reportedMinZoom = map.getMinZoom();
    const maxZoom = Number.isFinite(reportedMaxZoom)
      ? Math.floor(reportedMaxZoom)
      : FALLBACK_MAX_AUTO_ZOOM;
    const minZoom = Number.isFinite(reportedMinZoom)
      ? Math.ceil(reportedMinZoom)
      : 0;

    for (let zoom = maxZoom; zoom >= minZoom; zoom -= 1) {
      let minCenterX = Number.NEGATIVE_INFINITY;
      let maxCenterX = Number.POSITIVE_INFINITY;
      let minCenterY = Number.NEGATIVE_INFINITY;
      let maxCenterY = Number.POSITIVE_INFINITY;

      for (const { bounds, paddingRatio } of autoViewBounds) {
        const southWest = map.project(bounds.getSouthWest(), zoom);
        const northEast = map.project(bounds.getNorthEast(), zoom);
        const minX = Math.min(southWest.x, northEast.x);
        const maxX = Math.max(southWest.x, northEast.x);
        const minY = Math.min(southWest.y, northEast.y);
        const maxY = Math.max(southWest.y, northEast.y);
        const usableHalfWidth = mapSize.x * (0.5 - paddingRatio);
        const usableHalfHeight = mapSize.y * (0.5 - paddingRatio);

        minCenterX = Math.max(minCenterX, maxX - usableHalfWidth);
        maxCenterX = Math.min(maxCenterX, minX + usableHalfWidth);
        minCenterY = Math.max(minCenterY, maxY - usableHalfHeight);
        maxCenterY = Math.min(maxCenterY, minY + usableHalfHeight);
      }

      if (minCenterX <= maxCenterX && minCenterY <= maxCenterY) {
        return {
          center: map.unproject(
            L.point(
              (minCenterX + maxCenterX) / 2,
              (minCenterY + maxCenterY) / 2,
            ),
            zoom,
          ),
          zoom,
        };
      }
    }

    const combinedBounds = this.createBoundsAccumulator();
    autoViewBounds.forEach(({ bounds }) => {
      this.extendBoundsWithLeafletBounds(combinedBounds, bounds);
    });
    const combinedLeafletBounds = this.toLeafletBounds(combinedBounds);
    if (!combinedLeafletBounds?.isValid()) {
      return null;
    }

    return {
      center: combinedLeafletBounds.getCenter(),
      zoom: minZoom,
    };
  }


  private normalizeBaseLayerKey(value: unknown): BaseLayerKey | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (!normalized) {
      return null;
    }

    return BASE_LAYER_ALIASES[normalized] || null;
  }

  private getDefaultBaseLayerKey(isJp: boolean): BaseLayerKey {
    return isJp ? "gsi-pale" : "cyclosm";
  }

  private createBaseMaps(
    baseLayerDefinitions: BaseLayerDefinition[],
    isJp: boolean,
    requestedBaseLayerKey: BaseLayerKey | null
  ): { baseMaps: Record<string, L.TileLayer>; defaultLayer: L.TileLayer } {
    const defaultBaseLayerKey = requestedBaseLayerKey || this.getDefaultBaseLayerKey(isJp);
    const availableBaseLayerDefinitions = baseLayerDefinitions.filter((definition) => {
      return !definition.japanOnly || isJp || definition.key === requestedBaseLayerKey;
    });

    const baseMaps: Record<string, L.TileLayer> = {};
    availableBaseLayerDefinitions.forEach((definition) => {
      baseMaps[definition.label] = definition.layer;
    });

    const fallbackBaseLayerDefinition = availableBaseLayerDefinitions[0];
    if (!fallbackBaseLayerDefinition) {
      throw new Error("No base layers are available.");
    }

    const defaultBaseLayerDefinition =
      availableBaseLayerDefinitions.find((definition) => definition.key === defaultBaseLayerKey) ||
      availableBaseLayerDefinitions.find((definition) => {
        return definition.key === this.getDefaultBaseLayerKey(isJp);
      }) ||
      fallbackBaseLayerDefinition;

    return {
      baseMaps,
      defaultLayer: defaultBaseLayerDefinition.layer,
    };
  }

  private getBoundsCenter(bounds: BoundsAccumulator): L.LatLng | null {
    const leafletBounds = this.toLeafletBounds(bounds);
    if (!leafletBounds || !leafletBounds.isValid()) {
      return null;
    }
    return leafletBounds.getCenter();
  }

  private showError(figure: HTMLElement, message: string) {
    const oldErrors = figure.querySelectorAll(".stgy-track-error-message");
    oldErrors.forEach((node) => node.remove());

    const error = document.createElement("div");
    error.className = "stgy-track-error-message";
    error.textContent = message;

    const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
    if (canvas) {
      canvas.appendChild(error);
    } else {
      figure.appendChild(error);
    }
  }

  private toUserErrorMessage(e: unknown): string {
    if (e instanceof Error && e.message === "Track data MIME type is not supported") {
      return "Track data MIME type is not supported.";
    }
    return "Track data could not be loaded.";
  }

  private createHud(canvas: HTMLElement): HTMLElement {
    const old = canvas.querySelectorAll(".stgy-track-hud");
    old.forEach((node) => node.remove());

    const hud = document.createElement("div");
    hud.className = "stgy-track-hud";
    hud.hidden = true;
    canvas.appendChild(hud);
    return hud;
  }

  private removeMetadataOverlay(figure: HTMLElement) {
    figure
      .querySelectorAll(".stgy-track-metadata-overlay")
      .forEach((node) => node.remove());
  }

  private createMetadataOverlay(
    canvas: HTMLElement,
    text: string,
  ): HTMLElement {
    canvas
      .querySelectorAll(".stgy-track-metadata-overlay")
      .forEach((node) => node.remove());

    const overlay = document.createElement("div");
    overlay.className = "stgy-track-metadata-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const dialog = document.createElement("div");
    dialog.className = "stgy-track-metadata-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Track metadata");

    const closeButton = this.createGraphToggleButton(
      "close",
      "Close metadata",
    );
    closeButton.classList.add("stgy-track-metadata-close");

    const content = document.createElement("div");
    content.className = "stgy-track-metadata-content";
    content.textContent = text;

    dialog.append(closeButton, content);
    overlay.appendChild(dialog);
    canvas.appendChild(overlay);

    const close = () => this.setMetadataOverlayOpen(overlay, false);
    closeButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close();
      }
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });

    L.DomEvent.disableClickPropagation(dialog);
    L.DomEvent.disableScrollPropagation(dialog);
    return overlay;
  }

  private setMetadataOverlayOpen(overlay: HTMLElement, open: boolean) {
    overlay.hidden = !open;
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      overlay
        .querySelector<HTMLButtonElement>(".stgy-track-metadata-close")
        ?.focus();
    }
  }

  private addMetadataControlAction(
    layerControl: L.Control.Layers,
    metadataOverlay: HTMLElement,
  ) {
    const container = (layerControl as L.Control.Layers & {
      getContainer?: () => HTMLElement | undefined;
    }).getContainer?.();
    const list = container?.querySelector<HTMLElement>(
      ".leaflet-control-layers-list",
    );
    if (!list) {
      return;
    }

    list
      .querySelectorAll(".stgy-track-metadata-control")
      .forEach((node) => node.remove());

    const button = document.createElement("button");
    button.type = "button";
    button.className = "stgy-track-metadata-control";
    button.textContent = "Metadata";
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setMetadataOverlayOpen(metadataOverlay, true);
    });

    list.appendChild(button);
  }

  private buildMetadataOverlayText(
    loadedTracks: PreloadedTrackData[],
  ): string | undefined {
    const sections = loadedTracks.flatMap((loadedTrack, index) => {
      const lines = getTrackJsonDisplayMetadataLines(loadedTrack.data);
      if (lines.length === 0) {
        return [];
      }

      if (loadedTracks.length === 1) {
        return [lines.map((line) => line.text).join("\n")];
      }

      const title = getTrackJsonTitle(loadedTrack.data) || `Track ${index + 1}`;
      return [`${title}\n${lines.map((line) => line.text).join("\n")}`];
    });

    return sections.length > 0 ? sections.join("\n\n") : undefined;
  }

  private removeAnalysisOverlay(figure: HTMLElement) {
    figure
      .querySelectorAll(".stgy-track-analysis-overlay")
      .forEach((node) => node.remove());
  }

  private buildAnalysisOverlaySections(
    loadedTracks: PreloadedTrackData[],
    options: { lthrBpm?: number; ftpW?: number } = {},
  ): TrackAnalysisOverlaySection[] {
    return loadedTracks.flatMap((loadedTrack, index) => {
      const analysis = getTrackJsonAnalysis(loadedTrack.data, options);
      if (analysis.displays.length === 0 && analysis.powerCurve.length === 0) {
        return [];
      }

      return [{
        ...(loadedTracks.length > 1
          ? { title: getTrackJsonTitle(loadedTrack.data) || `Track ${index + 1}` }
          : {}),
        displays: analysis.displays,
        powerCurve: analysis.powerCurve,
      }];
    });
  }

  private formatAnalysisPowerCurveDuration(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    if (seconds < 3600) {
      const minutes = seconds / 60;
      return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}m`;
    }
    const hours = seconds / 3600;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  }

  private createAnalysisPowerCurve(
    points: TrackPowerCurvePoint[],
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "stgy-track-analysis-power-curve";

    const title = document.createElement("h4");
    title.className = "stgy-track-analysis-title";
    title.textContent = "Power curve";
    section.appendChild(title);

    const width = 480;
    const height = 170;
    const left = 38;
    const right = 12;
    const top = 12;
    const bottom = 28;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const durations = points.map((point) => point.durationSeconds);
    const minDuration = Math.max(1, Math.min(...durations));
    const maxDuration = Math.max(minDuration + 1, Math.max(...durations));
    const maxPower = Math.max(...points.map((point) => point.watts), 1);
    const yMax = Math.max(50, Math.ceil(maxPower / 50) * 50);
    const yTicks = Array.from(
      { length: Math.max(1, Math.floor(yMax / 50)) },
      (_, index) => (index + 1) * 50,
    );
    const minLog = Math.log10(minDuration);
    const maxLog = Math.log10(maxDuration);
    const xValue = (seconds: number) => {
      const ratio = (Math.log10(seconds) - minLog) /
        Math.max(0.001, maxLog - minLog);
      return left + ratio * plotWidth;
    };
    const yValue = (watts: number) =>
      top + plotHeight - (watts / yMax) * plotHeight;

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "stgy-track-analysis-power-curve-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Power curve chart");

    const appendLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      className: string,
    ) => {
      const line = document.createElementNS(svgNs, "line");
      line.setAttribute("class", className);
      line.setAttribute("x1", `${x1}`);
      line.setAttribute("y1", `${y1}`);
      line.setAttribute("x2", `${x2}`);
      line.setAttribute("y2", `${y2}`);
      svg.appendChild(line);
    };

    const appendText = (
      x: number,
      y: number,
      text: string,
      anchor: "start" | "middle" | "end",
    ) => {
      const label = document.createElementNS(svgNs, "text");
      label.setAttribute("class", "stgy-track-analysis-power-curve-label");
      label.setAttribute("x", `${x}`);
      label.setAttribute("y", `${y}`);
      label.setAttribute("text-anchor", anchor);
      label.textContent = text;
      svg.appendChild(label);
    };

    yTicks.forEach((tick) => {
      const y = yValue(tick);
      appendLine(left, y, width - right, y,
        "stgy-track-analysis-power-curve-grid");
      appendText(left - 6, y + 3, `${tick}`, "end");
    });

    appendLine(left, top, left, top + plotHeight,
      "stgy-track-analysis-power-curve-axis");
    appendLine(left, top + plotHeight, width - right, top + plotHeight,
      "stgy-track-analysis-power-curve-axis");

    points.forEach((point) => {
      const x = xValue(point.durationSeconds);
      appendLine(x, top + plotHeight, x, top + plotHeight + 4,
        "stgy-track-analysis-power-curve-axis");
      appendText(
        x,
        height - 9,
        this.formatAnalysisPowerCurveDuration(point.durationSeconds),
        "middle",
      );
    });

    const polyline = document.createElementNS(svgNs, "polyline");
    polyline.setAttribute("class", "stgy-track-analysis-power-curve-line");
    polyline.setAttribute(
      "points",
      points.map((point) =>
        `${xValue(point.durationSeconds)},${yValue(point.watts)}`
      ).join(" "),
    );
    svg.appendChild(polyline);

    points.forEach((point) => {
      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("class", "stgy-track-analysis-power-curve-point");
      circle.setAttribute("cx", `${xValue(point.durationSeconds)}`);
      circle.setAttribute("cy", `${yValue(point.watts)}`);
      circle.setAttribute("r", "2.5");
      const tooltip = document.createElementNS(svgNs, "title");
      tooltip.textContent =
        `${this.formatAnalysisPowerCurveDuration(point.durationSeconds)} ${Math.round(point.watts)} W`;
      circle.appendChild(tooltip);
      svg.appendChild(circle);
    });

    section.appendChild(svg);
    return section;
  }

  private createAnalysisOverlay(
    canvas: HTMLElement,
    sections: TrackAnalysisOverlaySection[],
  ): HTMLElement {
    canvas
      .querySelectorAll(".stgy-track-analysis-overlay")
      .forEach((node) => node.remove());

    const overlay = document.createElement("div");
    overlay.className = "stgy-track-analysis-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const dialog = document.createElement("div");
    dialog.className = "stgy-track-analysis-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Track analysis");

    const closeButton = this.createGraphToggleButton(
      "close",
      "Close analysis",
    );
    closeButton.classList.add("stgy-track-analysis-close");

    const content = document.createElement("div");
    content.className = "stgy-track-analysis-content";

    sections.forEach((analysisSection) => {
      const trackSection = document.createElement("section");
      trackSection.className = "stgy-track-analysis-track";

      if (analysisSection.title) {
        const trackTitle = document.createElement("h3");
        trackTitle.className = "stgy-track-analysis-track-title";
        trackTitle.textContent = analysisSection.title;
        trackSection.appendChild(trackTitle);
      }

      const grid = document.createElement("div");
      grid.className = "stgy-track-analysis-grid";

      analysisSection.displays.forEach((display) => {
        const histogram = document.createElement("section");
        histogram.className = "stgy-track-analysis-histogram";

        const title = document.createElement("h4");
        title.className = "stgy-track-analysis-title";
        title.textContent = display.title;
        histogram.appendChild(title);

        const barScaleMaxPercentage =
          getHistogramBarScaleMaxPercentage(display.rows);

        display.rows.forEach((row) => {
          const item = document.createElement("div");
          item.className = "stgy-track-analysis-row";

          const label = document.createElement("span");
          label.className = "stgy-track-analysis-label";
          label.textContent = row.label;
          label.title = row.label;

          const barTrack = document.createElement("div");
          barTrack.className = "stgy-track-analysis-bar-track";
          barTrack.setAttribute("aria-hidden", "true");

          const bar = document.createElement("div");
          bar.className = "stgy-track-analysis-bar";
          bar.style.width = `${Math.max(
            0,
            Math.min(100, (row.percentage / barScaleMaxPercentage) * 100),
          )}%`;
          barTrack.appendChild(bar);

          const percentage = document.createElement("span");
          percentage.className = "stgy-track-analysis-percentage";
          percentage.textContent = `${row.percentage.toFixed(1)}%`;

          const duration = document.createElement("span");
          duration.className = "stgy-track-analysis-duration";
          duration.textContent = this.formatElapsedDuration(row.seconds);

          item.append(label, barTrack, percentage, duration);
          histogram.appendChild(item);
        });

        grid.appendChild(histogram);
      });

      trackSection.appendChild(grid);
      if (analysisSection.powerCurve.length > 0) {
        trackSection.appendChild(
          this.createAnalysisPowerCurve(analysisSection.powerCurve),
        );
      }
      content.appendChild(trackSection);
    });

    dialog.append(closeButton, content);
    overlay.appendChild(dialog);
    canvas.appendChild(overlay);

    const close = () => this.setAnalysisOverlayOpen(overlay, false);
    closeButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close();
      }
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });

    L.DomEvent.disableClickPropagation(dialog);
    L.DomEvent.disableScrollPropagation(dialog);
    return overlay;
  }

  private setAnalysisOverlayOpen(overlay: HTMLElement, open: boolean) {
    overlay.hidden = !open;
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      overlay
        .querySelector<HTMLButtonElement>(".stgy-track-analysis-close")
        ?.focus();
    }
  }

  private addAnalysisControlAction(
    layerControl: L.Control.Layers,
    analysisOverlay: HTMLElement,
  ) {
    const container = (layerControl as L.Control.Layers & {
      getContainer?: () => HTMLElement | undefined;
    }).getContainer?.();
    const list = container?.querySelector<HTMLElement>(
      ".leaflet-control-layers-list",
    );
    if (!list) {
      return;
    }

    list
      .querySelectorAll(".stgy-track-analysis-control")
      .forEach((node) => node.remove());

    const button = document.createElement("button");
    button.type = "button";
    button.className = "stgy-track-analysis-control";
    button.textContent = "Analysis";
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setAnalysisOverlayOpen(analysisOverlay, true);
    });

    list.appendChild(button);
  }

  private removeGraphPanel(figure: HTMLElement) {
    Array.from(figure.children).forEach((child) => {
      if (child.classList.contains("stgy-track-graph")) {
        child.remove();
      }
    });

    let next = figure.nextElementSibling;
    while (next && next.classList.contains("stgy-track-graph")) {
      const current = next;
      next = next.nextElementSibling;
      current.remove();
    }
  }

  private createGraphPanel(figure: HTMLElement): HTMLElement {
    this.removeGraphPanel(figure);

    const panel = document.createElement("div");
    panel.className = "stgy-track-graph";
    panel.hidden = true;

    if (
      figure.parentElement?.classList.contains("stgy-track-grid") ||
      figure.closest(".pub-theme-dir-vert")
    ) {
      const caption = Array.from(figure.children).find((child) => {
        return child.tagName.toLowerCase() === "figcaption";
      });
      if (caption) {
        figure.insertBefore(panel, caption);
      } else {
        figure.appendChild(panel);
      }
    } else {
      figure.insertAdjacentElement("afterend", panel);
    }

    return panel;
  }

  private removeGraphRestoreButton(figure: HTMLElement) {
    figure
      .querySelectorAll(".stgy-track-graph-restore")
      .forEach((node) => node.remove());
  }

  private createGraphToggleButton(
    iconType: "close" | "graph",
    label: string
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stgy-track-graph-toggle";
    button.setAttribute("aria-label", label);
    button.title = label;

    const svgNs = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(svgNs, "svg");
    icon.classList.add(
      "stgy-track-graph-toggle-icon",
      `stgy-track-graph-toggle-icon-${iconType}`
    );
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(svgNs, "path");
    if (iconType === "close") {
      path.setAttribute("d", "M5 5l10 10M15 5L5 15");
    } else {
      path.setAttribute("d", "M3 3v14h14M5 14l3-4 3 2 5-7");
    }
    icon.appendChild(path);
    button.appendChild(icon);

    return button;
  }

  private invalidateMapAfterLayout(map: L.Map) {
    const invalidate = () => map.invalidateSize({ animate: false });
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(invalidate);
    } else {
      invalidate();
    }
  }

  private setGraphCollapsed(
    context: CoordinateInteractionContext,
    collapsed: boolean
  ) {
    const panel = context.graphPanel;
    if (!panel || !context.activeGraphDataset) {
      return;
    }

    context.graphCollapsed = collapsed;
    panel.hidden = collapsed;
    if (context.graphRestoreButton) {
      context.graphRestoreButton.hidden = !collapsed;
    }
    if (collapsed) {
      this.clearGraphHover(context);
    }
    this.invalidateMapAfterLayout(context.map);
  }

  private normalizeAllowedImagePatterns(patterns?: RegExp[]): RegExp[] | undefined {
    return patterns?.map((pattern) => {
      const flags = pattern.flags.replace(/[gy]/g, "");
      return new RegExp(pattern.source, flags);
    });
  }

  private isAllowedImageUrl(src: string): boolean {
    if (!this.allowedImagePatterns) {
      return true;
    }
    return this.allowedImagePatterns.some((pattern) => pattern.test(src));
  }

  private normalizeSafeUrl(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (schemeMatch) {
      try {
        const url = new URL(trimmed);
        if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
          return null;
        }
        return url.href;
      } catch {
        return null;
      }
    }

    if (trimmed.startsWith("//")) {
      try {
        const currentProtocol = window.location.protocol;
        const protocol = ALLOWED_URL_PROTOCOLS.has(currentProtocol) ? currentProtocol : "https:";
        const url = new URL(`${protocol}${trimmed}`);
        if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
          return null;
        }
        return url.href;
      } catch {
        return null;
      }
    }

    return trimmed;
  }

  private appendTextBlock(root: HTMLElement, className: string, value: unknown) {
    if (typeof value !== "string") {
      return;
    }

    const div = document.createElement("div");
    div.className = className;
    div.textContent = value;
    root.appendChild(div);
  }

  private appendSafeLink(root: HTMLElement, hrefValue: unknown, textValue?: unknown) {
    const href = this.normalizeSafeUrl(hrefValue);
    if (!href) {
      return;
    }

    const div = document.createElement("div");
    div.className = "annot-link";

    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = typeof textValue === "string" ? textValue : href;

    div.appendChild(anchor);
    root.appendChild(div);
  }

  private resolveImageUrl(srcValue: unknown): string | null {
    const source = this.normalizeSafeUrl(srcValue);
    if (!source || !this.isAllowedImageUrl(source)) {
      return null;
    }

    if (!this.rewriteImageUrl) {
      return source;
    }

    try {
      return this.normalizeSafeUrl(this.rewriteImageUrl(source));
    } catch {
      return null;
    }
  }

  private appendSafeImage(root: HTMLElement, srcValue: unknown, altValue?: unknown) {
    const src = this.resolveImageUrl(srcValue);
    if (!src) {
      return;
    }

    const div = document.createElement("div");
    div.className = "annot-image";

    const image = document.createElement("img");
    image.src = src;
    image.alt = typeof altValue === "string" ? altValue : "";
    image.referrerPolicy = "no-referrer";
    image.loading = "lazy";
    image.decoding = "async";

    div.appendChild(image);
    root.appendChild(div);
  }

  private buildPopupElementFromProps(props: JsonRecord): HTMLElement | null {
    const root = document.createElement("div");

    this.appendTextBlock(root, "annot-title", props.title);
    this.appendTextBlock(root, "annot-desc", props.description);

    if (Array.isArray(props.links)) {
      props.links.forEach((link: unknown) => {
        if (typeof link === "string") {
          this.appendSafeLink(root, link, link);
        } else if (isRecord(link)) {
          this.appendSafeLink(root, link.href, link.text);
        }
      });
    }

    if (Array.isArray(props.images)) {
      props.images.forEach((image: unknown) => {
        if (typeof image === "string") {
          this.appendSafeImage(root, image, "");
        } else if (isRecord(image)) {
          this.appendSafeImage(root, image.src, image.alt);
        }
      });
    }

    return root.children.length > 0 ? root : null;
  }

  private buildPopupElementFromInlinePin(li: HTMLElement): HTMLElement | null {
    const root = document.createElement("div");

    Array.from(li.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) {
        return;
      }

      if (child.classList.contains("annot-title")) {
        this.appendTextBlock(root, "annot-title", child.textContent || "");
        return;
      }

      if (child.classList.contains("annot-desc")) {
        this.appendTextBlock(root, "annot-desc", child.textContent || "");
        return;
      }

      if (child.classList.contains("annot-link")) {
        const links = Array.from(child.querySelectorAll<HTMLAnchorElement>("a"));
        if (links.length === 0) {
          this.appendSafeLink(root, child.textContent || "", child.textContent || "");
          return;
        }

        links.forEach((link) => {
          this.appendSafeLink(
            root,
            link.getAttribute("href") || "",
            link.textContent || link.getAttribute("href") || ""
          );
        });
        return;
      }

      if (child.classList.contains("annot-image")) {
        const dataSrc = child.dataset.src;
        if (dataSrc) {
          this.appendSafeImage(root, dataSrc, child.dataset.alt || "");
          return;
        }

        const images = Array.from(child.querySelectorAll<HTMLImageElement>("img"));
        images.forEach((image) => {
          this.appendSafeImage(
            root,
            image.getAttribute("src") || "",
            image.getAttribute("alt") || ""
          );
        });
      }
    });

    return root.children.length > 0 ? root : null;
  }

  private removeDownloadActions(figure: HTMLElement) {
    Array.from(figure.children).forEach((child) => {
      if (child instanceof HTMLElement && child.classList.contains("stgy-track-actions")) {
        child.remove();
      }
    });
  }

  private createDownloadActions(figure: HTMLElement) {
    this.removeDownloadActions(figure);

    const downloadSrc = figure.dataset.downloadSrc?.trim();
    if (!downloadSrc) {
      return;
    }

    const href = this.normalizeSafeUrl(downloadSrc);
    if (!href) {
      return;
    }

    const label = figure.dataset.downloadLabel?.trim() || DEFAULT_DOWNLOAD_LABEL;
    const filename = figure.dataset.downloadFilename?.trim();

    const actions = document.createElement("div");
    actions.className = "stgy-track-actions";

    const link = document.createElement("a");
    link.className = "stgy-track-download";
    link.href = href;
    link.textContent = label;

    if (filename) {
      link.download = filename;
    }

    actions.appendChild(link);

    const caption = figure.querySelector<HTMLElement>(".stgy-track-caption");
    if (caption && caption.parentElement === figure) {
      caption.insertAdjacentElement("afterend", actions);
    } else {
      figure.appendChild(actions);
    }
  }

  private getFeaturePathStyle(feature: GeoJsonFeatureLike | null | undefined): L.PathOptions {
    const props = getFeatureProperties(feature);
    const color = normalizeMapColor(props.color) || DEFAULT_ROUTE_COLOR;
    const weight = getFiniteNumber(props.weight, 4);
    const opacity = getFiniteNumber(props.opacity, 0.8);

    return {
      color,
      weight,
      opacity,
    };
  }

  private getActiveFeaturePathStyle(baseStyle: L.PathOptions): L.PathOptions {
    const baseWeight = typeof baseStyle.weight === "number" && Number.isFinite(baseStyle.weight)
      ? baseStyle.weight
      : 4;

    return {
      ...baseStyle,
      weight: baseWeight + 2,
      opacity: 1,
    };
  }

  private getStyleableLayer(layer: L.Layer): StyleableLayer {
    return layer as StyleableLayer;
  }

  private restoreGraphLayerStyle(context: CoordinateInteractionContext, layer: L.Layer) {
    const styleableLayer = this.getStyleableLayer(layer);
    const baseStyle = context.routeStyleByLayer.get(layer);

    if (baseStyle && styleableLayer.setStyle) {
      styleableLayer.setStyle(baseStyle);
    }
  }

  private highlightGraphLayer(context: CoordinateInteractionContext, layer: L.Layer) {
    const styleableLayer = this.getStyleableLayer(layer);
    const baseStyle = context.routeStyleByLayer.get(layer);

    if (baseStyle && styleableLayer.setStyle) {
      styleableLayer.setStyle(this.getActiveFeaturePathStyle(baseStyle));
    }

    if (styleableLayer.bringToFront) {
      styleableLayer.bringToFront();
    }
  }

  private activateGraphDatasetForLayer(context: CoordinateInteractionContext, layer: L.Layer) {
    const dataset = context.routeDatasetByLayer.get(layer);
    if (!dataset || !context.graphPanel) {
      return;
    }

    this.clearCoordinateSample(context, true);

    if (context.activeGraphLayer && context.activeGraphLayer !== layer) {
      this.restoreGraphLayerStyle(context, context.activeGraphLayer);
    }

    context.activeGraphLayer = layer;
    context.activeGraphDataset = dataset;
    this.highlightGraphLayer(context, layer);
    this.renderGraphPanel(context.graphPanel, context, dataset);
  }

  private registerGraphDatasetForLayer(
    feature: GeoJsonFeatureLike,
    layer: L.Layer,
    context: CoordinateInteractionContext
  ) {
    if (!context.graphPanel) {
      return;
    }

    const dataset = this.buildGraphDatasetFromFeature(feature);
    if (!dataset) {
      return;
    }

    context.routeDatasetByLayer.set(layer, dataset);
    context.routeStyleByLayer.set(layer, this.getFeaturePathStyle(feature));

    if (!context.activeGraphDataset) {
      this.activateGraphDatasetForLayer(context, layer);
    }
  }

  private normalizeTimeSeconds(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return value > 100000000000 ? value / 1000 : value;
  }

  private formatLocalTime(value: unknown): string | null {
    const seconds = this.normalizeTimeSeconds(value);
    if (seconds === null) {
      return null;
    }

    const millis = seconds * 1000;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const yyyy = date.getFullYear().toString().padStart(4, "0");
    const mm = (date.getMonth() + 1).toString().padStart(2, "0");
    const dd = date.getDate().toString().padStart(2, "0");
    const hh = date.getHours().toString().padStart(2, "0");
    const mi = date.getMinutes().toString().padStart(2, "0");
    const ss = date.getSeconds().toString().padStart(2, "0");

    return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
  }

  private formatElapsedDuration(seconds: number): string {
    const totalSeconds = Math.max(0, Math.round(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const restSeconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${restSeconds.toString().padStart(2, "0")}`;
  }

  private getCoordinateElapsedSeconds(
    coordinateProperties: CoordinateProperties,
    index: number,
  ): number | null {
    const times = coordinateProperties.times;
    if (!Array.isArray(times)) {
      return null;
    }

    const firstTime = this.normalizeTimeSeconds(times[0]);
    const currentTime = this.normalizeTimeSeconds(times[index]);
    if (firstTime === null || currentTime === null || currentTime < firstTime) {
      return null;
    }

    return currentTime - firstTime;
  }

  private formatHudLabel(name: string): string {
    if (name === "altitudes") {
      return "altitude";
    }
    if (name === "torqueEffectivenessPercentage") {
      return "Torque efficiency";
    }
    if (name === "pedalSmoothnessPercentage") {
      return "Pedal smoothness";
    }
    return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  }

  private formatGraphSeriesLabel(name: string): string {
    return TRACK_GRAPH_SERIES_LABELS[name] || this.formatHudLabel(name);
  }

  private findNearestCoordinateIndex(coordinates: unknown, latlng: L.LatLng): number | null {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return null;
    }

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    coordinates.forEach((coordinate, index) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) {
        return;
      }

      const lon = coordinate[0];
      const lat = coordinate[1];
      if (
        typeof lat !== "number" ||
        typeof lon !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        return;
      }

      const dLat = latlng.lat - lat;
      const dLon = latlng.lng - lon;
      const distance = dLat * dLat + dLon * dLon;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex >= 0 ? bestIndex : null;
  }

  private getLatLngAtIndex(coordinates: unknown, index: number): L.LatLngExpression | null {
    if (!Array.isArray(coordinates)) {
      return null;
    }

    const coordinate = coordinates[index];
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      return null;
    }

    const lon = coordinate[0];
    const lat = coordinate[1];

    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return null;
    }

    return [lat, lon];
  }

  private appendHudItem(list: HTMLUListElement, name: string, value: string) {
    const item = document.createElement("li");
    item.textContent = `${this.formatHudLabel(name)}: ${value}`;
    list.appendChild(item);
  }

  private getCoordinatePropertyValue(
    coordinateProperties: CoordinateProperties,
    name: string,
    index: number
  ): unknown {
    const series = coordinateProperties[name];
    return Array.isArray(series) ? series[index] : undefined;
  }

  private renderHudItems(hud: HTMLElement, coordinateProperties: CoordinateProperties, index: number): boolean {
    const list = document.createElement("ul");

    const time = this.formatLocalTime(
      this.getCoordinatePropertyValue(coordinateProperties, "times", index)
    );
    if (time) {
      this.appendHudItem(list, "times", time);
      const elapsed = this.getCoordinateElapsedSeconds(coordinateProperties, index);
      if (elapsed !== null) {
        this.appendHudItem(
          list,
          "elapsed",
          `${Math.round(elapsed)}s (${this.formatElapsedDuration(elapsed)})`,
        );
      }
    }

    const distance = this.getCoordinatePropertyValue(
      coordinateProperties,
      "distances",
      index
    );
    if (typeof distance === "number" && Number.isFinite(distance)) {
      this.appendHudItem(list, "distances", `${(distance / 1000).toFixed(2)} km`);
    }

    const altitude = this.getCoordinatePropertyValue(
      coordinateProperties,
      "altitudes",
      index
    );
    if (typeof altitude === "number" && Number.isFinite(altitude)) {
      this.appendHudItem(list, "altitude", `${Math.round(altitude)} m`);
    }

    const heartRate = this.getCoordinatePropertyValue(
      coordinateProperties,
      "heartRates",
      index
    );
    if (typeof heartRate === "number" && Number.isFinite(heartRate)) {
      this.appendHudItem(list, "heartRates", `${Math.round(heartRate)} bpm`);
    }

    const cadence = this.getCoordinatePropertyValue(
      coordinateProperties,
      "cadences",
      index
    );
    if (typeof cadence === "number" && Number.isFinite(cadence)) {
      this.appendHudItem(list, "cadences", `${Math.round(cadence)} rpm`);
    }

    const power = this.getCoordinatePropertyValue(
      coordinateProperties,
      "powers",
      index
    );
    if (typeof power === "number" && Number.isFinite(power)) {
      this.appendHudItem(list, "powers", `${Math.round(power)} W`);
    }

    const speed = this.getCoordinatePropertyValue(
      coordinateProperties,
      "speeds",
      index
    );
    if (typeof speed === "number" && Number.isFinite(speed)) {
      this.appendHudItem(list, "speeds", `${speed.toFixed(1)} km/h`);
    }

    if (list.children.length === 0) {
      return false;
    }

    hud.replaceChildren(list);
    return true;
  }

  private showCoordinateMarker(
    context: CoordinateInteractionContext,
    latLng: L.LatLngExpression
  ) {
    if (!context.markerState.marker) {
      context.markerState.marker = L.circleMarker(latLng, {
        radius: 7,
        weight: 3,
        color: "#ffffff",
        fillColor: "#0078A8",
        fillOpacity: 0.95,
        opacity: 1,
        interactive: false,
      });
    } else {
      context.markerState.marker.setLatLng(latLng);
    }

    const marker = context.markerState.marker;
    if (!context.map.hasLayer(marker)) {
      context.map.addLayer(marker);
    }
  }

  private hideCoordinateMarker(context: CoordinateInteractionContext) {
    const marker = context.markerState.marker;
    if (marker && context.map.hasLayer(marker)) {
      context.map.removeLayer(marker);
    }
  }

  private updateCoordinateOverlay(
    hud: HTMLElement | null,
    coordinateProperties: CoordinateProperties,
    index: number
  ) {
    if (!hud) {
      return;
    }

    if (!this.renderHudItems(hud, coordinateProperties, index)) {
      hud.hidden = true;
      return;
    }

    hud.hidden = false;
  }

  private showGraphHoverAtIndex(context: CoordinateInteractionContext, index: number) {
    const state = context.graphHoverState;
    if (!state || state.dataset !== context.activeGraphDataset) {
      return;
    }

    if (index < 0 || index >= state.xValues.length || index >= state.displayValues.length) {
      return;
    }

    const displayValue = state.displayValues[index];
    const hoverX = state.scaledXValues[index];
    const hoverY = state.yScale(displayValue);

    state.hoverLine.setAttribute("x1", `${hoverX}`);
    state.hoverLine.setAttribute("x2", `${hoverX}`);
    state.hoverLine.setAttribute("visibility", "visible");

    state.hoverPoint.setAttribute("cx", `${hoverX}`);
    state.hoverPoint.setAttribute("cy", `${hoverY}`);
    state.hoverPoint.setAttribute("visibility", "visible");

    state.readout.textContent =
      `${this.formatXAxisLabel(state.selectedXAxis, state.xValues[index])} / ` +
      `${this.formatGraphYValue(state.series.name, displayValue)}`;
  }

  private clearGraphHover(context: CoordinateInteractionContext) {
    const state = context.graphHoverState;
    if (!state) {
      return;
    }

    state.hoverLine.setAttribute("visibility", "hidden");
    state.hoverPoint.setAttribute("visibility", "hidden");
    state.readout.textContent = "";
  }

  private renderCoordinateSample(
    context: CoordinateInteractionContext,
    latLng: L.LatLngExpression,
    coordinateProperties: CoordinateProperties,
    index: number
  ) {
    this.showCoordinateMarker(context, latLng);
    this.updateCoordinateOverlay(context.hud, coordinateProperties, index);

    if (context.activeGraphDataset?.coordinateProperties === coordinateProperties) {
      this.showGraphHoverAtIndex(context, index);
    }
  }

  private activateCoordinateSample(
    context: CoordinateInteractionContext,
    latLng: L.LatLngExpression,
    coordinateProperties: CoordinateProperties,
    index: number,
    pinned = false
  ) {
    if (pinned) {
      context.pinnedSample = {
        latLng,
        coordinateProperties,
        index,
      };
    }

    this.renderCoordinateSample(context, latLng, coordinateProperties, index);
  }

  private restorePinnedCoordinateSample(context: CoordinateInteractionContext): boolean {
    if (!context.pinnedSample) {
      return false;
    }

    this.renderCoordinateSample(
      context,
      context.pinnedSample.latLng,
      context.pinnedSample.coordinateProperties,
      context.pinnedSample.index
    );
    return true;
  }

  private clearCoordinateSample(context: CoordinateInteractionContext, force = false) {
    if (!force && this.restorePinnedCoordinateSample(context)) {
      return;
    }

    context.pinnedSample = null;
    this.hideCoordinateMarker(context);
    this.clearGraphHover(context);

    if (context.hud) {
      context.hud.hidden = true;
    }
  }

  private ignoreNextMapClickOnce(context: CoordinateInteractionContext) {
    context.ignoreNextMapClick = true;

    window.setTimeout(() => {
      context.ignoreNextMapClick = false;
    }, 0);
  }

  private activateCoordinateSampleAtLatLng(
    context: CoordinateInteractionContext,
    coordinates: unknown,
    coordinateProperties: CoordinateProperties,
    latlng: L.LatLng,
    pinned = false
  ) {
    const index = this.findNearestCoordinateIndex(coordinates, latlng);
    if (index === null) {
      this.clearCoordinateSample(context);
      return;
    }

    const latLng = this.getLatLngAtIndex(coordinates, index);
    if (!latLng) {
      this.clearCoordinateSample(context);
      return;
    }

    this.activateCoordinateSample(context, latLng, coordinateProperties, index, pinned);
  }

  private bindCoordinateInteractions(
    feature: GeoJsonFeatureLike,
    layer: L.Layer,
    context: CoordinateInteractionContext
  ) {
    const geometry = feature.geometry;
    if (!isRecord(geometry) || geometry.type !== "LineString") {
      return;
    }

    const coordinates = geometry.coordinates;
    const props = getFeatureProperties(feature);
    const coordinateProperties = props.coordinateProperties;
    if (!isRecord(coordinateProperties)) {
      return;
    }

    layer.on("mousemove", (event: L.LeafletMouseEvent) => {
      this.activateCoordinateSampleAtLatLng(
        context,
        coordinates,
        coordinateProperties,
        event.latlng,
        false
      );
    });

    layer.on("click", (event?: L.LeafletMouseEvent) => {
      this.ignoreNextMapClickOnce(context);

      if (event?.originalEvent) {
        L.DomEvent.stopPropagation(event.originalEvent);
      }

      if (context.routeDatasetByLayer.get(layer) && context.graphPanel) {
        this.activateGraphDatasetForLayer(context, layer);
      }

      if (event?.latlng) {
        this.activateCoordinateSampleAtLatLng(
          context,
          coordinates,
          coordinateProperties,
          event.latlng,
          true
        );
      }
    });

    layer.on("mouseout", () => {
      this.clearCoordinateSample(context);
    });
  }

  private isNumberArrayWithLength(value: unknown, length: number): value is number[] {
    return (
      Array.isArray(value) &&
      value.length === length &&
      value.every((item) => typeof item === "number" && Number.isFinite(item))
    );
  }

  private createSampleAxis(length: number): number[] {
    return Array.from({ length }, (_, index) => index);
  }

  private buildGraphDatasetFromFeature(feature: GeoJsonFeatureLike): TrackGraphDataset | null {
    const geometry = feature.geometry;
    if (!isRecord(geometry) || geometry.type !== "LineString") {
      return null;
    }

    const coordinates = geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return null;
    }

    const latLngs: L.LatLngExpression[] = coordinates
      .map((coordinate: unknown) => {
        if (!Array.isArray(coordinate) || coordinate.length < 2) {
          return null;
        }

        const lon = coordinate[0];
        const lat = coordinate[1];
        if (
          typeof lat !== "number" ||
          typeof lon !== "number" ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon)
        ) {
          return null;
        }

        return [lat, lon] as L.LatLngExpression;
      })
      .filter((value: L.LatLngExpression | null): value is L.LatLngExpression => value !== null);

    if (latLngs.length !== coordinates.length) {
      return null;
    }

    const props = getFeatureProperties(feature);
    const coordinateProperties = props.coordinateProperties;
    if (!isRecord(coordinateProperties)) {
      return null;
    }

    const length = coordinates.length;
    const xAxes: Partial<Record<TrackGraphXAxisKind, number[]>> = {
      sample: this.createSampleAxis(length),
    };

    const distances = coordinateProperties.distances;
    if (this.isNumberArrayWithLength(distances, length)) {
      xAxes.distance = distances;
    }

    const times = coordinateProperties.times;
    if (this.isNumberArrayWithLength(times, length)) {
      xAxes.time = times;
    }

    const series: TrackGraphSeries[] = [];
    TRACK_GRAPH_SERIES_ORDER.forEach((key) => {
      const values = coordinateProperties[key];
      if (this.isNumberArrayWithLength(values, length)) {
        series.push({
          name: key,
          values,
        });
      }
    });

    Object.keys(coordinateProperties).forEach((key) => {
      if (
        key === "distances" ||
        key === "times" ||
        TRACK_GRAPH_SERIES_ORDER_SET.has(key)
      ) {
        return;
      }

      const values = coordinateProperties[key];
      if (this.isNumberArrayWithLength(values, length)) {
        series.push({
          name: key,
          values,
        });
      }
    });

    if (series.length === 0) {
      return null;
    }

    const defaultXAxis: TrackGraphXAxisKind = xAxes.distance
      ? "distance"
      : xAxes.time
      ? "time"
      : "sample";

    return {
      xAxes,
      defaultXAxis,
      series,
      latLngs,
      coordinateProperties,
    };
  }

  private formatXAxisLabel(kind: TrackGraphXAxisKind, value: number): string {
    if (kind === "distance") {
      return `${(value / 1000).toFixed(2)} km`;
    }

    if (kind === "time") {
      return this.formatLocalTime(value) || "";
    }

    return `${Math.round(value)}`;
  }

  private formatGraphYValue(seriesName: string, value: number): string {
    if (seriesName === "altitudes") {
      return `${value.toFixed(1)} m`;
    }

    if (seriesName === "heartRates") {
      return `${value.toFixed(0)} bpm`;
    }

    if (seriesName === "cadences") {
      return `${value.toFixed(0)} rpm`;
    }

    if (seriesName === "powers") {
      return `${value.toFixed(0)} W`;
    }

    if (seriesName === "speeds") {
      return `${value.toFixed(1)} km/h`;
    }

    if (
      seriesName === "torqueEffectivenessPercentage" ||
      seriesName === "pedalSmoothnessPercentage"
    ) {
      return `${value.toFixed(1)} %`;
    }

    return `${value.toFixed(1)}`;
  }

  private formatGraphYTickLabel(seriesName: string, value: number): string {
    const roundedValue = Math.round(value);

    if (seriesName === "altitudes") {
      return `${roundedValue} m`;
    }

    if (seriesName === "heartRates") {
      return `${roundedValue} bpm`;
    }

    if (seriesName === "cadences") {
      return `${roundedValue} rpm`;
    }

    if (seriesName === "powers") {
      return `${roundedValue} W`;
    }

    if (seriesName === "speeds") {
      return `${roundedValue} km/h`;
    }

    if (
      seriesName === "torqueEffectivenessPercentage" ||
      seriesName === "pedalSmoothnessPercentage"
    ) {
      return `${roundedValue} %`;
    }

    return `${roundedValue}`;
  }

  private usesZeroGraphYMin(seriesName: string): boolean {
    return (
      seriesName === "altitudes" ||
      seriesName === "heartRates" ||
      seriesName === "cadences" ||
      seriesName === "powers" ||
      seriesName === "speeds" ||
      seriesName === "torqueEffectivenessPercentage" ||
      seriesName === "pedalSmoothnessPercentage"
    );
  }

  private normalizeGraphSmoothingWindow(value: unknown): TrackGraphSmoothingWindow {
    const numberValue = typeof value === "number" ? value : Number(value);
    if (TRACK_GRAPH_SMOOTHING_WINDOWS.includes(
      numberValue as TrackGraphSmoothingWindow
    )) {
      return numberValue as TrackGraphSmoothingWindow;
    }

    return 1;
  }

  private smoothCenteredMovingAverage(
    values: number[],
    windowSize: TrackGraphSmoothingWindow
  ): number[] {
    if (windowSize <= 1 || values.length <= 2) {
      return values;
    }

    const half = Math.floor(windowSize / 2);
    const sums: number[] = [0];

    values.forEach((value) => {
      const previous = sums[sums.length - 1] ?? 0;
      sums.push(previous + value);
    });

    return values.map((_, index) => {
      const start = Math.max(0, index - half);
      const end = Math.min(values.length, index + half + 1);
      const startSum = sums[start] ?? 0;
      const endSum = sums[end] ?? 0;
      return (endSum - startSum) / (end - start);
    });
  }

  private createNiceTicks(min: number, max: number, targetCount: number): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max) || targetCount <= 0) {
      return [];
    }

    if (min === max) {
      return [min];
    }

    const span = max - min;
    const rawStep = span / Math.max(1, targetCount - 1);
    const step = this.niceStep(rawStep);
    const start = Math.ceil(min / step) * step;
    const end = Math.floor(max / step) * step;
    const ticks: number[] = [];

    for (let value = start; value <= end + step * 0.5; value += step) {
      ticks.push(this.roundTickValue(value));
      if (ticks.length > 100) {
        break;
      }
    }

    if (ticks.length === 0) {
      return [min, max];
    }

    return ticks;
  }

  private niceStep(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 1;
    }

    const exponent = Math.floor(Math.log10(value));
    const base = 10 ** exponent;
    const fraction = value / base;

    let niceFraction: number;
    if (fraction <= 1) {
      niceFraction = 1;
    } else if (fraction <= 2) {
      niceFraction = 2;
    } else if (fraction <= 5) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }

    return niceFraction * base;
  }

  private roundTickValue(value: number): number {
    if (!Number.isFinite(value)) {
      return value;
    }

    const absValue = Math.abs(value);
    if (absValue >= 1000) {
      return Math.round(value);
    }

    if (absValue >= 10) {
      return Math.round(value * 10) / 10;
    }

    return Math.round(value * 100) / 100;
  }

  private formatXAxisTickLabel(
    kind: TrackGraphXAxisKind,
    value: number,
    min: number,
    max: number
  ): string {
    if (kind === "distance") {
      return `${Math.round(value / 1000)} km`;
    }

    if (kind === "time") {
      const millis = value > 100000000000 ? value : value * 1000;
      const date = new Date(millis);
      if (Number.isNaN(date.getTime())) {
        return "";
      }

      const minMillis = min > 100000000000 ? min : min * 1000;
      const maxMillis = max > 100000000000 ? max : max * 1000;
      const minDate = new Date(minMillis);
      const maxDate = new Date(maxMillis);

      const hh = date.getHours().toString().padStart(2, "0");
      const mi = date.getMinutes().toString().padStart(2, "0");

      if (
        !Number.isNaN(minDate.getTime()) &&
        !Number.isNaN(maxDate.getTime()) &&
        minDate.toDateString() !== maxDate.toDateString()
      ) {
        const mm = (date.getMonth() + 1).toString().padStart(2, "0");
        const dd = date.getDate().toString().padStart(2, "0");
        return `${mm}/${dd} ${hh}:${mi}`;
      }

      return `${hh}:${mi}`;
    }

    return `${Math.round(value)}`;
  }

  private decorateGraphSelect(select: HTMLSelectElement) {
    select.className = "stgy-track-graph-select";
    select.style.backgroundColor = "#f8fafc";
    select.style.border = "1px solid #cbd5e1";
    select.style.borderRadius = "4px";
    select.style.padding = "2px 6px";
    select.style.color = "#1f2937";
  }

  private renderGraphPanel(
    panel: HTMLElement,
    context: CoordinateInteractionContext,
    dataset: TrackGraphDataset,
    selectedXAxis: TrackGraphXAxisKind = dataset.defaultXAxis,
    selectedSeriesName: string = dataset.series[0].name,
    selectedSmoothingWindow: TrackGraphSmoothingWindow = 1
  ) {
    const xValues = dataset.xAxes[selectedXAxis] || dataset.xAxes.sample;
    const series = dataset.series.find((item) => item.name === selectedSeriesName) ||
      dataset.series[0];
    const smoothingWindow = this.normalizeGraphSmoothingWindow(selectedSmoothingWindow);

    context.graphHoverState = null;

    if (!xValues || !series || xValues.length !== series.values.length || xValues.length === 0) {
      panel.hidden = true;
      if (context.graphRestoreButton) {
        context.graphRestoreButton.hidden = true;
      }
      return;
    }

    const displayValues = this.smoothCenteredMovingAverage(series.values, smoothingWindow);

    panel.hidden = context.graphCollapsed;
    if (context.graphRestoreButton) {
      context.graphRestoreButton.hidden = !context.graphCollapsed;
    }
    panel.replaceChildren();

    const controls = document.createElement("div");
    controls.className = "stgy-track-graph-controls";

    if (dataset.series.length > 1) {
      const seriesSelect = document.createElement("select");
      seriesSelect.setAttribute("aria-label", "Graph series");
      this.decorateGraphSelect(seriesSelect);

      dataset.series.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.name;
        option.textContent = this.formatGraphSeriesLabel(item.name);
        option.selected = item.name === series.name;
        seriesSelect.appendChild(option);
      });

      seriesSelect.addEventListener("change", () => {
        this.renderGraphPanel(
          panel,
          context,
          dataset,
          selectedXAxis,
          seriesSelect.value,
          smoothingWindow
        );
      });

      controls.appendChild(seriesSelect);
    }

    const availableXAxisKinds: TrackGraphXAxisKind[] = [];
    if (dataset.xAxes.distance) {
      availableXAxisKinds.push("distance");
    }
    if (dataset.xAxes.time) {
      availableXAxisKinds.push("time");
    }
    availableXAxisKinds.push("sample");

    if (availableXAxisKinds.length > 1) {
      const axisSelect = document.createElement("select");
      axisSelect.setAttribute("aria-label", "Graph X axis");
      this.decorateGraphSelect(axisSelect);

      availableXAxisKinds.forEach((kind) => {
        const option = document.createElement("option");
        option.value = kind;
        option.textContent = TRACK_GRAPH_X_AXIS_LABELS[kind];
        option.selected = kind === selectedXAxis;
        axisSelect.appendChild(option);
      });

      axisSelect.addEventListener("change", () => {
        this.renderGraphPanel(
          panel,
          context,
          dataset,
          axisSelect.value as TrackGraphXAxisKind,
          series.name,
          smoothingWindow
        );
      });

      controls.appendChild(axisSelect);
    }

    const smoothingSelect = document.createElement("select");
    smoothingSelect.setAttribute("aria-label", "Graph smoothing");
    this.decorateGraphSelect(smoothingSelect);

    TRACK_GRAPH_SMOOTHING_WINDOWS.forEach((windowSize) => {
      const option = document.createElement("option");
      option.value = `${windowSize}`;
      option.textContent = windowSize === 1
        ? "Smoothing: none"
        : `Smoothing: ${windowSize}`;
      option.selected = windowSize === smoothingWindow;
      smoothingSelect.appendChild(option);
    });

    smoothingSelect.addEventListener("change", () => {
      this.renderGraphPanel(
        panel,
        context,
        dataset,
        selectedXAxis,
        series.name,
        this.normalizeGraphSmoothingWindow(smoothingSelect.value)
      );
    });

    controls.appendChild(smoothingSelect);

    const readout = document.createElement("div");
    readout.className = "stgy-track-graph-readout";
    readout.textContent = "";
    controls.appendChild(readout);

    const collapseButton = this.createGraphToggleButton("close", "Collapse graph");
    collapseButton.classList.add("stgy-track-graph-collapse");
    collapseButton.addEventListener("click", () => {
      this.setGraphCollapsed(context, true);
    });
    controls.appendChild(collapseButton);

    panel.appendChild(controls);

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute(
      "viewBox",
      `0 0 ${TRACK_GRAPH_VIEWBOX_WIDTH} ${TRACK_GRAPH_VIEWBOX_HEIGHT}`
    );
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${this.formatGraphSeriesLabel(series.name)} graph`);

    const plotLeft = 52;
    const plotRight = 780;
    const plotTop = 16;
    const plotBottom = 140;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    const xRange = getFiniteNumberRange(xValues);
    const yRange = getFiniteNumberRange(displayValues);
    if (!xRange || !yRange) {
      return panel;
    }
    const xMin = xRange.min;
    const xMax = xRange.max;
    const rawYMin = yRange.min;
    const rawYMax = yRange.max;
    const useZeroYMin = this.usesZeroGraphYMin(series.name);
    const baseYMin = useZeroYMin ? 0 : rawYMin;
    const yPadding = !useZeroYMin && baseYMin === rawYMax
      ? Math.max(Math.abs(baseYMin) * 0.1, 1)
      : 0;
    const yMin = useZeroYMin ? 0 : baseYMin - yPadding;
    const yMax = rawYMax <= yMin
      ? yMin + Math.max(Math.abs(yMin) * 0.1, 1)
      : rawYMax + yPadding;

    const xScale = (value: number): number => {
      if (xMax === xMin) {
        return plotLeft + plotWidth / 2;
      }
      return plotLeft + ((value - xMin) / (xMax - xMin)) * plotWidth;
    };

    const yScale = (value: number): number => {
      if (yMax === yMin) {
        return plotTop + plotHeight / 2;
      }
      return plotBottom - ((value - yMin) / (yMax - yMin)) * plotHeight;
    };

    const scaledXValues = xValues.map((x) => xScale(x));
    const xTicks = this.createNiceTicks(xMin, xMax, TARGET_GRAPH_X_TICKS);
    const yTicks = this.createNiceTicks(yMin, yMax, TARGET_GRAPH_Y_TICKS);

    yTicks.forEach((tick) => {
      const y = yScale(tick);

      const grid = document.createElementNS(svgNs, "line");
      grid.setAttribute("class", "stgy-track-graph-y-grid");
      grid.setAttribute("x1", `${plotLeft}`);
      grid.setAttribute("x2", `${plotRight}`);
      grid.setAttribute("y1", `${y}`);
      grid.setAttribute("y2", `${y}`);
      svg.appendChild(grid);

      const label = document.createElementNS(svgNs, "text");
      label.setAttribute("class", "stgy-track-graph-tick-label");
      label.setAttribute("x", "8");
      label.setAttribute("y", `${y + 3}`);
      label.textContent = this.formatGraphYTickLabel(series.name, tick);
      svg.appendChild(label);
    });

    xTicks.forEach((tick) => {
      const x = xScale(tick);

      const label = document.createElementNS(svgNs, "text");
      label.setAttribute("class", "stgy-track-graph-tick-label");
      label.setAttribute("x", `${x}`);
      label.setAttribute("y", "168");
      label.setAttribute("text-anchor", "middle");
      label.textContent = this.formatXAxisTickLabel(selectedXAxis, tick, xMin, xMax);
      svg.appendChild(label);
    });

    const axis = document.createElementNS(svgNs, "path");
    axis.setAttribute("class", "stgy-track-graph-axis");
    axis.setAttribute(
      "d",
      `M ${plotLeft} ${plotTop} L ${plotLeft} ${plotBottom} L ${plotRight} ${plotBottom}`
    );
    svg.appendChild(axis);

    const line = document.createElementNS(svgNs, "polyline");
    line.setAttribute("class", "stgy-track-graph-line");
    line.setAttribute(
      "points",
      xValues.map((x, index) => {
        return `${xScale(x)},${yScale(displayValues[index])}`;
      }).join(" ")
    );
    svg.appendChild(line);

    const hoverLine = document.createElementNS(svgNs, "line");
    hoverLine.setAttribute("class", "stgy-track-graph-hover-line");
    hoverLine.setAttribute("y1", `${plotTop}`);
    hoverLine.setAttribute("y2", `${plotBottom}`);
    hoverLine.setAttribute("stroke-dasharray", "4 4");
    hoverLine.setAttribute("visibility", "hidden");
    svg.appendChild(hoverLine);

    const hoverPoint = document.createElementNS(svgNs, "circle");
    hoverPoint.setAttribute("class", "stgy-track-graph-hover-point");
    hoverPoint.setAttribute("r", "4");
    hoverPoint.setAttribute("visibility", "hidden");
    svg.appendChild(hoverPoint);

    context.graphHoverState = {
      dataset,
      selectedXAxis,
      series,
      xValues,
      displayValues,
      scaledXValues,
      yScale,
      hoverLine,
      hoverPoint,
      readout,
    };

    const activateGraphSampleFromClientX = (clientX: number, pinned = false) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const viewBoxX = this.graphClientXToViewBoxX(rect, clientX);
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      scaledXValues.forEach((scaledX, index) => {
        const distance = Math.abs(scaledX - viewBoxX);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      this.activateCoordinateSample(
        context,
        dataset.latLngs[nearestIndex],
        dataset.coordinateProperties,
        nearestIndex,
        pinned
      );
    };

    svg.addEventListener("mousemove", (event) => {
      activateGraphSampleFromClientX(event.clientX, false);
    });

    svg.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      activateGraphSampleFromClientX(event.clientX, true);
    });

    svg.addEventListener("pointermove", (event) => {
      if (event.buttons === 0) {
        return;
      }

      event.preventDefault();
      activateGraphSampleFromClientX(event.clientX, true);
    });

    svg.addEventListener("mouseleave", () => {
      this.clearCoordinateSample(context);
    });

    panel.appendChild(svg);
  }

  private graphClientXToViewBoxX(rect: DOMRect, clientX: number): number {
    const scale = Math.min(
      rect.width / TRACK_GRAPH_VIEWBOX_WIDTH,
      rect.height / TRACK_GRAPH_VIEWBOX_HEIGHT
    );
    if (!Number.isFinite(scale) || scale <= 0) {
      return 0;
    }

    const renderedWidth = TRACK_GRAPH_VIEWBOX_WIDTH * scale;
    const renderedLeft = rect.left + (rect.width - renderedWidth) / 2;
    const viewBoxX = (clientX - renderedLeft) / scale;
    return Math.max(0, Math.min(TRACK_GRAPH_VIEWBOX_WIDTH, viewBoxX));
  }

  private createGeoJsonLayer(
    map: L.Map,
    geoJsonData: unknown,
    context: CoordinateInteractionContext,
    pinScale: number,
  ): L.GeoJSON {
    return L.geoJSON(asGeoJsonInput(geoJsonData), {
      style: (feature) => this.getFeaturePathStyle(feature),
      pointToLayer: (feature, latlng) => {
        const props = getFeatureProperties(feature);
        const markerOptions: L.MarkerOptions = {
          icon: createDefaultPinIcon(pinScale),
        };
        const pinColor = normalizeMapColor(props.color);
        if (pinColor) {
          markerOptions.icon = createCustomPinIcon(pinColor, pinScale);
        }
        return L.marker(latlng, markerOptions);
      },
      onEachFeature: (feature, layer) => {
        if (
          feature?.geometry?.type === "Point" ||
          feature?.geometry?.type === "MultiPoint"
        ) {
          const props = getFeatureProperties(feature);
          const popupElement = this.buildPopupElementFromProps(props);

          if (popupElement) {
            const mapContainer = map.getContainer();
            const mapWidth = mapContainer.clientWidth;
            const mapHeight = mapContainer.clientHeight;

            const widthPct = Math.max(1, Math.min(99, getFiniteNumber(props.popupWidth, 33)));
            const heightPct = Math.max(1, Math.min(99, getFiniteNumber(props.popupHeight, 33)));

            const maxWidth = mapWidth * (widthPct / 100);
            const popupMaxHeight = mapHeight * (heightPct / 100);
            const minWidth = Math.min(150, maxWidth * 0.5);

            layer.bindPopup(popupElement, {
              maxWidth: maxWidth,
              minWidth: minWidth,
              maxHeight: popupMaxHeight,
              className: "stgy-track-popup"
            });
          }
        }

        this.bindCoordinateInteractions(feature, layer, context);
        this.registerGraphDatasetForLayer(feature, layer, context);
      }
    });
  }

  private getGeoJsonCenter(geoJsonData: unknown): L.LatLng | null {
    const layer = L.geoJSON(asGeoJsonInput(geoJsonData));
    const bounds = layer.getBounds();
    if (!bounds.isValid()) {
      return null;
    }
    return bounds.getCenter();
  }

  private async loadTrackData(href: string, cache: Record<string, unknown>): Promise<unknown> {
    if (Object.prototype.hasOwnProperty.call(cache, href)) {
      return cache[href];
    }
    const data = await this.loader.load(href);
    cache[href] = data;
    return data;
  }

  private dispatchTrackDataLoaded(
    figure: HTMLElement,
    source: string,
    data: unknown
  ) {
    figure.dispatchEvent(new CustomEvent(STGY_TRACK_DATA_LOADED_EVENT, {
      bubbles: true,
      detail: { source, data },
    }));
  }

  private renderTrackAsPin(
    map: L.Map,
    layerGroup: L.FeatureGroup,
    geoJsonData: unknown,
    label: string,
    context: CoordinateInteractionContext,
    pinScale: number,
  ) {
    const center = this.getGeoJsonCenter(geoJsonData);
    if (!center) {
      return;
    }

    const marker = L.marker(center, {
      icon: createDefaultPinIcon(pinScale),
    });
    if (label) {
      const popupElement = document.createElement("div");
      const title = document.createElement("div");
      title.className = "annot-title";
      title.textContent = label;
      popupElement.appendChild(title);
      marker.bindPopup(popupElement);
    }

    let routeLayer: L.GeoJSON | null = null;
    marker.on("click", () => {
      if (!routeLayer) {
        routeLayer = this.createGeoJsonLayer(map, geoJsonData, context, pinScale);
      }
      if (layerGroup.hasLayer(routeLayer)) {
        layerGroup.removeLayer(routeLayer);
      } else {
        layerGroup.addLayer(routeLayer);
      }
    });

    layerGroup.addLayer(marker);
  }

  private async initMap(figure: HTMLElement) {
    if (figure.dataset.stgyTrackInitialized) return;

    const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
    if (!canvas) {
      this.showError(figure, "Track map canvas was not found.");
      return;
    }

    this.createDownloadActions(figure);

    const showOverlay = figure.dataset.showOverlay !== "false";
    const showGraph = figure.dataset.showGraph !== "false";
    const controls = figure.dataset.controls !== "false";
    const lthrBpm = parsePositiveDatasetNumber(figure.dataset.lthrBpm);
    const ftpW = parsePositiveDatasetNumber(figure.dataset.ftpW);
    const graphPanel = showGraph ? this.createGraphPanel(figure) : null;
    if (!showGraph) {
      this.removeGraphPanel(figure);
    }

    const hasExplicitLat = typeof figure.dataset.lat !== "undefined";
    const hasExplicitLon = typeof figure.dataset.lon !== "undefined";
    const hasExplicitZoom = typeof figure.dataset.zoom !== "undefined";

    let lat = parseFloat(figure.dataset.lat || "0");
    let lon = parseFloat(figure.dataset.lon || "0");
    const zoom = parseInt(figure.dataset.zoom || "13", 10);

    const dataSrc = figure.getAttribute("data-src")?.trim();
    const sourceLinks = dataSrc
      ? []
      : Array.from(figure.querySelectorAll<HTMLAnchorElement>(".stgy-track-sources a.track-source"));
    const trackDataCache: Record<string, unknown> = {};
    const preloadedTracks: PreloadedTrackData[] = [];
    const viewBounds = this.createBoundsAccumulator();
    const routeViewBounds = this.createBoundsAccumulator();
    const pinViewBounds = this.createBoundsAccumulator();

    const inlinePins = figure.querySelectorAll<HTMLElement>(".stgy-track-pins li");
    let pinCount = 0;
    inlinePins.forEach((pin) => {
      const pinLat = parseFloat(pin.dataset.lat || "0");
      const pinLon = parseFloat(pin.dataset.lon || "0");
      if (pinLat !== 0 || pinLon !== 0) {
        pinCount += 1;
        this.extendBoundsWithLatLng(viewBounds, pinLat, pinLon);
        this.extendBoundsWithLatLng(pinViewBounds, pinLat, pinLon);
      }
    });

    if (dataSrc) {
      try {
        const preloadedTrackData = await this.loadTrackData(dataSrc, trackDataCache);
        preloadedTracks.push({ source: dataSrc, data: preloadedTrackData });
        pinCount += countGeoJsonPins(preloadedTrackData);
        this.extendBoundsWithGeoJson(viewBounds, preloadedTrackData);
        this.extendTypedBoundsWithGeoJson(
          routeViewBounds,
          pinViewBounds,
          preloadedTrackData,
        );
      } catch (e) {
        this.showError(figure, this.toUserErrorMessage(e));
        return;
      }
    } else {
      for (const link of sourceLinks) {
        const href = link.getAttribute("href")?.trim() || "";
        if (!href) {
          continue;
        }

        try {
          const preloadedTrackData = await this.loadTrackData(href, trackDataCache);
          preloadedTracks.push({ source: href, data: preloadedTrackData });
          if (link.dataset.render === "pin") {
            const center = this.getGeoJsonCenter(preloadedTrackData);
            if (center) {
              pinCount += 1;
              this.extendBoundsWithLatLng(viewBounds, center.lat, center.lng);
              this.extendBoundsWithLatLng(pinViewBounds, center.lat, center.lng);
            }
          } else {
            pinCount += countGeoJsonPins(preloadedTrackData);
            this.extendBoundsWithGeoJson(viewBounds, preloadedTrackData);
            this.extendTypedBoundsWithGeoJson(
              routeViewBounds,
              pinViewBounds,
              preloadedTrackData,
            );
          }
        } catch (e) {
          this.showError(figure, this.toUserErrorMessage(e));
          return;
        }
      }
    }

    const pinScale = getPinScale(pinCount);

    if (!hasExplicitLat || !hasExplicitLon) {
      const center = this.getBoundsCenter(viewBounds);
      if (center) {
        lat = center.lat;
        lon = center.lng;
      }
    }

    const isJp = isJapan(lat, lon);

    const gsiPale = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", { attribution: '&copy; GSI Japan', maxNativeZoom: 18, maxZoom: 20 });
    const gsiStd = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { attribution: '&copy; GSI Japan', maxNativeZoom: 18, maxZoom: 20 });
    const gsiPhoto = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { attribution: '&copy; GSI Japan', maxNativeZoom: 18, maxZoom: 20 });
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; OpenStreetMap', maxNativeZoom: 19, maxZoom: 20 });
    const cyclosm = L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", { attribution: '&copy; CyclOSM', maxNativeZoom: 20, maxZoom: 20 });
    const opentopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { attribution: '&copy; OpenTopoMap', maxNativeZoom: 17, maxZoom: 20 });

    const baseLayerDefinitions: BaseLayerDefinition[] = [
      { key: "gsi-pale", label: "GSI Pale", layer: gsiPale, japanOnly: true },
      { key: "gsi-standard", label: "GSI Standard", layer: gsiStd, japanOnly: true },
      { key: "gsi-photo", label: "GSI Photo", layer: gsiPhoto, japanOnly: true },
      { key: "cyclosm", label: "CyclOSM", layer: cyclosm },
      { key: "openstreetmap", label: "OpenStreetMap", layer: osm },
      { key: "opentopomap", label: "OpenTopoMap", layer: opentopo },
    ];
    const requestedBaseLayerKey = this.normalizeBaseLayerKey(figure.dataset.baseLayer);
    const { baseMaps, defaultLayer } = this.createBaseMaps(
      baseLayerDefinitions,
      isJp,
      requestedBaseLayerKey
    );

    const map = L.map(canvas, {
      center: [lat, lon],
      zoom: zoom,
      layers: [defaultLayer],
      scrollWheelZoom: false,
      zoomControl: controls,
    });

    trackMapsByCanvas.set(canvas, map);

    this.removeMetadataOverlay(figure);
    const metadataText = this.buildMetadataOverlayText(preloadedTracks);
    const metadataOverlay = metadataText
      ? this.createMetadataOverlay(canvas, metadataText)
      : null;

    this.removeAnalysisOverlay(figure);
    const analysisSections = this.buildAnalysisOverlaySections(preloadedTracks, {
      lthrBpm,
      ftpW,
    });
    const analysisOverlay = analysisSections.length > 0
      ? this.createAnalysisOverlay(canvas, analysisSections)
      : null;

    this.removeGraphRestoreButton(figure);
    const graphRestoreButton = showGraph
      ? this.createGraphToggleButton("graph", "Show graph")
      : null;
    if (graphRestoreButton) {
      graphRestoreButton.classList.add("stgy-track-graph-restore");
      graphRestoreButton.hidden = true;
      canvas.appendChild(graphRestoreButton);
    }

    if (controls) {
      const layerControl = L.control.layers(baseMaps);
      layerControl.addTo(map);
      if (metadataOverlay) {
        this.addMetadataControlAction(layerControl, metadataOverlay);
      }
      if (analysisOverlay) {
        this.addAnalysisControlAction(layerControl, analysisOverlay);
      }
    }

    const hud = showOverlay ? this.createHud(canvas) : null;
    const markerState: CoordinateMarkerState = { marker: null };
    const interactionContext: CoordinateInteractionContext = {
      map,
      hud,
      markerState,
      graphPanel,
      graphRestoreButton,
      graphCollapsed: false,
      graphHoverState: null,
      routeDatasetByLayer: new WeakMap<L.Layer, TrackGraphDataset>(),
      routeStyleByLayer: new WeakMap<L.Layer, L.PathOptions>(),
      activeGraphDataset: null,
      activeGraphLayer: null,
      pinnedSample: null,
      ignoreNextMapClick: false,
    };

    if (graphRestoreButton) {
      L.DomEvent.disableClickPropagation(graphRestoreButton);
      graphRestoreButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.setGraphCollapsed(interactionContext, false);
      });
    }

    map.on("contextmenu", (event: L.LeafletMouseEvent) => {
      const popupContent = document.createElement("span");
      popupContent.className = "stgy-track-coordinate-popup";

      const coordinateText = document.createElement("span");
      coordinateText.className = "stgy-track-coordinate-popup-text";
      coordinateText.textContent = formatCoordinatePopupText(
        event.latlng.lat,
        event.latlng.lng,
      );
      popupContent.appendChild(coordinateText);
      popupContent.appendChild(
        createCoordinateCopyButton(
          formatMapCoordinateCopyText(event.latlng.lat, event.latlng.lng),
        ),
      );
      L.DomEvent.disableClickPropagation(popupContent);

      L.popup({
        closeButton: false,
        closeOnClick: true,
      })
        .setLatLng(event.latlng)
        .setContent(popupContent)
        .openOn(map);
    });

    map.on("click", () => {
      if (interactionContext.ignoreNextMapClick) {
        interactionContext.ignoreNextMapClick = false;
        return;
      }

      this.clearCoordinateSample(interactionContext, true);
    });

    const masterGroup = L.featureGroup().addTo(map);

    if (inlinePins.length > 0) {
      this.renderInlinePins(map, masterGroup, inlinePins, pinScale);
    }

    if (dataSrc) {
      try {
        const geoJsonData = await this.loadTrackData(dataSrc, trackDataCache);
        const geoJsonLayer = this.createGeoJsonLayer(
          map,
          geoJsonData,
          interactionContext,
          pinScale,
        );
        masterGroup.addLayer(geoJsonLayer);
      } catch (e) {
        this.showError(figure, this.toUserErrorMessage(e));
        return;
      }
    } else if (sourceLinks.length > 0) {
      const trackPromises = sourceLinks.map(async (link) => {
        const href = link.getAttribute("href")?.trim() || "";
        if (!href) {
          return;
        }

        try {
          const geoJsonData = await this.loadTrackData(href, trackDataCache);
          if (link.dataset.render === "pin") {
            this.renderTrackAsPin(
              map,
              masterGroup,
              geoJsonData,
              link.textContent?.trim() || "",
              interactionContext,
              pinScale,
            );
          } else {
            const geoJsonLayer = this.createGeoJsonLayer(
              map,
              geoJsonData,
              interactionContext,
              pinScale,
            );
            masterGroup.addLayer(geoJsonLayer);
          }
        } catch (e) {
          this.showError(figure, this.toUserErrorMessage(e));
        }
      });

      await Promise.all(trackPromises);
    }

    const invalidateSize = (map as unknown as { invalidateSize?: () => void }).invalidateSize;
    if (invalidateSize) {
      invalidateSize.call(map);
    }

    const accumulatedBounds = this.toLeafletBounds(viewBounds);
    const bounds = accumulatedBounds && accumulatedBounds.isValid()
      ? accumulatedBounds
      : masterGroup.getBounds();

    if (bounds.isValid()) {
      if (!hasExplicitZoom) {
        const southWest = bounds.getSouthWest();
        const northEast = bounds.getNorthEast();
        if (southWest.lat === northEast.lat && southWest.lng === northEast.lng) {
          map.setView(bounds.getCenter(), DEFAULT_SINGLE_POINT_ZOOM, {
            animate: false,
          });
        } else {
          const autoViewBounds: AutoViewBounds[] = [];
          const routeBounds = this.toLeafletBounds(routeViewBounds);
          const pinBounds = this.toLeafletBounds(pinViewBounds);

          if (routeBounds?.isValid()) {
            autoViewBounds.push({
              bounds: routeBounds,
              paddingRatio: ROUTE_VIEW_PADDING_RATIO,
            });
          }
          if (pinBounds?.isValid()) {
            autoViewBounds.push({
              bounds: pinBounds,
              paddingRatio: PIN_VIEW_PADDING_RATIO,
            });
          }
          if (autoViewBounds.length === 0) {
            autoViewBounds.push({
              bounds,
              paddingRatio: ROUTE_VIEW_PADDING_RATIO,
            });
          }

          const autoView = this.getAutoMapView(map, autoViewBounds);
          if (autoView) {
            map.setView(autoView.center, autoView.zoom, { animate: false });
          }
        }
      } else if (!hasExplicitLat || !hasExplicitLon) {
        map.setView(bounds.getCenter(), zoom, { animate: false });
      }
    }

    Object.entries(trackDataCache).forEach(([source, data]) => {
      this.dispatchTrackDataLoaded(figure, source, data);
    });

    figure.dataset.stgyTrackInitialized = "true";
  }

  private renderInlinePins(
    map: L.Map,
    layerGroup: L.FeatureGroup,
    pins: NodeListOf<HTMLElement>,
    pinScale: number,
  ) {
    const mapContainer = map.getContainer();
    const mapWidth = mapContainer.clientWidth;
    const mapHeight = mapContainer.clientHeight;

    pins.forEach((li) => {
      const lat = parseFloat(li.dataset.lat || "0");
      const lon = parseFloat(li.dataset.lon || "0");
      if (lat === 0 && lon === 0) return;

      const widthPctStr = li.dataset.popupWidth || "33";
      const heightPctStr = li.dataset.popupHeight || "33";
      const widthPct = Math.max(1, Math.min(99, parseInt(widthPctStr, 10) || 33));
      const heightPct = Math.max(1, Math.min(99, parseInt(heightPctStr, 10) || 33));

      const maxWidth = mapWidth * (widthPct / 100);
      const popupMaxHeight = mapHeight * (heightPct / 100);
      const minWidth = Math.min(150, maxWidth * 0.5);

      const markerOptions: L.MarkerOptions = {
        icon: createDefaultPinIcon(pinScale),
      };
      const pinColor = normalizeMapColor(li.dataset.color);
      if (pinColor) {
        markerOptions.icon = createCustomPinIcon(pinColor, pinScale);
      }

      const marker = L.marker([lat, lon], markerOptions);
      const popupElement = this.buildPopupElementFromInlinePin(li);

      if (popupElement) {
        marker.bindPopup(popupElement, {
          maxWidth: maxWidth,
          minWidth: minWidth,
          maxHeight: popupMaxHeight,
          className: "stgy-track-popup"
        });
      }

      layerGroup.addLayer(marker);
    });
  }
}
