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
      on: jest.fn().mockReturnThis(),
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
    tileLayer: jest.fn().mockImplementation((url) => ({ __url: url })),
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

  test("uses data-base-layer as the initial base layer", () => {
    document.body.innerHTML = `
      <figure
        class="stgy-track-map"
        data-lat="35.681"
        data-lon="139.767"
        data-base-layer="OpenStreetMap">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    isJapanSpy.mockReturnValue(true);

    renderer.hydrate(document.body);

    const mapOptions = (L.map as jest.Mock).mock.calls[0][1] as {
      layers: Array<{ __url: string }>;
    };

    expect(mapOptions.layers[0].__url).toContain("tile.openstreetmap.org");
  });

  test("accepts base layer aliases and includes a requested Japan-only layer", () => {
    document.body.innerHTML = `
      <figure
        class="stgy-track-map"
        data-lat="40.7128"
        data-lon="-74.0060"
        data-base-layer="gsi-photo">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    isJapanSpy.mockReturnValue(false);

    const layersSpy = jest.spyOn(L.control, "layers").mockReturnValue({ addTo: jest.fn() } as any);

    renderer.hydrate(document.body);

    const baseMaps = layersSpy.mock.calls[0][0] as Record<string, L.TileLayer>;
    const mapOptions = (L.map as jest.Mock).mock.calls[0][1] as {
      layers: Array<{ __url: string }>;
    };

    expect(baseMaps).toHaveProperty("GSI Photo");
    expect(mapOptions.layers[0].__url).toContain("seamlessphoto");
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

  test("does not create overlay when data-show-overlay is false", async () => {
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

    expect(document.querySelector(".stgy-track-hud")).toBeNull();
    expect(featureLayer).toBeDefined();
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
    expect(
      figures[1].nextElementSibling?.classList.contains("stgy-track-graph") ?? false
    ).toBe(false);
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
            title: "東京駅",
            description: "複数画像・リンクのテスト",
            links: [
              "https://example.com",
              { href: "https://example.com/detail", text: "詳細ページ" },
            ],
            images: [
              "https://placehold.co/200x120",
              { src: "https://placehold.co/300x180", alt: "別画像" },
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
    const popupContent = featureLayer.bindPopup.mock.calls[0][0] as string | HTMLElement;
    const popupHtml = typeof popupContent === "string"
      ? popupContent
      : popupContent.outerHTML;

    expect(popupHtml).toContain('<div class="annot-title">東京駅</div>');
    expect(popupHtml).toContain('<div class="annot-desc">複数画像・リンクのテスト</div>');
    expect(popupHtml).toContain('class="annot-link"');
    expect(popupHtml).toContain('href="https://example.com/"');
    expect(popupHtml).toContain('href="https://example.com/detail"');
    expect(popupHtml).toContain('>詳細ページ</a>');
    expect(popupHtml).toContain('class="annot-image"');
    expect(popupHtml).toContain('src="https://placehold.co/200x120"');
    expect(popupHtml).toContain('src="https://placehold.co/300x180"');
    expect(popupHtml).toContain('alt="別画像"');
    expect(popupHtml).not.toContain("annot-img");
    expect(popupHtml).not.toContain("annot-href");
  });

  test("does not bind popup to route LineString features", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-route-popup">
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
              [139.767, 35.681],
              [139.770, 35.682],
            ],
          },
          properties: {
            title: "demo-toumi",
            description: "Converted from demo-toumi.fit",
            coordinateProperties: {
              elevations: [10, 20],
            },
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [139.767, 35.681],
          },
          properties: {
            title: "東京駅",
          },
        },
      ],
    });

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = (L.geoJSON as jest.Mock).mock.results.find((result) => {
      return result.value.__featureLayers?.length > 1;
    });

    const routeLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const pinLayer = renderedGeoJsonResult?.value.__featureLayers[1];

    expect(routeLayer.bindPopup).not.toHaveBeenCalled();
    expect(routeLayer.on).toHaveBeenCalled();
    expect(pinLayer.bindPopup).toHaveBeenCalled();
  });

  test("filters popup images from properties by allowedImagePatterns", async () => {
    renderer = new StgyTrackRenderer({
      allowedImagePatterns: [/^\/media\//],
    });

    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-popup-media-filter">
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
            title: "東京駅",
            images: [
              "/media/ok.jpg",
              "https://example.com/ng.jpg",
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
    const popupContent = featureLayer.bindPopup.mock.calls[0][0] as string | HTMLElement;
    const popupHtml = typeof popupContent === "string"
      ? popupContent
      : popupContent.outerHTML;

    expect(popupHtml).toContain('src="/media/ok.jpg"');
    expect(popupHtml).not.toContain("https://example.com/ng.jpg");
  });

  test("builds inline pin popup images from data-src and filters them", async () => {
    renderer = new StgyTrackRenderer({
      allowedImagePatterns: [/^\/media\//],
    });

    document.body.innerHTML = `
      <figure class="stgy-track-map" data-lat="35.681" data-lon="139.767">
        <div class="stgy-track-canvas"></div>
        <ul class="stgy-track-pins">
          <li data-lat="35.681" data-lon="139.767">
            <div class="annot-title">OK</div>
            <div class="annot-image" data-src="/media/ok.jpg" data-alt="OK"></div>
          </li>
          <li data-lat="35.682" data-lon="139.768">
            <div class="annot-title">NG</div>
            <div class="annot-image" data-src="https://example.com/ng.jpg" data-alt="NG"></div>
          </li>
        </ul>
      </figure>
    `;

    renderer.hydrate(document.body);

    const firstMarker = (L.marker as jest.Mock).mock.results[0].value;
    const secondMarker = (L.marker as jest.Mock).mock.results[1].value;
    const firstPopup = firstMarker.bindPopup.mock.calls[0][0] as HTMLElement;
    const secondPopup = secondMarker.bindPopup.mock.calls[0][0] as HTMLElement;

    expect(firstPopup.outerHTML).toContain('src="/media/ok.jpg"');
    expect(secondPopup.outerHTML).not.toContain("https://example.com/ng.jpg");
    expect(secondPopup.outerHTML).toContain('<div class="annot-title">NG</div>');
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
    expect(axisSelect?.className).toBe("stgy-track-graph-select");
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

  test("orders standard graph series by display priority", async () => {
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
              [139.7528, 35.6852],
              [139.7550, 35.6848],
              [139.7585, 35.6840],
            ],
          },
          properties: {
            coordinateProperties: {
              times: [1767222000, 1767222060, 1767222120],
              distances: [0, 210, 545],
              heartRates: [118, 123, 128],
              powers: [130, 145, 160],
              cadences: [72, 75, 78],
              speeds: [18.5, 19.2, 20.1],
              elevations: [20, 21, 22],
            },
          },
        },
      ],
    });

    renderer.hydrate(document.body);

    await flushPromises();

    const seriesSelect = document.querySelector<HTMLSelectElement>(
      '.stgy-track-graph select[aria-label="Graph series"]',
    );

    expect(seriesSelect).not.toBeNull();
    expect(Array.from(seriesSelect?.options || []).map((option) => option.value)).toEqual([
      "elevations",
      "speeds",
      "cadences",
      "heartRates",
      "powers",
    ]);
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

  test("highlights corresponding map point while hovering graph and removes it on leave", async () => {
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

    expect(L.circleMarker).toHaveBeenCalledWith([35.6848, 139.755], expect.objectContaining({
      radius: 7,
      interactive: false,
    }));
    expect(map.addLayer).toHaveBeenCalledWith(marker);
    expect(map.hasLayer(marker)).toBe(true);

    svg.dispatchEvent(new MouseEvent("mouseleave", {
      bubbles: true,
    }));

    expect(map.removeLayer).toHaveBeenCalledWith(marker);
    expect(map.hasLayer(marker)).toBe(false);
  });

  const setupBaseLayerMap = (baseLayer: string | null, isJapanValue: boolean) => {
    const baseLayerAttribute = baseLayer === null
      ? ""
      : ` data-base-layer="${baseLayer}"`;

    document.body.innerHTML = `
      <figure
        class="stgy-track-map"
        data-lat="35.681"
        data-lon="139.767"${baseLayerAttribute}>
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    isJapanSpy.mockReturnValue(isJapanValue);

    renderer.hydrate(document.body);

    const mapOptions = (L.map as jest.Mock).mock.calls[0][1] as {
      layers: Array<{ __url: string }>;
    };
    const baseMaps = (L.control.layers as jest.Mock).mock.calls[0][0] as Record<
      string,
      { __url: string }
    >;

    return {
      defaultUrl: mapOptions.layers[0].__url,
      baseMaps,
    };
  };

  test("uses GSI Pale by default in Japan", () => {
    const result = setupBaseLayerMap(null, true);

    expect(result.defaultUrl).toContain("/pale/");
  });

  test("uses CyclOSM by default outside Japan", () => {
    const result = setupBaseLayerMap(null, false);

    expect(result.defaultUrl).toContain("tile-cyclosm");
  });

  test("uses OpenStreetMap when data-base-layer is osm", () => {
    const result = setupBaseLayerMap("osm", true);

    expect(result.defaultUrl).toContain("tile.openstreetmap.org");
  });

  test("uses OpenStreetMap when data-base-layer is openstreetmap", () => {
    const result = setupBaseLayerMap("openstreetmap", true);

    expect(result.defaultUrl).toContain("tile.openstreetmap.org");
  });

  test("uses OpenStreetMap when data-base-layer is open-street-map", () => {
    const result = setupBaseLayerMap("open-street-map", true);

    expect(result.defaultUrl).toContain("tile.openstreetmap.org");
  });

  test("normalizes base layer names with spaces and case", () => {
    const result = setupBaseLayerMap(" Open Street Map ", true);

    expect(result.defaultUrl).toContain("tile.openstreetmap.org");
  });

  test("uses GSI Pale when data-base-layer is pale", () => {
    const result = setupBaseLayerMap("pale", true);

    expect(result.defaultUrl).toContain("/pale/");
  });

  test("uses GSI Standard when data-base-layer is std", () => {
    const result = setupBaseLayerMap("std", true);

    expect(result.defaultUrl).toContain("/std/");
  });

  test("uses GSI Standard when data-base-layer is gsi_standard", () => {
    const result = setupBaseLayerMap("gsi_standard", true);

    expect(result.defaultUrl).toContain("/std/");
  });

  test("uses GSI Photo when data-base-layer is photo", () => {
    const result = setupBaseLayerMap("photo", true);

    expect(result.defaultUrl).toContain("seamlessphoto");
  });

  test("allows requested GSI Photo outside Japan", () => {
    const result = setupBaseLayerMap("gsi-photo", false);

    expect(result.defaultUrl).toContain("seamlessphoto");
    expect(result.baseMaps).toHaveProperty("GSI Photo");
  });

  test("uses CyclOSM when data-base-layer is cycle", () => {
    const result = setupBaseLayerMap("cycle", true);

    expect(result.defaultUrl).toContain("tile-cyclosm");
  });

  test("uses OpenTopoMap when data-base-layer is topo", () => {
    const result = setupBaseLayerMap("topo", true);

    expect(result.defaultUrl).toContain("tile.opentopomap.org");
  });

  test("uses OpenTopoMap when data-base-layer is open_topo_map", () => {
    const result = setupBaseLayerMap("open_topo_map", true);

    expect(result.defaultUrl).toContain("tile.opentopomap.org");
  });

  test("falls back to GSI Pale for an invalid layer in Japan", () => {
    const result = setupBaseLayerMap("unknown-layer", true);

    expect(result.defaultUrl).toContain("/pale/");
  });

  test("falls back to CyclOSM for an invalid layer outside Japan", () => {
    const result = setupBaseLayerMap("unknown-layer", false);

    expect(result.defaultUrl).toContain("tile-cyclosm");
  });
});
