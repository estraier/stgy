import L from "leaflet";
import { StgyTrackRenderer } from "./renderer";
import { TrackLoader } from "./loader";
import * as geo from "./geo";

jest.mock("leaflet", () => {
  const originalL = jest.requireActual("leaflet");
  return {
    ...originalL,
    map: jest.fn().mockReturnValue({
      addLayer: jest.fn(),
      setView: jest.fn(),
      fitBounds: jest.fn(),
      getContainer: () => document.createElement("div")
    }),
    featureGroup: jest.fn().mockReturnValue({
      addTo: jest.fn().mockReturnThis(),
      addLayer: jest.fn(),
      getBounds: jest.fn().mockReturnValue({
        isValid: () => true,
        getCenter: () => ({ lat: 35, lng: 139 }),
        getSouthWest: () => ({ lat: 34, lng: 138 }),
        getNorthEast: () => ({ lat: 36, lng: 140 }),
        pad: jest.fn().mockReturnThis()
      })
    }),
    geoJSON: jest.fn().mockReturnValue({
      getBounds: jest.fn().mockReturnValue({
        isValid: () => true,
        getCenter: () => ({ lat: 35.681, lng: 139.767 })
      })
    })
  };
});

describe("StgyTrackRenderer", () => {
  let renderer: StgyTrackRenderer;
  let isJapanSpy: jest.SpyInstance;

  beforeEach(() => {
    renderer = new StgyTrackRenderer();
    isJapanSpy = jest.spyOn(geo, "isJapan");
    jest.clearAllMocks();
  });

  afterEach(() => {
    isJapanSpy.mockRestore();
  });

  test("includes GSI Pale in base layers when coordinates are in Japan", () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-lat="35.681" data-lon="139.767">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    isJapanSpy.mockReturnValue(true);

    const layersSpy = jest.spyOn(L.control, "layers").mockReturnValue({ addTo: jest.fn() } as any);

    renderer.hydrate(document.body);

    expect(L.map).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      center: [35.681, 139.767]
    }));

    const baseMaps = layersSpy.mock.calls[0][0] as Record<string, L.TileLayer>;
    expect(baseMaps).toHaveProperty("GSI Pale");
  });

  test("calls fitBounds when data-zoom is not provided and bounds are not a single point", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    const mockMap = L.map(document.createElement("div"));
    (L.map as jest.Mock).mockReturnValue(mockMap);

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    expect(mockMap.fitBounds).toHaveBeenCalledWith(expect.any(Object), { padding: [50, 50] });
    expect(mockMap.setView).not.toHaveBeenCalled();
  });

  test("calls setView when only data-zoom is provided", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-zoom="15">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    const mockMap = L.map(document.createElement("div"));
    (L.map as jest.Mock).mockReturnValue(mockMap);

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    expect(mockMap.setView).toHaveBeenCalledWith({ lat: 35, lng: 139 }, 15);
    expect(mockMap.fitBounds).not.toHaveBeenCalled();
  });

  test("loads track from data-src", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-1">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    const loadSpy = jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [],
    });

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith("#demo-geojson-1");
  });

  test("uses data-src bounds for initial center and Japan tile selection", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-0">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    const loadSpy = jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [139.767, 35.681]
          },
          properties: {}
        }
      ],
    });

    const layersSpy = jest.spyOn(L.control, "layers").mockReturnValue({ addTo: jest.fn() } as any);

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(L.map).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        center: [35.681, 139.767]
      })
    );

    const baseMaps = layersSpy.mock.calls[0][0] as Record<string, L.TileLayer>;
    expect(baseMaps).toHaveProperty("GSI Pale");
  });

  test("uses default zoom for a single-point bounds when data-zoom is not provided", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-0">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    const mockMap = L.map(document.createElement("div"));
    (L.map as jest.Mock).mockReturnValue(mockMap);

    (L.featureGroup as jest.Mock).mockReturnValue({
      addTo: jest.fn().mockReturnThis(),
      addLayer: jest.fn(),
      getBounds: jest.fn().mockReturnValue({
        isValid: () => true,
        getCenter: () => ({ lat: 35.681, lng: 139.767 }),
        getSouthWest: () => ({ lat: 35.681, lng: 139.767 }),
        getNorthEast: () => ({ lat: 35.681, lng: 139.767 }),
      })
    });

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [139.767, 35.681]
          },
          properties: {}
        }
      ],
    });

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    expect(mockMap.setView).toHaveBeenCalledWith({ lat: 35.681, lng: 139.767 }, 12);
    expect(mockMap.fitBounds).not.toHaveBeenCalled();
  });
});
