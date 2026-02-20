import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./stgy-track.css";
import { isJapan } from "./geo";

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
  // Leafletのデフォルトピンに近い形状のSVG
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="25px" height="41px" style="filter: drop-shadow(2px 4px 2px rgba(0,0,0,0.3));">
      <path fill="${color}" stroke="#ffffff" stroke-width="1.5" d="M12 0C5.373 0 0 5.373 0 12c0 8.442 11.373 23.36 11.706 23.784.144.184.364.288.594.288.23 0 .45-.104.594-.288C13.227 35.36 24 20.442 24 12 24 5.373 18.627 0 12 0zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/>
    </svg>`;

  return L.divIcon({
    className: "stgy-custom-pin", // 背景等のデフォルトスタイルを消すためのクラス
    html: svg,
    iconSize: [25, 41],
    iconAnchor: [12, 41],   // ピンの先端を座標に合わせる
    popupAnchor: [0, -34],  // ポップアップの吹き出し位置
  });
};

export class StgyTrackRenderer {
  constructor() {
    fixLeafletIcons();
  }

  public hydrate(rootElement: HTMLElement = document.body) {
    const figures = rootElement.querySelectorAll<HTMLElement>(".stgy-track-map");
    figures.forEach((figure) => this.initMap(figure));
  }

  private initMap(figure: HTMLElement) {
    if (figure.dataset.stgyTrackInitialized) return;

    // 1. Get Canvas
    const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
    if (!canvas) {
      console.warn("[StgyTrack] Canvas element .stgy-track-canvas not found.");
      return;
    }

    // 2. Get Parameters
    // ズームレベルがHTMLで明示的に指定されているかを判定（オートフィットの制御用）
    const hasExplicitZoom = typeof figure.dataset.zoom !== "undefined";

    const lat = parseFloat(figure.dataset.lat || "0");
    const lon = parseFloat(figure.dataset.lon || "0");
    const zoom = parseInt(figure.dataset.zoom || "13", 10);

    // 3. Japan Detection
    const isJp = isJapan(lat, lon);

    // 4. Define Tile Layers
    const gsiPale = L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
      {
        attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">GSI Japan</a>',
        maxNativeZoom: 18,
        maxZoom: 20,
      }
    );

    const gsiStd = L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
      {
        attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">GSI Japan</a>',
        maxNativeZoom: 18,
        maxZoom: 20,
      }
    );

    const gsiPhoto = L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
      {
        attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">GSI Japan</a>',
        maxNativeZoom: 18,
        maxZoom: 20,
      }
    );

    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxNativeZoom: 19,
      maxZoom: 20,
    });

    const cyclosm = L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.cyclosm.org">CyclOSM</a>',
      maxNativeZoom: 20,
      maxZoom: 20,
    });

    const opentopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxNativeZoom: 17,
      maxZoom: 20,
    });

    // 5. Build Layer List & Determine Default
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

    // 6. Initialize Map
    const map = L.map(canvas, {
      center: [lat, lon],
      zoom: zoom,
      layers: [defaultLayer],
      scrollWheelZoom: false,
    });

    L.control.layers(baseMaps).addTo(map);

    // --- Handling Content Modes ---

    // Mode A: Inline Pins
    const inlinePins = figure.querySelectorAll<HTMLElement>(".stgy-track-pins li");
    if (inlinePins.length > 0) {
      // ズーム指定がない場合のみ autoFit を true にする
      this.renderInlinePins(map, inlinePins, !hasExplicitZoom);
    }

    // Mark as initialized
    figure.dataset.stgyTrackInitialized = "true";
  }

  /**
   * Render markers from inline list elements with Responsive Popup Size and Custom Colors
   */
  private renderInlinePins(map: L.Map, pins: NodeListOf<HTMLElement>, autoFit: boolean = true) {
    const markers: L.Marker[] = [];

    // 現在の地図コンテナのサイズを取得
    const mapContainer = map.getContainer();

    pins.forEach((li) => {
      const lat = parseFloat(li.dataset.lat || "0");
      const lon = parseFloat(li.dataset.lon || "0");

      if (lat === 0 && lon === 0) return;

      const mapWidth = mapContainer.clientWidth;
      const mapHeight = mapContainer.clientHeight;

      // data-popup-width と data-popup-height を取得 (デフォルト 33)
      const widthPctStr = li.dataset.popupWidth || "33";
      const heightPctStr = li.dataset.popupHeight || "33";

      // 1〜99の範囲に収める
      const widthPct = Math.max(1, Math.min(99, parseInt(widthPctStr, 10) || 33));
      const heightPct = Math.max(1, Math.min(99, parseInt(heightPctStr, 10) || 33));

      // パーセンテージから実際のピクセルサイズを計算
      const maxWidth = mapWidth * (widthPct / 100);
      const popupMaxHeight = mapHeight * (heightPct / 100);

      const minWidth = Math.min(150, maxWidth * 0.5);

      // 色指定の取得
      const pinColor = li.dataset.color;
      const markerOptions: L.MarkerOptions = {};

      if (pinColor) {
        markerOptions.icon = createCustomPinIcon(pinColor);
      }

      const marker = L.marker([lat, lon], markerOptions).addTo(map);

      marker.bindPopup(li.innerHTML, {
        maxWidth: maxWidth,
        minWidth: minWidth,
        maxHeight: popupMaxHeight,
        className: "stgy-track-popup"
      });

      markers.push(marker);
    });

    // オートフィットが許可されている場合のみ、ピン全体が収まるようにズーム・移動する
    if (markers.length > 1 && autoFit) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }
}
