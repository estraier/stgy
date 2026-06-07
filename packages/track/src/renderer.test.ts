import L from "leaflet";
import { StgyTrackRenderer } from "./renderer";
import { TrackLoader } from "./loader";
import * as geo from "./geo";

jest.mock("leaflet", () => {
  const originalL = jest.requireActual("leaflet");

  const createBounds = (
    center = { lat: 35.681, lng: 139.767 },
    southWest = center,
    northEast = center,
  ) => ({
    isValid: () => true,
    getCenter: () => center,
    getSouthWest: () => southWest,
    getNorthEast: () => northEast,
    pad: jest.fn().mockReturnThis(),
  });

  const createBoundsFromLatLngs = (points: Array<{ lat: number; lng: number }>) => {
    if (points.length === 0) {
      return {
        isValid: () => false,
        getCenter: () => ({ lat: 0, lng: 0 }),
        getSouthWest: () => ({ lat: 0, lng: 0 }),
        getNorthEast: () => ({ lat: 0, lng: 0 }),
        pad: jest.fn().mockReturnThis(),
      };
    }

    const minLat = Math.min(...points.map((p) => p.lat));
    const maxLat = Math.max(...points.map((p) => p.lat));
    const minLng = Math.min(...points.map((p) => p.lng));
    const maxLng = Math.max(...points.map((p) => p.lng));

    return createBounds(
      { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
      { lat: minLat, lng: minLng },
      { lat: maxLat, lng: maxLng },
    );
  };

  const collectPoints = (value: unknown, points: Array<{ lat: number; lng: number }>) => {
    if (!Array.isArray(value)) return;

    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      points.push({ lng: value[0], lat: value[1] });
      return;
    }

    value.forEach((child) => collectPoints(child, points));
  };

  const createBoundsFromGeoJson = (data: any) => {
    const points: Array<{ lat: number; lng: number }> = [];

    const collectGeometry = (geometry: any) => {
      if (!geometry) return;
      if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
        geometry.geometries.forEach(collectGeometry);
        return;
      }
      collectPoints(geometry.coordinates, points);
    };

    if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
      data.features.forEach((feature: any) => collectGeometry(feature.geometry));
    } else if (data?.type === "Feature") {
      collectGeometry(data.geometry);
    } else {
      collectGeometry(data);
    }

    return createBoundsFromLatLngs(points);
  };

  const createMap = () => {
    const layers = new Set<unknown>();
    const map = {
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      hasLayer: jest.fn(),
      setView: jest.fn(),
      fitBounds: jest.fn(),
      invalidateSize: jest.fn(),
      getContainer: () => document.createElement("div"),
    };

    map.addLayer.mockImplementation((layer: unknown) => {
      layers.add(layer);
      return map;
    });
    map.removeLayer.mockImplementation((layer: unknown) => {
      layers.delete(layer);
      return map;
    });
    map.hasLayer.mockImplementation((layer: unknown) => layers.has(layer));

    return map;
  };

  const createFeatureGroup = () => {
    const layers = new Set<unknown>();
    const group = {
      addTo: jest.fn(),
      addLayer: jest.fn(),
      removeLayer: jest.fn(),
      hasLayer: jest.fn(),
      getBounds: jest.fn().mockReturnValue(createBounds(
        { lat: 35, lng: 139 },
        { lat: 34, lng: 138 },
        { lat: 36, lng: 140 },
      )),
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
    map: jest.fn().mockImplementation(createMap),
    marker: jest.fn().mockImplementation(() => ({
      bindPopup: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
    })),
    circleMarker: jest.fn().mockImplementation((latLng) => ({
      __latLng: latLng,
      setLatLng: jest.fn().mockReturnThis(),
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
        getBounds: jest.fn().mockReturnValue(createBoundsFromGeoJson(data)),
      };
    }),
    latLngBounds: jest.fn().mockImplementation((southWest, northEast) => {
      const sw = Array.isArray(southWest)
        ? { lat: southWest[0], lng: southWest[1] }
        : southWest;
      const ne = Array.isArray(northEast)
        ? { lat: northEast[0], lng: northEast[1] }
        : northEast;

      return createBounds(
        { lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 },
        sw,
        ne,
      );
    }),
    tileLayer: jest.fn().mockReturnValue({}),
    control: {
      layers: jest.fn().mockReturnValue({ addTo: jest.fn() }),
    },
  };
});

const flushPromises = async () => {
  await new Promise(process.nextTick);
};

const makeTrackWithGraph = () => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [139.7528, 35.6852],
          [139.7550, 35.6848],
          [139.7585, 35.6840],
        ],
      },
      properties: {
        color: "#e67e22",
        weight: 6,
        opacity: 0.9,
        coordinateProperties: {
          times: [1767222000, 1767222060, 1767222120],
          distances: [0, 210, 545],
          elevations: [20, 21, 22],
          heartRates: [118, 123, 128],
          powers: [130, 145, 160],
        },
      },
    },
  ],
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

    await flushPromises();

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

    await flushPromises();

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

    await flushPromises();

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

    await flushPromises();

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

    await flushPromises();

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

    await flushPromises();

    expect(L.map).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        center: [(35.681 + 35.69) / 2, (139.767 + 139.78) / 2],
      }),
    );
    expect(L.marker).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: (35.681 + 35.69) / 2,
        lng: (139.767 + 139.78) / 2,
      }),
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

    await flushPromises();

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

  test("shows coordinateProperties overlay on LineString mousemove", async () => {
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
              distances: [0, 210, 545],
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

    await flushPromises();

    const renderedGeoJsonResult = (L.geoJSON as jest.Mock).mock.results.find((result) => {
      return result.value.__featureLayers?.length > 0;
    });

    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mousemove")?.[1];

    expect(typeof mousemoveHandler).toBe("function");

    mousemoveHandler({
      latlng: { lat: 35.681, lng: 139.767 },
    });

    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");
    expect(overlay).not.toBeNull();
    expect(overlay?.hidden).toBe(false);
    expect(overlay?.textContent).toContain("times: 2026/01/02 03:04:05");
    expect(overlay?.textContent).toContain("distances: 0.21 km");
    expect(overlay?.textContent).toContain("elevations: 20 m");
    expect(overlay?.textContent).toContain("heart rates: 130 bpm");
    expect(overlay?.textContent).toContain("cadences: 80 rpm");
    expect(overlay?.textContent).toContain("powers: 180 W");
    expect(overlay?.textContent).toContain("speeds: 22.5 km/h");
  });

  test("hides coordinateProperties overlay on LineString mouseout", async () => {
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

    await flushPromises();

    const renderedGeoJsonResult = (L.geoJSON as jest.Mock).mock.results.find((result) => {
      return result.value.__featureLayers?.length > 0;
    });

    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mousemove")?.[1];
    const mouseoutHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mouseout")?.[1];

    mousemoveHandler({
      latlng: { lat: 35.681, lng: 139.767 },
    });

    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");
    expect(overlay?.hidden).toBe(false);

    mouseoutHandler();

    expect(overlay?.hidden).toBe(true);
  });

  test("highlights corresponding map point while hovering the route and removes it on leave", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = (L.geoJSON as jest.Mock).mock.results.find((result) => {
      return result.value.__featureLayers?.length > 0;
    });

    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mousemove")?.[1];
    const mouseoutHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mouseout")?.[1];

    expect(typeof mousemoveHandler).toBe("function");
    expect(typeof mouseoutHandler).toBe("function");

    mousemoveHandler({
      latlng: { lat: 35.6848, lng: 139.755 },
    });

    const map = (L.map as jest.Mock).mock.results[0].value;
    const marker = (L.circleMarker as jest.Mock).mock.results[0].value;

    expect(L.circleMarker).toHaveBeenCalledWith([35.6848, 139.755], expect.objectContaining({
      radius: 7,
      interactive: false,
    }));
    expect(map.addLayer).toHaveBeenCalledWith(marker);
    expect(map.hasLayer(marker)).toBe(true);

    mouseoutHandler();

    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.hasLayer(marker)).toBe(false);
  });

  test("does not create overlay but keeps coordinate marker interaction when data-show-overlay is false", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud" data-show-overlay="false">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = (L.geoJSON as jest.Mock).mock.results.find((result) => {
      return result.value.__featureLayers?.length > 0;
    });

    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = featureLayer.on.mock.calls.find((call: unknown[]) => call[0] === "mousemove")?.[1];

    expect(document.querySelector(".stgy-track-hud")).toBeNull();
    expect(typeof mousemoveHandler).toBe("function");

    mousemoveHandler({
      latlng: { lat: 35.6848, lng: 139.755 },
    });

    const map = (L.map as jest.Mock).mock.results[0].value;
    const marker = (L.circleMarker as jest.Mock).mock.results[0].value;

    expect(L.circleMarker).toHaveBeenCalledWith([35.6848, 139.755], expect.objectContaining({
      radius: 7,
      interactive: false,
    }));
    expect(map.addLayer).toHaveBeenCalledWith(marker);
    expect(document.querySelector(".stgy-track-hud")).toBeNull();
  });

  test("renders graph by default and disables it when data-show-graph is false", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#track-a">
        <div class="stgy-track-canvas"></div>
      </figure>
      <figure class="stgy-track-map" data-src="#track-b" data-show-graph="false">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const figures = Array.from(document.querySelectorAll<HTMLElement>(".stgy-track-map"));
    const graphs = Array.from(document.querySelectorAll<HTMLElement>(".stgy-track-graph"));

    expect(graphs).toHaveLength(1);
    expect(figures[0].nextElementSibling).toBe(graphs[0]);
    const secondNext = figures[1].nextElementSibling;
    expect(secondNext?.classList.contains("stgy-track-graph") ?? false).toBe(false);
  });

  test("renders multiple popup links and images from properties", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-popup-media">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [139.767, 35.681],
          },
          properties: {
            title: "Tokyo Station",
            description: "Multiple media test",
            links: [
              "https://example.com",
              { href: "https://example.com/detail", text: "Details" },
            ],
            images: [
              "https://placehold.co/200x120",
              { src: "https://placehold.co/300x180", alt: "Alternate image" },
            ],
          },
        },
      ],
    });

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = (L.geoJSON as jest.Mock).mock.results.find((result) => {
      return result.value.__featureLayers?.length > 0;
    });

    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const popupHtml = featureLayer.bindPopup.mock.calls[0][0] as string;

    expect(popupHtml).toContain('<div class="annot-title">Tokyo Station</div>');
    expect(popupHtml).toContain('<div class="annot-desc">Multiple media test</div>');
    expect(popupHtml).toContain('class="annot-link"');
    expect(popupHtml).toContain('href="https://example.com"');
    expect(popupHtml).toContain('href="https://example.com/detail"');
    expect(popupHtml).toContain('>Details</a>');
    expect(popupHtml).toContain('class="annot-image"');
    expect(popupHtml).toContain('src="https://placehold.co/200x120"');
    expect(popupHtml).toContain('src="https://placehold.co/300x180"');
    expect(popupHtml).toContain('alt="Alternate image"');
    expect(popupHtml).not.toContain("annot-img");
    expect(popupHtml).not.toContain("annot-href");
  });

  test("renders graph outside the figure without shrinking map area", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
        <figcaption class="stgy-track-caption">caption</figcaption>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const figure = document.querySelector<HTMLElement>(".stgy-track-map");
    const graph = document.querySelector<HTMLElement>(".stgy-track-graph");

    expect(figure).not.toBeNull();
    expect(graph).not.toBeNull();
    expect(figure?.querySelector(".stgy-track-graph")).toBeNull();
    expect(figure?.nextElementSibling).toBe(graph);
    expect(graph?.hidden).toBe(false);
  });

  test("does not remove graphs belonging to other map figures", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#track-a">
        <div class="stgy-track-canvas"></div>
      </figure>
      <figure class="stgy-track-map" data-src="#track-b">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockImplementation(async () => makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const figures = Array.from(document.querySelectorAll<HTMLElement>(".stgy-track-map"));
    const graphs = Array.from(document.querySelectorAll<HTMLElement>(".stgy-track-graph"));

    expect(figures).toHaveLength(2);
    expect(graphs).toHaveLength(2);
    expect(figures[0].nextElementSibling).toBe(graphs[0]);
    expect(figures[1].nextElementSibling).toBe(graphs[1]);
    expect(graphs[0].hidden).toBe(false);
    expect(graphs[1].hidden).toBe(false);
  });

  test("renders graph controls with distance as default axis and time as alternative", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const axisSelect = document.querySelector<HTMLSelectElement>(
      '.stgy-track-graph select[aria-label="Graph X axis"]',
    );

    expect(axisSelect).not.toBeNull();
    expect(axisSelect?.value).toBe("distance");
    expect(Array.from(axisSelect?.options || []).map((option) => option.value)).toEqual([
      "distance",
      "time",
      "sample",
    ]);
  });

  test("excludes distances and times from graph series selector", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const seriesSelect = document.querySelector<HTMLSelectElement>(
      '.stgy-track-graph select[aria-label="Graph series"]',
    );

    expect(seriesSelect).not.toBeNull();
    const options = Array.from(seriesSelect?.options || []).map((option) => ({
      value: option.value,
      text: option.textContent,
    }));

    expect(options).toEqual([
      { value: "elevations", text: "elevations" },
      { value: "heartRates", text: "heart rates" },
      { value: "powers", text: "powers" },
    ]);
    expect(options.map((option) => option.value)).not.toContain("distances");
    expect(options.map((option) => option.value)).not.toContain("times");
  });

  test("updates graph readout on hover", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const svg = document.querySelector<SVGSVGElement>(".stgy-track-graph svg");
    const readout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");

    expect(svg).not.toBeNull();
    expect(readout).not.toBeNull();

    if (!svg || !readout) return;

    svg.getBoundingClientRect = jest.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 180,
      right: 800,
      bottom: 180,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    svg.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 333,
      clientY: 90,
    }));

    expect(readout.textContent).toBe("0.21 km / 21.0 m");
  });

  test("updates overlay and highlights corresponding map point while hovering graph", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const svg = document.querySelector<SVGSVGElement>(".stgy-track-graph svg");
    expect(svg).not.toBeNull();

    if (!svg) return;

    svg.getBoundingClientRect = jest.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 180,
      right: 800,
      bottom: 180,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const map = (L.map as jest.Mock).mock.results[0].value;

    svg.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 333,
      clientY: 90,
    }));

    const marker = (L.circleMarker as jest.Mock).mock.results[0].value;
    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");

    expect(L.circleMarker).toHaveBeenCalledWith([35.6848, 139.755], expect.objectContaining({
      radius: 7,
      interactive: false,
    }));
    expect(map.addLayer).toHaveBeenCalledWith(marker);
    expect(map.hasLayer(marker)).toBe(true);
    expect(overlay).not.toBeNull();
    expect(overlay?.hidden).toBe(false);
    expect(overlay?.textContent).toContain("distances: 0.21 km");
    expect(overlay?.textContent).toContain("elevations: 21 m");
    expect(overlay?.textContent).toContain("heart rates: 123 bpm");
    expect(overlay?.textContent).toContain("powers: 145 W");

    svg.dispatchEvent(new MouseEvent("mouseleave", {
      bubbles: true,
    }));

    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.hasLayer(marker)).toBe(false);
    expect(overlay?.hidden).toBe(true);
  });
});
