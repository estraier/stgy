import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { isJapan } from "./geo";

// --- Fix for Leaflet default icon path issues in bundlers ---
const fixLeafletIcons = () => {
  const iconUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
  const iconRetinaUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png";
  const shadowUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

  // Use safe casting to remove the private property without using 'any'
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

export class StgyTrackRenderer {
  constructor() {
    fixLeafletIcons();
  }

  /**
   * Find all .stgy-track-map elements under the root and hydrate them.
   */
  public hydrate(rootElement: HTMLElement = document.body) {
    const figures = rootElement.querySelectorAll<HTMLElement>(".stgy-track-map");
    figures.forEach((figure) => this.initMap(figure));
  }

  private initMap(figure: HTMLElement) {
    // Prevent double initialization
    if (figure.dataset.stgyTrackInitialized) return;

    // 1. Get Canvas
    const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
    if (!canvas) {
      console.warn("[StgyTrack] Canvas element .stgy-track-canvas not found.");
      return;
    }

    // 2. Get Parameters
    const lat = parseFloat(figure.dataset.lat || "0");
    const lon = parseFloat(figure.dataset.lon || "0");
    const zoom = parseInt(figure.dataset.zoom || "13", 10);

    // 3. Japan Detection
    const isJp = isJapan(lat, lon);

    // 4. Define Tile Layers
    // Important: Use maxNativeZoom for GSI/OpenTopo tiles to allow over-zooming (stretching)
    // when switching from deeper OSM zoom levels (19+).

    const gsiPale = L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
      {
        attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">GSI Japan</a>',
        maxNativeZoom: 18,
        maxZoom: 20, // Allow zooming up to 20 by stretching z18 tiles
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

    // Use 'seamlessphoto' instead of 'ortho' for better coverage and reliability
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
      maxNativeZoom: 17, // OpenTopoMap often lacks high zoom levels
      maxZoom: 20,
    });

    // 5. Build Layer List & Determine Default
    const baseMaps: Record<string, L.TileLayer> = {};
    let defaultLayer: L.TileLayer;

    if (isJp) {
      // Japan: Include GSI layers
      baseMaps["GSI Pale"] = gsiPale;
      baseMaps["GSI Standard"] = gsiStd;
      baseMaps["GSI Photo"] = gsiPhoto;
      baseMaps["CyclOSM"] = cyclosm; // Reordered for better UX
      baseMaps["OpenStreetMap"] = osm;
      baseMaps["OpenTopoMap"] = opentopo;

      defaultLayer = gsiPale; // Default to Pale for Japan
    } else {
      // Global: OSM layers only
      baseMaps["CyclOSM"] = cyclosm;
      baseMaps["OpenStreetMap"] = osm;
      baseMaps["OpenTopoMap"] = opentopo;

      defaultLayer = cyclosm; // Default to CyclOSM for Global
    }

    // 6. Initialize Map
    const map = L.map(canvas, {
      center: [lat, lon],
      zoom: zoom,
      layers: [defaultLayer],
      scrollWheelZoom: false,
    });

    // Add Layer Control
    L.control.layers(baseMaps).addTo(map);

    // --- Handling Content Modes ---

    // Mode A: Inline Pins
    const pinElements = figure.querySelectorAll<HTMLElement>(".stgy-track-pins li");
    if (pinElements.length > 0) {
      this.renderInlinePins(map, pinElements);
    }

    // Mode B: Single Track Source
    const singleSource = figure.dataset.src;
    if (singleSource) {
      console.log(`[StgyTrack] Single track source found: ${singleSource}`);
      // TODO: Implement fetch
    }

    // Mode C: Multi Track Sources
    const trackLinks = figure.querySelectorAll<HTMLAnchorElement>(".stgy-track-sources a.track-source");
    if (trackLinks.length > 0) {
      console.log(`[StgyTrack] Found ${trackLinks.length} track sources to merge.`);
      // TODO: Implement fetch & merge
    }

    // Mode D: Guide Map
    const subtrackLinks = figure.querySelectorAll<HTMLAnchorElement>(".stgy-track-subtrack-sources a.subtrack-source");
    if (subtrackLinks.length > 0) {
      this.renderGuideMapMarkers(map, subtrackLinks);
    }

    // Mark as initialized
    figure.dataset.stgyTrackInitialized = "true";
  }

  /**
   * Render markers from inline list elements
   */
  private renderInlinePins(map: L.Map, pins: NodeListOf<HTMLElement>) {
    const markers: L.Marker[] = [];
    pins.forEach((li) => {
      const lat = parseFloat(li.dataset.lat || "0");
      const lon = parseFloat(li.dataset.lon || "0");
      if (lat === 0 && lon === 0) return;
      const marker = L.marker([lat, lon]).addTo(map);
      marker.bindPopup(li.innerHTML);
      markers.push(marker);
    });
    if (markers.length > 1) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  /**
   * Render markers for Guide Map mode (Subtracks)
   */
  private renderGuideMapMarkers(map: L.Map, links: NodeListOf<HTMLAnchorElement>) {
    const markers: L.Marker[] = [];
    links.forEach((a) => {
      const lat = parseFloat(a.dataset.lat || "0");
      const lon = parseFloat(a.dataset.lon || "0");
      if (lat === 0 && lon === 0) return;
      const marker = L.marker([lat, lon]).addTo(map);
      const popupContent = document.createElement("div");
      const linkClone = a.cloneNode(true) as HTMLElement;
      popupContent.appendChild(linkClone);
      marker.bindPopup(popupContent);
      markers.push(marker);
    });
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }
}
