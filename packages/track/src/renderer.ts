import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { isJapan } from "./geo";

// --- Fix for Leaflet default icon path issues in bundlers ---
const fixLeafletIcons = () => {
  const iconUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
  const iconRetinaUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png";
  const shadowUrl = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

  // delete L.Marker.prototype._getIconUrl;
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

    // 2. Get Parameters (Parse data-lon/data-lat/data-zoom)
    const lat = parseFloat(figure.dataset.lat || "0");
    const lon = parseFloat(figure.dataset.lon || "0");
    const zoom = parseInt(figure.dataset.zoom || "13", 10);

    // 3. Japan Detection
    const isJp = isJapan(lat, lon);

    // 4. Define Tile Layers
    const gsiLayer = L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
      {
        attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">GSI Japan</a>',
        maxZoom: 18,
      }
    );

    const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });

    // 5. Initialize Map
    // Determine default layer based on location
    const defaultLayer = isJp ? gsiLayer : osmLayer;

    const map = L.map(canvas, {
      center: [lat, lon],
      zoom: zoom,
      layers: [defaultLayer],
      scrollWheelZoom: false, // Disable scroll zoom to prevent scroll-jacking
    });

    // Add Layer Control (English Labels)
    L.control.layers({
      "GSI Maps (Pale)": gsiLayer,
      "OpenStreetMap": osmLayer,
    }).addTo(map);

    // --- Handling Content Modes ---

    // Mode A: Inline Pins (details.stgy-track-pins > ul > li)
    const pinElements = figure.querySelectorAll<HTMLElement>(".stgy-track-pins li");
    if (pinElements.length > 0) {
      this.renderInlinePins(map, pinElements);
    }

    // Mode B: Single Track Source (data-src)
    const singleSource = figure.dataset.src;
    if (singleSource) {
      // TODO: Implement fetch and TrackJSON parsing
      console.log(`[StgyTrack] Single track source found: ${singleSource}`);
    }

    // Mode C: Multi Track Sources (ul.stgy-track-sources > li > a.track-source)
    const trackLinks = figure.querySelectorAll<HTMLAnchorElement>(".stgy-track-sources a.track-source");
    if (trackLinks.length > 0) {
      // TODO: Implement fetch, merge and TrackJSON parsing
      console.log(`[StgyTrack] Found ${trackLinks.length} track sources to merge.`);
    }

    // Mode D: Guide Map (ul.stgy-track-subtrack-sources > li > a.subtrack-source)
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

      // Use the HTML content of the <li> as the popup
      marker.bindPopup(li.innerHTML);

      markers.push(marker);
    });

    // Fit bounds if multiple pins exist
    if (markers.length > 1) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  /**
   * Render markers for Guide Map mode (Subtracks)
   * Displays markers at start points defined in data attributes of <a> tags
   */
  private renderGuideMapMarkers(map: L.Map, links: NodeListOf<HTMLAnchorElement>) {
    const markers: L.Marker[] = [];

    links.forEach((a) => {
      const lat = parseFloat(a.dataset.lat || "0");
      const lon = parseFloat(a.dataset.lon || "0");

      if (lat === 0 && lon === 0) return;

      const marker = L.marker([lat, lon]).addTo(map);

      // Create a popup with the link text and href.
      // We clone the anchor tag to keep its attributes/classes.
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
