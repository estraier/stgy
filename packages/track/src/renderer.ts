import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./stgy-track.css";
import { isJapan } from "./geo";
import { TrackLoader } from "./loader";

// --- Fix for Leaflet default icon path issues in bundlers ---
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

// --- SVG Custom Pin Icon Generator ---
const createCustomPinIcon = (color: string) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="25px" height="41px" style="filter: drop-shadow(2px 4px 2px rgba(0,0,0,0.3));">
      <path fill="${color}" stroke="#ffffff" stroke-width="1.5" d="M12 0C5.373 0 0 5.373 0 12c0 8.442 11.373 23.36 11.706 23.784.144.184.364.288.594.288.23 0 .45-.104.594-.288C13.227 35.36 24 20.442 24 12 24 5.373 18.627 0 12 0zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/>
    </svg>`;

  return L.divIcon({
    className: "stgy-custom-pin",
    html: svg,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [0, -34],
  });
};

// --- Helper: Build HTML string from GeoJSON properties ---
const buildPopupHtmlFromProps = (props: any): string => {
  let html = "";

  if (props.title) {
    html += `<div class="annot-title">${props.title}</div>`;
  }

  if (props.description) {
    html += `<div class="annot-desc">${props.description}</div>`;
  }

  if (Array.isArray(props.links)) {
    props.links.forEach((link: any) => {
      if (typeof link === "string") {
        html += `<div class="annot-link"><a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a></div>`;
      } else if (link && typeof link.href === "string") {
        const text = typeof link.text === "string" ? link.text : link.href;
        html += `<div class="annot-link"><a href="${link.href}" target="_blank" rel="noopener noreferrer">${text}</a></div>`;
      }
    });
  }

  if (Array.isArray(props.images)) {
    props.images.forEach((image: any) => {
      if (typeof image === "string") {
        html += `<div class="annot-image"><img src="${image}" alt=""></div>`;
      } else if (image && typeof image.src === "string") {
        const alt = typeof image.alt === "string" ? image.alt : "";
        html += `<div class="annot-image"><img src="${image.src}" alt="${alt}"></div>`;
      }
    });
  }

  return html;
};

const DEFAULT_SINGLE_POINT_ZOOM = 12;

type BoundsAccumulator = {
  hasValue: boolean;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
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

  private bindCoordinateHud(feature: any, layer: L.Layer, hud: HTMLElement) {
    if (feature?.geometry?.type !== "LineString") {
      return;
    }

    const coordinates = feature.geometry.coordinates;
    const coordinateProperties = feature.properties?.coordinateProperties;
    if (!coordinateProperties || typeof coordinateProperties !== "object") {
      return;
    }

    layer.on("mousemove", (event: L.LeafletMouseEvent) => {
      const index = this.findNearestCoordinateIndex(coordinates, event.latlng);
      if (index === null) {
        hud.hidden = true;
        return;
      }

      if (!this.renderHudItems(hud, coordinateProperties, index)) {
        hud.hidden = true;
        return;
      }

      hud.hidden = false;
    });

    layer.on("mouseout", () => {
      hud.hidden = true;
    });
  }

  private createGeoJsonLayer(map: L.Map, geoJsonData: any, hud: HTMLElement): L.GeoJSON {
    return L.geoJSON(geoJsonData, {
      // スタイル指定 (LineString, Polygon 等用)
      style: (feature) => {
        const props = feature?.properties || {};
        return {
          color: props.color || "#0078A8",
          weight: props.weight || 4,
          opacity: props.opacity || 0.8
        };
      },
      // Pointデータの描画をカスタムピンに差し替え
      pointToLayer: (feature, latlng) => {
        const props = feature.properties || {};
        const markerOptions: L.MarkerOptions = {};
        if (props.color) {
          markerOptions.icon = createCustomPinIcon(props.color);
        }
        return L.marker(latlng, markerOptions);
      },
      // 各要素（点や線）にポップアップをバインド
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const popupHtml = buildPopupHtmlFromProps(props);

        if (popupHtml) {
          const mapContainer = map.getContainer();
          const mapWidth = mapContainer.clientWidth;
          const mapHeight = mapContainer.clientHeight;

          const widthPct = Math.max(1, Math.min(99, props.popupWidth || 33));
          const heightPct = Math.max(1, Math.min(99, props.popupHeight || 33));

          const maxWidth = mapWidth * (widthPct / 100);
          const popupMaxHeight = mapHeight * (heightPct / 100);
          const minWidth = Math.min(150, maxWidth * 0.5);

          layer.bindPopup(popupHtml, {
            maxWidth: maxWidth,
            minWidth: minWidth,
            maxHeight: popupMaxHeight,
            className: "stgy-track-popup"
          });
        }

        this.bindCoordinateHud(feature, layer, hud);
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
    hud: HTMLElement
  ) {
    const center = this.getGeoJsonCenter(geoJsonData);
    if (!center) {
      return;
    }

    const marker = L.marker(center);
    if (label) {
      marker.bindPopup(`<div class="annot-title">${label}</div>`);
    }

    let routeLayer: L.GeoJSON | null = null;
    marker.on("click", () => {
      if (!routeLayer) {
        routeLayer = this.createGeoJsonLayer(map, geoJsonData, hud);
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

    // --- Define Tile Layers ---
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
    const hud = this.createHud(canvas);
    const masterGroup = L.featureGroup().addTo(map);

    // --- 1. Render Inline Pins ---
    if (inlinePins.length > 0) {
      this.renderInlinePins(map, masterGroup, inlinePins);
    }

    // --- 2. Load & Render GeoJSON/TrackJSON ---
    if (dataSrc) {
      try {
        const geoJsonData = await this.loadTrackData(dataSrc, trackDataCache);
        const geoJsonLayer = this.createGeoJsonLayer(map, geoJsonData, hud);
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
            this.renderTrackAsPin(map, masterGroup, geoJsonData, link.textContent?.trim() || "", hud);
          } else {
            const geoJsonLayer = this.createGeoJsonLayer(map, geoJsonData, hud);
            masterGroup.addLayer(geoJsonLayer);
          }
        } catch (e) {
          this.showError(figure, this.toUserErrorMessage(e));
        }
      });

      await Promise.all(trackPromises);
    }

    // --- 3. Apply Smart Auto-Fit ---
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

      const pinColor = li.dataset.color;
      const markerOptions: L.MarkerOptions = {};
      if (pinColor) {
        markerOptions.icon = createCustomPinIcon(pinColor);
      }

      const marker = L.marker([lat, lon], markerOptions);
      marker.bindPopup(li.innerHTML, {
        maxWidth: maxWidth,
        minWidth: minWidth,
        maxHeight: popupMaxHeight,
        className: "stgy-track-popup"
      });

      layerGroup.addLayer(marker);
    });
  }
}
