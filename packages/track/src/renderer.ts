import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./stgy-track.css";
import { isJapan } from "./geo";
import { TrackLoader } from "./loader";

const DEFAULT_PIN_COLOR = "#3388ff";
const DEFAULT_ROUTE_COLOR = "#0078A8";
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

const DEFAULT_SINGLE_POINT_ZOOM = 12;

type BoundsAccumulator = {
  hasValue: boolean;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

type CoordinateMarkerState = {
  marker: L.CircleMarker | null;
};

type TrackGraphXAxisKind = "distance" | "time" | "sample";

type TrackGraphSeries = {
  name: string;
  values: number[];
};

type TrackGraphDataset = {
  xAxes: Partial<Record<TrackGraphXAxisKind, number[]>>;
  defaultXAxis: TrackGraphXAxisKind;
  series: TrackGraphSeries[];
  latLngs: L.LatLngExpression[];
  coordinateProperties: any;
};

type SelectedCoordinateSample = {
  latLng: L.LatLngExpression;
  coordinateProperties: any;
  index: number;
};

type GraphHoverState = {
  dataset: TrackGraphDataset;
  selectedXAxis: TrackGraphXAxisKind;
  series: TrackGraphSeries;
  xValues: number[];
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
  graphHoverState: GraphHoverState | null;
  routeDatasetByLayer: WeakMap<L.Layer, TrackGraphDataset>;
  routeStyleByLayer: WeakMap<L.Layer, L.PathOptions>;
  activeGraphDataset: TrackGraphDataset | null;
  activeGraphLayer: L.Layer | null;
  pinnedSample: SelectedCoordinateSample | null;
};

type StyleableLayer = L.Layer & {
  setStyle?: (style: L.PathOptions) => unknown;
  bringToFront?: () => unknown;
};

const fixLeafletIcons = () => {
  const iconUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
  const iconRetinaUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png";
  const shadowUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

  delete (L.Marker.prototype as unknown as Record<string, unknown>)._getIconUrl;

  L.Marker.prototype.options.icon = L.icon({
    iconUrl,
    iconRetinaUrl,
    shadowUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
    shadowSize: [41, 41],
  });
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

const createCustomPinIcon = (color: string) => {
  const safeColor = normalizeMapColor(color) || DEFAULT_PIN_COLOR;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="25px" height="41px" style="filter: drop-shadow(2px 4px 2px rgba(0,0,0,0.3));">
      <path fill="${safeColor}" stroke="#ffffff" stroke-width="1.5" d="M12 0C5.373 0 0 5.373 0 12c0 8.442 11.373 23.36 11.706 23.784.144.184.364.288.594.288.23 0 .45-.104.594-.288C13.227 35.36 24 20.442 24 12 24 5.373 18.627 0 12 0zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/>
    </svg>`;

  return L.divIcon({
    className: "stgy-custom-pin",
    html: svg,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [0, -34],
  });
};

export class StgyTrackRenderer {
  private loader: TrackLoader;

  constructor() {
    fixLeafletIcons();
    this.loader = new TrackLoader();
  }

  public hydrate(rootElement: HTMLElement = document.body) {
    const figures = rootElement.querySelectorAll<HTMLElement>(".stgy-track-map");
    figures.forEach((figure) => this.initMap(figure));
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

  private extendBoundsWithGeoJson(bounds: BoundsAccumulator, geoJsonData: any) {
    const layer = L.geoJSON(geoJsonData);
    this.extendBoundsWithLeafletBounds(bounds, layer.getBounds());
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

  private removeGraphPanel(figure: HTMLElement) {
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
    figure.insertAdjacentElement("afterend", panel);
    return panel;
  }

  private normalizeSafeUrl(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const base = document.baseURI || window.location.href;
      const url = new URL(trimmed, base);
      if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
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

  private appendSafeImage(root: HTMLElement, srcValue: unknown, altValue?: unknown) {
    const src = this.normalizeSafeUrl(srcValue);
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

  private buildPopupElementFromProps(props: any): HTMLElement | null {
    const root = document.createElement("div");

    this.appendTextBlock(root, "annot-title", props.title);
    this.appendTextBlock(root, "annot-desc", props.description);

    if (Array.isArray(props.links)) {
      props.links.forEach((link: any) => {
        if (typeof link === "string") {
          this.appendSafeLink(root, link, link);
        } else if (link && typeof link === "object") {
          this.appendSafeLink(root, link.href, link.text);
        }
      });
    }

    if (Array.isArray(props.images)) {
      props.images.forEach((image: any) => {
        if (typeof image === "string") {
          this.appendSafeImage(root, image, "");
        } else if (image && typeof image === "object") {
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

  private getFeaturePathStyle(feature: any): L.PathOptions {
    const props = feature?.properties || {};
    const color = normalizeMapColor(props.color) || DEFAULT_ROUTE_COLOR;
    const weight = typeof props.weight === "number" && Number.isFinite(props.weight)
      ? props.weight
      : 4;
    const opacity = typeof props.opacity === "number" && Number.isFinite(props.opacity)
      ? props.opacity
      : 0.8;

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
    feature: any,
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

  private formatLocalTime(value: unknown): string | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }

    const millis = value > 100000000000 ? value : value * 1000;
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

  private formatHudLabel(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
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

  private renderHudItems(hud: HTMLElement, coordinateProperties: any, index: number): boolean {
    const list = document.createElement("ul");

    const time = this.formatLocalTime(coordinateProperties.times?.[index]);
    if (time) {
      this.appendHudItem(list, "times", time);
    }

    const distance = coordinateProperties.distances?.[index];
    if (typeof distance === "number" && Number.isFinite(distance)) {
      this.appendHudItem(list, "distances", `${(distance / 1000).toFixed(2)} km`);
    }

    const elevation = coordinateProperties.elevations?.[index];
    if (typeof elevation === "number" && Number.isFinite(elevation)) {
      this.appendHudItem(list, "elevations", `${Math.round(elevation)} m`);
    }

    const heartRate = coordinateProperties.heartRates?.[index];
    if (typeof heartRate === "number" && Number.isFinite(heartRate)) {
      this.appendHudItem(list, "heartRates", `${Math.round(heartRate)} bpm`);
    }

    const cadence = coordinateProperties.cadences?.[index];
    if (typeof cadence === "number" && Number.isFinite(cadence)) {
      this.appendHudItem(list, "cadences", `${Math.round(cadence)} rpm`);
    }

    const power = coordinateProperties.powers?.[index];
    if (typeof power === "number" && Number.isFinite(power)) {
      this.appendHudItem(list, "powers", `${Math.round(power)} W`);
    }

    const speed = coordinateProperties.speeds?.[index];
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
    coordinateProperties: any,
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

    if (index < 0 || index >= state.xValues.length || index >= state.series.values.length) {
      return;
    }

    const hoverX = state.scaledXValues[index];
    const hoverY = state.yScale(state.series.values[index]);

    state.hoverLine.setAttribute("x1", `${hoverX}`);
    state.hoverLine.setAttribute("x2", `${hoverX}`);
    state.hoverLine.removeAttribute("hidden");

    state.hoverPoint.setAttribute("cx", `${hoverX}`);
    state.hoverPoint.setAttribute("cy", `${hoverY}`);
    state.hoverPoint.removeAttribute("hidden");

    state.readout.textContent = `${this.formatXAxisLabel(state.selectedXAxis, state.xValues[index])} / ${this.formatGraphYValue(state.series.name, state.series.values[index])}`;
  }

  private clearGraphHover(context: CoordinateInteractionContext) {
    const state = context.graphHoverState;
    if (!state) {
      return;
    }

    state.hoverLine.setAttribute("hidden", "true");
    state.hoverPoint.setAttribute("hidden", "true");
    state.readout.textContent = "";
  }

  private renderCoordinateSample(
    context: CoordinateInteractionContext,
    latLng: L.LatLngExpression,
    coordinateProperties: any,
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
    coordinateProperties: any,
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

  private activateCoordinateSampleAtLatLng(
    context: CoordinateInteractionContext,
    coordinates: unknown,
    coordinateProperties: any,
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
    feature: any,
    layer: L.Layer,
    context: CoordinateInteractionContext
  ) {
    if (feature?.geometry?.type !== "LineString") {
      return;
    }

    const coordinates = feature.geometry.coordinates;
    const coordinateProperties = feature.properties?.coordinateProperties;
    if (!coordinateProperties || typeof coordinateProperties !== "object") {
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

  private buildGraphDatasetFromFeature(feature: any): TrackGraphDataset | null {
    if (feature?.geometry?.type !== "LineString") {
      return null;
    }

    const coordinates = feature.geometry.coordinates;
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

    const coordinateProperties = feature.properties?.coordinateProperties;
    if (!coordinateProperties || typeof coordinateProperties !== "object") {
      return null;
    }

    const length = coordinates.length;
    const xAxes: Partial<Record<TrackGraphXAxisKind, number[]>> = {
      sample: this.createSampleAxis(length),
    };

    if (this.isNumberArrayWithLength(coordinateProperties.distances, length)) {
      xAxes.distance = coordinateProperties.distances;
    }

    if (this.isNumberArrayWithLength(coordinateProperties.times, length)) {
      xAxes.time = coordinateProperties.times;
    }

    const series: TrackGraphSeries[] = [];
    Object.keys(coordinateProperties).forEach((key) => {
      if (key === "distances" || key === "times") {
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
    if (seriesName === "elevations") {
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

    return `${value.toFixed(1)}`;
  }

  private renderGraphPanel(
    panel: HTMLElement,
    context: CoordinateInteractionContext,
    dataset: TrackGraphDataset,
    selectedXAxis: TrackGraphXAxisKind = dataset.defaultXAxis,
    selectedSeriesName: string = dataset.series[0].name
  ) {
    const xValues = dataset.xAxes[selectedXAxis] || dataset.xAxes.sample;
    const series = dataset.series.find((item) => item.name === selectedSeriesName) || dataset.series[0];

    context.graphHoverState = null;

    if (!xValues || !series || xValues.length !== series.values.length || xValues.length === 0) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    panel.replaceChildren();

    const controls = document.createElement("div");
    controls.className = "stgy-track-graph-controls";

    if (dataset.series.length > 1) {
      const seriesSelect = document.createElement("select");
      seriesSelect.setAttribute("aria-label", "Graph series");

      dataset.series.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.name;
        option.textContent = this.formatHudLabel(item.name);
        option.selected = item.name === series.name;
        seriesSelect.appendChild(option);
      });

      seriesSelect.addEventListener("change", () => {
        this.renderGraphPanel(panel, context, dataset, selectedXAxis, seriesSelect.value);
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

      availableXAxisKinds.forEach((kind) => {
        const option = document.createElement("option");
        option.value = kind;
        option.textContent = kind;
        option.selected = kind === selectedXAxis;
        axisSelect.appendChild(option);
      });

      axisSelect.addEventListener("change", () => {
        this.renderGraphPanel(panel, context, dataset, axisSelect.value as TrackGraphXAxisKind, series.name);
      });

      controls.appendChild(axisSelect);
    }

    const readout = document.createElement("div");
    readout.className = "stgy-track-graph-readout";
    readout.textContent = "";
    controls.appendChild(readout);

    panel.appendChild(controls);

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 800 180");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${this.formatHudLabel(series.name)} graph`);

    const plotLeft = 52;
    const plotRight = 780;
    const plotTop = 16;
    const plotBottom = 140;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const rawYMin = Math.min(...series.values);
    const rawYMax = Math.max(...series.values);
    const yPadding = rawYMin === rawYMax ? Math.max(Math.abs(rawYMin) * 0.1, 1) : 0;
    const yMin = rawYMin - yPadding;
    const yMax = rawYMax + yPadding;

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

    const axis = document.createElementNS(svgNs, "path");
    axis.setAttribute("class", "stgy-track-graph-axis");
    axis.setAttribute("d", `M ${plotLeft} ${plotTop} L ${plotLeft} ${plotBottom} L ${plotRight} ${plotBottom}`);
    svg.appendChild(axis);

    const line = document.createElementNS(svgNs, "polyline");
    line.setAttribute("class", "stgy-track-graph-line");
    line.setAttribute(
      "points",
      xValues.map((x, index) => `${xScale(x)},${yScale(series.values[index])}`).join(" ")
    );
    svg.appendChild(line);

    const hoverLine = document.createElementNS(svgNs, "line");
    hoverLine.setAttribute("class", "stgy-track-graph-hover-line");
    hoverLine.setAttribute("y1", `${plotTop}`);
    hoverLine.setAttribute("y2", `${plotBottom}`);
    hoverLine.setAttribute("stroke-dasharray", "4 4");
    hoverLine.setAttribute("hidden", "true");
    svg.appendChild(hoverLine);

    const hoverPoint = document.createElementNS(svgNs, "circle");
    hoverPoint.setAttribute("class", "stgy-track-graph-hover-point");
    hoverPoint.setAttribute("r", "4");
    hoverPoint.setAttribute("hidden", "true");
    svg.appendChild(hoverPoint);

    const yMinLabel = document.createElementNS(svgNs, "text");
    yMinLabel.setAttribute("class", "stgy-track-graph-label");
    yMinLabel.setAttribute("x", "8");
    yMinLabel.setAttribute("y", `${plotBottom}`);
    yMinLabel.textContent = rawYMin.toFixed(1);
    svg.appendChild(yMinLabel);

    const yMaxLabel = document.createElementNS(svgNs, "text");
    yMaxLabel.setAttribute("class", "stgy-track-graph-label");
    yMaxLabel.setAttribute("x", "8");
    yMaxLabel.setAttribute("y", `${plotTop + 4}`);
    yMaxLabel.textContent = rawYMax.toFixed(1);
    svg.appendChild(yMaxLabel);

    const xMinLabel = document.createElementNS(svgNs, "text");
    xMinLabel.setAttribute("class", "stgy-track-graph-label");
    xMinLabel.setAttribute("x", `${plotLeft}`);
    xMinLabel.setAttribute("y", "168");
    xMinLabel.textContent = this.formatXAxisLabel(selectedXAxis, xMin);
    svg.appendChild(xMinLabel);

    const xMaxLabel = document.createElementNS(svgNs, "text");
    xMaxLabel.setAttribute("class", "stgy-track-graph-label stgy-track-graph-label-end");
    xMaxLabel.setAttribute("x", `${plotRight}`);
    xMaxLabel.setAttribute("y", "168");
    xMaxLabel.textContent = this.formatXAxisLabel(selectedXAxis, xMax);
    svg.appendChild(xMaxLabel);

    context.graphHoverState = {
      dataset,
      selectedXAxis,
      series,
      xValues,
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

      const viewBoxX = ((clientX - rect.left) / rect.width) * 800;
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

  private createGeoJsonLayer(
    map: L.Map,
    geoJsonData: any,
    context: CoordinateInteractionContext
  ): L.GeoJSON {
    return L.geoJSON(geoJsonData, {
      style: (feature) => this.getFeaturePathStyle(feature),
      pointToLayer: (feature, latlng) => {
        const props = feature.properties || {};
        const markerOptions: L.MarkerOptions = {};
        const pinColor = normalizeMapColor(props.color);
        if (pinColor) {
          markerOptions.icon = createCustomPinIcon(pinColor);
        }
        return L.marker(latlng, markerOptions);
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const popupElement = this.buildPopupElementFromProps(props);

        if (popupElement) {
          const mapContainer = map.getContainer();
          const mapWidth = mapContainer.clientWidth;
          const mapHeight = mapContainer.clientHeight;

          const widthPct = Math.max(1, Math.min(99, props.popupWidth || 33));
          const heightPct = Math.max(1, Math.min(99, props.popupHeight || 33));

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

        this.bindCoordinateInteractions(feature, layer, context);
        this.registerGraphDatasetForLayer(feature, layer, context);
      }
    });
  }

  private getGeoJsonCenter(geoJsonData: any): L.LatLng | null {
    const layer = L.geoJSON(geoJsonData);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) {
      return null;
    }
    return bounds.getCenter();
  }

  private async loadTrackData(href: string, cache: Record<string, any>): Promise<any> {
    if (Object.prototype.hasOwnProperty.call(cache, href)) {
      return cache[href];
    }
    const data = await this.loader.load(href);
    cache[href] = data;
    return data;
  }

  private renderTrackAsPin(
    map: L.Map,
    layerGroup: L.FeatureGroup,
    geoJsonData: any,
    label: string,
    context: CoordinateInteractionContext
  ) {
    const center = this.getGeoJsonCenter(geoJsonData);
    if (!center) {
      return;
    }

    const marker = L.marker(center);
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
        routeLayer = this.createGeoJsonLayer(map, geoJsonData, context);
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

    const showOverlay = figure.dataset.showOverlay !== "false";
    const showGraph = figure.dataset.showGraph !== "false";
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
    const trackDataCache: Record<string, any> = {};
    const viewBounds = this.createBoundsAccumulator();

    const inlinePins = figure.querySelectorAll<HTMLElement>(".stgy-track-pins li");
    inlinePins.forEach((pin) => {
      const pinLat = parseFloat(pin.dataset.lat || "0");
      const pinLon = parseFloat(pin.dataset.lon || "0");
      if (pinLat !== 0 || pinLon !== 0) {
        this.extendBoundsWithLatLng(viewBounds, pinLat, pinLon);
      }
    });

    if (dataSrc) {
      try {
        const preloadedTrackData = await this.loadTrackData(dataSrc, trackDataCache);
        this.extendBoundsWithGeoJson(viewBounds, preloadedTrackData);
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
          this.extendBoundsWithGeoJson(viewBounds, preloadedTrackData);
        } catch (e) {
          this.showError(figure, this.toUserErrorMessage(e));
          return;
        }
      }
    }

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

    const baseMaps: Record<string, L.TileLayer> = {};
    let defaultLayer: L.TileLayer;

    if (isJp) {
      baseMaps["GSI Pale"] = gsiPale;
      baseMaps["GSI Standard"] = gsiStd;
      baseMaps["GSI Photo"] = gsiPhoto;
      baseMaps["CyclOSM"] = cyclosm;
      baseMaps["OpenStreetMap"] = osm;
      baseMaps["OpenTopoMap"] = opentopo;
      defaultLayer = gsiPale;
    } else {
      baseMaps["CyclOSM"] = cyclosm;
      baseMaps["OpenStreetMap"] = osm;
      baseMaps["OpenTopoMap"] = opentopo;
      defaultLayer = cyclosm;
    }

    const map = L.map(canvas, {
      center: [lat, lon],
      zoom: zoom,
      layers: [defaultLayer],
      scrollWheelZoom: false,
    });

    L.control.layers(baseMaps).addTo(map);

    const hud = showOverlay ? this.createHud(canvas) : null;
    const markerState: CoordinateMarkerState = { marker: null };
    const interactionContext: CoordinateInteractionContext = {
      map,
      hud,
      markerState,
      graphPanel,
      graphHoverState: null,
      routeDatasetByLayer: new WeakMap<L.Layer, TrackGraphDataset>(),
      routeStyleByLayer: new WeakMap<L.Layer, L.PathOptions>(),
      activeGraphDataset: null,
      activeGraphLayer: null,
      pinnedSample: null,
    };

    const masterGroup = L.featureGroup().addTo(map);

    if (inlinePins.length > 0) {
      this.renderInlinePins(map, masterGroup, inlinePins);
    }

    if (dataSrc) {
      try {
        const geoJsonData = await this.loadTrackData(dataSrc, trackDataCache);
        const geoJsonLayer = this.createGeoJsonLayer(map, geoJsonData, interactionContext);
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
            this.renderTrackAsPin(map, masterGroup, geoJsonData, link.textContent?.trim() || "", interactionContext);
          } else {
            const geoJsonLayer = this.createGeoJsonLayer(map, geoJsonData, interactionContext);
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
          map.setView(bounds.getCenter(), DEFAULT_SINGLE_POINT_ZOOM);
        } else {
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      } else if (!hasExplicitLat || !hasExplicitLon) {
        map.setView(bounds.getCenter(), zoom);
      }
    }

    figure.dataset.stgyTrackInitialized = "true";
  }

  private renderInlinePins(map: L.Map, layerGroup: L.FeatureGroup, pins: NodeListOf<HTMLElement>) {
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

      const markerOptions: L.MarkerOptions = {};
      const pinColor = normalizeMapColor(li.dataset.color);
      if (pinColor) {
        markerOptions.icon = createCustomPinIcon(pinColor);
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
