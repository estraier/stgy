import L from "leaflet";
import { StgyTrackRenderer } from "./renderer";
import { TrackLoader } from "./loader";
import * as geo from "./geo";

jest.mock("leaflet", () => {
  const originalL = jest.requireActual("leaflet");

  const createBounds = (
    center = { lat: 35.681, lng: 139.767 },
    southWest = { lat: 34, lng: 138 },
    northEast = { lat: 36, lng: 140 },
  ) => ({
    isValid: () => true,
    getCenter: () => center,
    getSouthWest: () => southWest,
    getNorthEast: () => northEast,
    pad: jest.fn().mockReturnThis(),
  });

  const createFeatureGroup = () => {
    const layers = new Set<unknown>();
    const group = {
      addTo: jest.fn(),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      hasLayer: jest.fn(),
      getBounds: jest.fn().mockReturnValue(createBounds({ lat: 35, lng: 139 })),
    };
    group.addTo.mockReturnValue(group);
    group.addLayer.mockImplementation((layer: unknown) => {
      layers.add(layer);
      return group;
    });
    group.removeLayer.mockImplementation((layer: unknown) => {
      layers.delete(layer);
      return group;
    });
    group.hasLayer.mockImplementation((layer: unknown) => layers.has(layer));
    return group;
  };

  const createFeatureLayer = () => ({
    bindPopup: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
  });

  return {
    ...originalL,
    map: jest.fn().mockReturnValue({
      addLayer: jest.fn(),
      setView: jest.fn(),
      fitBounds: jest.fn(),
      getContainer: () => document.createElement("div"),
    }),
    marker: jest.fn().mockImplementation(() => ({
      bindPopup: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
    })),
    featureGroup: jest.fn().mockImplementation(createFeatureGroup),
    geoJSON: jest.fn().mockImplementation((data, options) => {
      const featureLayers: ReturnType<typeof createFeatureLayer>[] = [];

      if (options?.onEachFeature && data?.type === "FeatureCollection" && Array.isArray(data.features)) {
        data.features.forEach((feature: unknown) => {
          const layer = createFeatureLayer();
          featureLayers.push(layer);
          options.onEachFeature(feature, layer);
        });
      }

      return {
        __featureLayers: featureLayers,
        addTo: jest.fn().mockReturnThis(),
        getBounds: jest.fn().mockReturnValue(createBounds()),
      };
    }),
    tileLayer: jest.fn().mockReturnValue({}),
    control: {
      layers: jest.fn().mockReturnValue({ addTo: jest.fn() }),
    },
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
    jest.restoreAllMocks();
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
      center: [35.681, 139.767],
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
            coordinates: [139.767, 35.681],
          },
          properties: {},
        },
      ],
    });

    const layersSpy = jest.spyOn(L.control, "layers").mockReturnValue({ addTo: jest.fn() } as any);

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(L.map).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        center: [35.681, 139.767],
      }),
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

    (L.featureGroup as jest.Mock).mockImplementation(() => {
      const layers = new Set<unknown>();
      const group = {
        addTo: jest.fn(),
        addLayer: jest.fn(),
        removeLayer: jest.fn(),
        hasLayer: jest.fn(),
        getBounds: jest.fn().mockReturnValue({
          isValid: () => true,
          getCenter: () => ({ lat: 35.681, lng: 139.767 }),
          getSouthWest: () => ({ lat: 35.681, lng: 139.767 }),
          getNorthEast: () => ({ lat: 35.681, lng: 139.767 }),
        }),
      };
      group.addTo.mockReturnValue(group);
      group.addLayer.mockImplementation((layer: unknown) => {
        layers.add(layer);
        return group;
      });
      group.removeLayer.mockImplementation((layer: unknown) => {
        layers.delete(layer);
        return group;
      });
      group.hasLayer.mockImplementation((layer: unknown) => layers.has(layer));
      return group;
    });

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [139.767, 35.681],
          },
          properties: {},
        },
      ],
    });

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    expect(mockMap.setView).toHaveBeenCalledWith({ lat: 35.681, lng: 139.767 }, 12);
    expect(mockMap.fitBounds).not.toHaveBeenCalled();
  });

  test("renders data-render=pin as a guide pin", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map">
        <div class="stgy-track-canvas"></div>
        <ul class="stgy-track-sources">
          <li><a href="#demo-geojson-pin" class="track-source" data-render="pin">Guide Route</a></li>
        </ul>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [[139.767, 35.681], [139.78, 35.69]],
          },
          properties: {},
        },
      ],
    });

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    expect(L.map).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        center: [35.681, 139.767],
      }),
    );
    expect(L.marker).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 35.681, lng: 139.767 }),
    );
  });

  test("toggles route layer when a guide pin is clicked", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map">
        <div class="stgy-track-canvas"></div>
        <ul class="stgy-track-sources">
          <li><a href="#demo-geojson-pin" class="track-source" data-render="pin">Guide Route</a></li>
        </ul>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [[139.767, 35.681], [139.78, 35.69]],
          },
          properties: {},
        },
      ],
    });

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    const marker = (L.marker as jest.Mock).mock.results[0].value;
    const clickHandler = marker.on.mock.calls.find((call: unknown[]) => call[0] === "click")?.[1];
    const group = (L.featureGroup as jest.Mock).mock.results[0].value;
    const initialAddCount = group.addLayer.mock.calls.length;

    expect(typeof clickHandler).toBe("function");

    clickHandler();

    expect(group.addLayer.mock.calls.length).toBe(initialAddCount + 1);
    const routeLayer = group.addLayer.mock.calls[initialAddCount][0];

    clickHandler();

    expect(group.removeLayer).toHaveBeenCalledWith(routeLayer);
  });

  test("shows coordinateProperties HUD on LineString mousemove", async () => {
    const localTime = new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000;

    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [139.760, 35.680],
              [139.767, 35.681],
              [139.770, 35.690],
            ],
          },
          properties: {
            coordinateProperties: {
              times: [localTime - 60, localTime, localTime + 60],
              elevations: [10, 20, 30],
              heartRates: [120, 130, 140],
              cadences: [70, 80, 90],
              powers: [150, 180, 210],
              speeds: [20.1, 22.5, 24.0],
            },
          },
        },
      ],
    });

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    const renderedGeoJsonResult = (L.geoJSON as jest.Mock).mock.results.find((result) => {
      return result.value.__featureLayers?.length > 0;
    });

    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mousemove")?.[1];

    expect(typeof mousemoveHandler).toBe("function");

    mousemoveHandler({
      latlng: { lat: 35.681, lng: 139.767 },
    });

    const hud = document.querySelector<HTMLElement>(".stgy-track-hud");
    expect(hud).not.toBeNull();
    expect(hud?.hidden).toBe(false);
    expect(hud?.textContent).toContain("2026/01/02 03:04:05");
    expect(hud?.textContent).toContain("20 m");
    expect(hud?.textContent).toContain("130 bpm");
    expect(hud?.textContent).toContain("80 rpm");
    expect(hud?.textContent).toContain("180 W");
    expect(hud?.textContent).toContain("22.5 km/h");
  });

  test("hides coordinateProperties HUD on LineString mouseout", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [[139.767, 35.681]],
          },
          properties: {
            coordinateProperties: {
              heartRates: [130],
            },
          },
        },
      ],
    });

    renderer.hydrate(document.body);

    await new Promise(process.nextTick);

    const renderedGeoJsonResult = (L.geoJSON as jest.Mock).mock.results.find((result) => {
      return result.value.__featureLayers?.length > 0;
    });

    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mousemove")?.[1];
    const mouseoutHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mouseout")?.[1];

    mousemoveHandler({
      latlng: { lat: 35.681, lng: 139.767 },
    });

    const hud = document.querySelector<HTMLElement>(".stgy-track-hud");
    expect(hud?.hidden).toBe(false);

    mouseoutHandler();

    expect(hud?.hidden).toBe(true);
  });
});
