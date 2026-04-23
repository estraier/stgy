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
  if (props.title) html += `<div class="annot-title">${props.title}</div>`;
  if (props.description) html += `<div class="annot-desc">${props.description}</div>`;
  if (props.image) html += `<div class="annot-img"><img src="${props.image}" alt="${props.title || ''}"></div>`;
  return html;
};

const DEFAULT_SINGLE_POINT_ZOOM = 12;

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

  private async initMap(figure: HTMLElement) {
    if (figure.dataset.stgyTrackInitialized) return;

    const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
    if (!canvas) {
      console.warn("[StgyTrack] Canvas element .stgy-track-canvas not found.");
      return;
    }

    const hasExplicitLat = typeof figure.dataset.lat !== "undefined";
    const hasExplicitLon = typeof figure.dataset.lon !== "undefined";
    const hasExplicitZoom = typeof figure.dataset.zoom !== "undefined";

    let lat = parseFloat(figure.dataset.lat || "0");
    let lon = parseFloat(figure.dataset.lon || "0");
    const zoom = parseInt(figure.dataset.zoom || "13", 10);

    const dataSrc = figure.getAttribute("data-src")?.trim();
    let preloadedTrackData: any | undefined;

    if (!hasExplicitLat || !hasExplicitLon) {
      const firstPin = figure.querySelector<HTMLElement>(".stgy-track-pins li");
      if (firstPin) {
        lat = parseFloat(firstPin.dataset.lat || lat.toString());
        lon = parseFloat(firstPin.dataset.lon || lon.toString());
      } else if (dataSrc) {
        try {
          preloadedTrackData = await this.loader.load(dataSrc);
          const preloadedLayer = L.geoJSON(preloadedTrackData);
          const preloadedBounds = preloadedLayer.getBounds();
          if (preloadedBounds.isValid()) {
            const center = preloadedBounds.getCenter();
            lat = center.lat;
            lon = center.lng;
          }
        } catch (e) {
          console.error(`[StgyTrack] Failed to preload track data from ${dataSrc}`, e);
        }
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
    const masterGroup = L.featureGroup().addTo(map);

    // --- 1. Render Inline Pins ---
    const inlinePins = figure.querySelectorAll<HTMLElement>(".stgy-track-pins li");
    if (inlinePins.length > 0) {
      this.renderInlinePins(map, masterGroup, inlinePins);
    }

    // --- 2. Load & Render GeoJSON/TrackJSON ---
    const trackHrefs = dataSrc
      ? [dataSrc]
      : Array.from(figure.querySelectorAll<HTMLAnchorElement>(".stgy-track-sources a.track-source"))
          .map((link) => link.getAttribute("href")?.trim() || "")
          .filter((href) => href.length > 0);

    if (trackHrefs.length > 0) {
      const trackPromises = trackHrefs.map(async (href) => {
        try {
          const geoJsonData =
            dataSrc && href === dataSrc && typeof preloadedTrackData !== "undefined"
              ? preloadedTrackData
              : await this.loader.load(href);

          const geoJsonLayer = L.geoJSON(geoJsonData, {
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
            }
          });

          masterGroup.addLayer(geoJsonLayer);
        } catch (e) {
          console.error(`[StgyTrack] Failed to load track data from ${href}`, e);
        }
      });

      await Promise.all(trackPromises);
    }

    // --- 3. Apply Smart Auto-Fit ---
    const bounds = masterGroup.getBounds();
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
