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
      on: jest.fn(),
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
    map.on.mockReturnValue(map);

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
    setStyle: jest.fn().mockReturnThis(),
    bringToFront: jest.fn().mockReturnThis(),
  });

  return {
    ...originalL,
    DomEvent: {
      ...originalL.DomEvent,
      stopPropagation: jest.fn(),
    },
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

const setSvgRect = (svg: SVGSVGElement) => {
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
};

const hoverGraphAtMiddlePoint = (svg: SVGSVGElement) => {
  setSvgRect(svg);
  svg.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true,
    clientX: 333,
    clientY: 90,
  }));
};

const findRenderedGeoJsonWithFeatureLayers = (count?: number) => {
  return (L.geoJSON as jest.Mock).mock.results.find((result) => {
    const layers = result.value.__featureLayers;
    if (!layers || layers.length === 0) {
      return false;
    }
    return typeof count === "number" ? layers.length === count : true;
  });
};

const getLayerHandler = (layer: any, eventName: string) => {
  return layer.on.mock.calls.find((call: unknown[]) => call[0] === eventName)?.[1];
};

const getMapHandler = (map: any, eventName: string) => {
  return map.on.mock.calls.find((call: unknown[]) => call[0] === eventName)?.[1];
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

const makeTwoRouteTrackWithGraphs = () => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [139.7500, 35.6800],
          [139.7510, 35.6810],
          [139.7520, 35.6820],
        ],
      },
      properties: {
        color: "#ff0000",
        weight: 4,
        opacity: 0.8,
        coordinateProperties: {
          distances: [0, 100, 200],
          elevations: [10, 11, 12],
          heartRates: [100, 101, 102],
        },
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [139.7600, 35.6900],
          [139.7610, 35.6910],
          [139.7620, 35.6920],
        ],
      },
      properties: {
        color: "#00aa00",
        weight: 5,
        opacity: 0.7,
        coordinateProperties: {
          distances: [0, 1000, 2000],
          elevations: [100, 200, 300],
          heartRates: [120, 130, 140],
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

  test("renders download action link with custom label and filename", () => {
    document.body.innerHTML = `
      <figure
        class="stgy-track-map"
        data-download-src="/maps/masters/112233/4c712e88c5542322.fit"
        data-download-label="Download original FIT file"
        data-download-filename="ride.fit">
        <div class="stgy-track-canvas"></div>
        <figcaption class="stgy-track-caption">Ride to Kamakura</figcaption>
      </figure>
    `;

    renderer.hydrate(document.body);

    const figure = document.querySelector<HTMLElement>(".stgy-track-map");
    const caption = document.querySelector<HTMLElement>(".stgy-track-caption");
    const actions = document.querySelector<HTMLElement>(".stgy-track-actions");
    const link = document.querySelector<HTMLAnchorElement>(".stgy-track-download");

    expect(figure).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(link).not.toBeNull();
    expect(caption?.nextElementSibling).toBe(actions);
    expect(actions?.parentElement).toBe(figure);
    expect(link?.textContent).toBe("Download original FIT file");
    expect(link?.href.endsWith("/maps/masters/112233/4c712e88c5542322.fit")).toBe(true);
    expect(link?.download).toBe("ride.fit");
  });

  test("renders download action link with default label and no download attribute", () => {
    document.body.innerHTML = `
      <figure
        class="stgy-track-map"
        data-download-src="/maps/masters/112233/4c712e88c5542322.trjgz">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    renderer.hydrate(document.body);

    const actions = document.querySelector<HTMLElement>(".stgy-track-actions");
    const link = document.querySelector<HTMLAnchorElement>(".stgy-track-download");

    expect(actions).not.toBeNull();
    expect(link).not.toBeNull();
    expect(actions?.parentElement).toBe(document.querySelector(".stgy-track-map"));
    expect(link?.textContent).toBe("Download original data");
    expect(link?.href.endsWith("/maps/masters/112233/4c712e88c5542322.trjgz")).toBe(true);
    expect(link?.hasAttribute("download")).toBe(false);
  });

  test("does not render download action link without data-download-src", () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map">
        <div class="stgy-track-canvas"></div>
        <figcaption class="stgy-track-caption">No download</figcaption>
      </figure>
    `;

    renderer.hydrate(document.body);

    expect(document.querySelector(".stgy-track-actions")).toBeNull();
    expect(document.querySelector(".stgy-track-download")).toBeNull();
  });

  test("rejects unsafe download action URLs", () => {
    document.body.innerHTML = `
      <figure
        class="stgy-track-map"
        data-download-src="javascript:alert(1)"
        data-download-label="Bad JavaScript URL">
        <div class="stgy-track-canvas"></div>
      </figure>
      <figure
        class="stgy-track-map"
        data-download-src="data:text/html,<script>alert(1)</script>"
        data-download-label="Bad data URL">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    renderer.hydrate(document.body);

    expect(document.querySelector(".stgy-track-actions")).toBeNull();
    expect(document.querySelector(".stgy-track-download")).toBeNull();
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
    const clickHandler = getLayerHandler(marker, "click");
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

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = getLayerHandler(featureLayer, "mousemove");

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

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = getLayerHandler(featureLayer, "mousemove");
    const mouseoutHandler = getLayerHandler(featureLayer, "mouseout");

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

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = getLayerHandler(featureLayer, "mousemove");
    const mouseoutHandler = getLayerHandler(featureLayer, "mouseout");

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

  test("shows graph hover indicator when hovering the active route", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#multi-route">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTwoRouteTrackWithGraphs());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers(2);
    const firstLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = getLayerHandler(firstLayer, "mousemove");

    expect(typeof mousemoveHandler).toBe("function");

    mousemoveHandler({
      latlng: { lat: 35.6810, lng: 139.7510 },
    });

    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const readout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");

    expect(line).not.toBeNull();
    expect(point).not.toBeNull();
    expect(readout).not.toBeNull();
    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(line?.getAttribute("x1")).toBe("416");
    expect(line?.getAttribute("x2")).toBe("416");
    expect(readout?.textContent).toBe("0.10 km / 11.0 m");
  });

  test("clears graph hover indicator when leaving the active route", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#multi-route">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTwoRouteTrackWithGraphs());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers(2);
    const firstLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = getLayerHandler(firstLayer, "mousemove");
    const mouseoutHandler = getLayerHandler(firstLayer, "mouseout");

    mousemoveHandler({
      latlng: { lat: 35.6810, lng: 139.7510 },
    });

    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const readout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");

    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(readout?.textContent).toBe("0.10 km / 11.0 m");

    mouseoutHandler();

    expect(line?.getAttribute("hidden")).toBe("true");
    expect(point?.getAttribute("hidden")).toBe("true");
    expect(readout?.textContent).toBe("");
  });

  test("does not move graph hover indicator when hovering an inactive route", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#multi-route">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTwoRouteTrackWithGraphs());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers(2);
    const secondLayer = renderedGeoJsonResult?.value.__featureLayers[1];
    const mousemoveHandler = getLayerHandler(secondLayer, "mousemove");

    expect(typeof mousemoveHandler).toBe("function");

    mousemoveHandler({
      latlng: { lat: 35.6910, lng: 139.7610 },
    });

    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const readout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");
    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");

    expect(line?.getAttribute("hidden")).toBe("true");
    expect(point?.getAttribute("hidden")).toBe("true");
    expect(readout?.textContent).toBe("");
    expect(overlay?.hidden).toBe(false);
    expect(overlay?.textContent).toContain("distances: 1.00 km");
    expect(overlay?.textContent).toContain("elevations: 200 m");
    expect(overlay?.textContent).toContain("heart rates: 130 bpm");
  });

  test("shows graph hover indicator after switching active route by click", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#multi-route">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTwoRouteTrackWithGraphs());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers(2);
    const secondLayer = renderedGeoJsonResult?.value.__featureLayers[1];
    const clickHandler = getLayerHandler(secondLayer, "click");
    const mousemoveHandler = getLayerHandler(secondLayer, "mousemove");

    expect(typeof clickHandler).toBe("function");
    expect(typeof mousemoveHandler).toBe("function");

    clickHandler();

    mousemoveHandler({
      latlng: { lat: 35.6910, lng: 139.7610 },
    });

    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const readout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");

    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(line?.getAttribute("x1")).toBe("416");
    expect(line?.getAttribute("x2")).toBe("416");
    expect(readout?.textContent).toBe("1.00 km / 200.0 m");
  });

  test("pins route sample on route click and keeps it after mouseout", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const clickHandler = getLayerHandler(featureLayer, "click");
    const mouseoutHandler = getLayerHandler(featureLayer, "mouseout");

    expect(typeof clickHandler).toBe("function");
    expect(typeof mouseoutHandler).toBe("function");

    clickHandler({
      latlng: { lat: 35.6848, lng: 139.7550 },
      originalEvent: new MouseEvent("click"),
    });

    const map = (L.map as jest.Mock).mock.results[0].value;
    const marker = (L.circleMarker as jest.Mock).mock.results[0].value;
    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const readout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");
    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");

    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(readout?.textContent).toBe("0.21 km / 21.0 m");
    expect(overlay?.hidden).toBe(false);
    expect(overlay?.textContent).toContain("distances: 0.21 km");
    expect(overlay?.textContent).toContain("elevations: 21 m");
    expect(map.hasLayer(marker)).toBe(true);

    mouseoutHandler();

    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(readout?.textContent).toBe("0.21 km / 21.0 m");
    expect(overlay?.hidden).toBe(false);
    expect(map.hasLayer(marker)).toBe(true);
  });

  test("pins graph sample on pointerdown and keeps it after mouseleave", async () => {
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

    setSvgRect(svg);

    svg.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 333,
      clientY: 90,
      buttons: 1,
    }));

    const map = (L.map as jest.Mock).mock.results[0].value;
    const marker = (L.circleMarker as jest.Mock).mock.results[0].value;
    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");

    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(readout.textContent).toBe("0.21 km / 21.0 m");
    expect(overlay?.hidden).toBe(false);
    expect(map.hasLayer(marker)).toBe(true);

    svg.dispatchEvent(new MouseEvent("mouseleave", {
      bubbles: true,
    }));

    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(readout.textContent).toBe("0.21 km / 21.0 m");
    expect(overlay?.hidden).toBe(false);
    expect(map.hasLayer(marker)).toBe(true);
  });

  test("updates pinned graph sample while dragging with pointermove", async () => {
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

    setSvgRect(svg);

    svg.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 52,
      clientY: 90,
      buttons: 1,
    }));

    expect(readout.textContent).toBe("0.00 km / 20.0 m");

    svg.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 780,
      clientY: 90,
      buttons: 1,
    }));

    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");

    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(readout.textContent).toBe("0.55 km / 22.0 m");
    expect(overlay?.textContent).toContain("distances: 0.55 km");
    expect(overlay?.textContent).toContain("elevations: 22 m");
  });

  test("ignores graph pointermove without pressed button", async () => {
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

    setSvgRect(svg);

    svg.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 52,
      clientY: 90,
      buttons: 1,
    }));

    expect(readout.textContent).toBe("0.00 km / 20.0 m");

    svg.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 780,
      clientY: 90,
      buttons: 0,
    }));

    expect(readout.textContent).toBe("0.00 km / 20.0 m");
  });

  test("clears graph pinned sample on map background click", async () => {
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

    setSvgRect(svg);

    svg.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 333,
      clientY: 90,
      buttons: 1,
    }));

    const map = (L.map as jest.Mock).mock.results[0].value;
    const mapClickHandler = getMapHandler(map, "click");
    const marker = (L.circleMarker as jest.Mock).mock.results[0].value;
    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");

    expect(typeof mapClickHandler).toBe("function");
    expect(map.hasLayer(marker)).toBe(true);
    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(readout.textContent).toBe("0.21 km / 21.0 m");
    expect(overlay?.hidden).toBe(false);

    mapClickHandler();

    expect(map.hasLayer(marker)).toBe(false);
    expect(line?.getAttribute("hidden")).toBe("true");
    expect(point?.getAttribute("hidden")).toBe("true");
    expect(readout.textContent).toBe("");
    expect(overlay?.hidden).toBe(true);
  });

  test("ignores immediate map click after route click and clears on next map click", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const routeClickHandler = getLayerHandler(featureLayer, "click");

    expect(typeof routeClickHandler).toBe("function");

    routeClickHandler({
      latlng: { lat: 35.6848, lng: 139.7550 },
      originalEvent: new MouseEvent("click"),
    });

    const map = (L.map as jest.Mock).mock.results[0].value;
    const mapClickHandler = getMapHandler(map, "click");
    const marker = (L.circleMarker as jest.Mock).mock.results[0].value;
    const line = document.querySelector<SVGLineElement>(".stgy-track-graph-hover-line");
    const point = document.querySelector<SVGCircleElement>(".stgy-track-graph-hover-point");
    const readout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");
    const overlay = document.querySelector<HTMLElement>(".stgy-track-hud");

    expect(typeof mapClickHandler).toBe("function");
    expect(map.hasLayer(marker)).toBe(true);
    expect(readout?.textContent).toBe("0.21 km / 21.0 m");
    expect(overlay?.hidden).toBe(false);

    mapClickHandler();

    expect(map.hasLayer(marker)).toBe(true);
    expect(line?.getAttribute("hidden")).toBeNull();
    expect(point?.getAttribute("hidden")).toBeNull();
    expect(readout?.textContent).toBe("0.21 km / 21.0 m");
    expect(overlay?.hidden).toBe(false);

    mapClickHandler();

    expect(map.hasLayer(marker)).toBe(false);
    expect(line?.getAttribute("hidden")).toBe("true");
    expect(point?.getAttribute("hidden")).toBe("true");
    expect(readout?.textContent).toBe("");
    expect(overlay?.hidden).toBe(true);
  });

  test("stops route click propagation to keep pinned sample", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-hud">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTrackWithGraph());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const clickHandler = getLayerHandler(featureLayer, "click");
    const originalEvent = new MouseEvent("click");

    expect(typeof clickHandler).toBe("function");

    clickHandler({
      latlng: { lat: 35.6848, lng: 139.7550 },
      originalEvent,
    });

    expect(L.DomEvent.stopPropagation).toHaveBeenCalledWith(originalEvent);
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

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const mousemoveHandler = getLayerHandler(featureLayer, "mousemove");

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

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const popupElement = featureLayer.bindPopup.mock.calls[0][0] as HTMLElement;

    expect(popupElement.querySelector(".annot-title")?.textContent).toBe("Tokyo Station");
    expect(popupElement.querySelector(".annot-desc")?.textContent).toBe("Multiple media test");

    const links = Array.from(popupElement.querySelectorAll<HTMLAnchorElement>(".annot-link a"));
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe("https://example.com");
    expect(links[0].getAttribute("href")).toBe("https://example.com/");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[1].textContent).toBe("Details");
    expect(links[1].getAttribute("href")).toBe("https://example.com/detail");

    const images = Array.from(popupElement.querySelectorAll<HTMLImageElement>(".annot-image img"));
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("src")).toBe("https://placehold.co/200x120");
    expect(images[0].getAttribute("alt")).toBe("");
    expect(images[0].referrerPolicy).toBe("no-referrer");
    expect(images[0].loading).toBe("lazy");
    expect(images[0].decoding).toBe("async");
    expect(images[1].getAttribute("src")).toBe("https://placehold.co/300x180");
    expect(images[1].getAttribute("alt")).toBe("Alternate image");
    expect(images[1].referrerPolicy).toBe("no-referrer");
    expect(popupElement.querySelector(".annot-img")).toBeNull();
    expect(popupElement.querySelector(".annot-href")).toBeNull();
  });

  test("sanitizes popup content and rejects unsafe URLs from properties", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#demo-geojson-xss">
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
            title: "<img src=x onerror=alert(1)>",
            description: "<script>alert(1)</script>",
            links: [
              "javascript:alert(1)",
              { href: "data:text/html,<script>alert(1)</script>", text: "Bad data URL" },
              { href: "https://safe.example/path", text: "<b>Safe link</b>" },
            ],
            images: [
              { src: "javascript:alert(1)", alt: "Bad image" },
              { src: "data:image/svg+xml,<svg onload=alert(1)>", alt: "Bad data image" },
              { src: "https://safe.example/image.png", alt: "<script>Safe alt</script>" },
            ],
          },
        },
      ],
    });

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers();
    const featureLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const popupElement = featureLayer.bindPopup.mock.calls[0][0] as HTMLElement;

    expect(popupElement.querySelector(".annot-title")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(popupElement.querySelector(".annot-desc")?.textContent).toBe("<script>alert(1)</script>");
    expect(popupElement.querySelector("script")).toBeNull();
    expect(popupElement.querySelector("img[src^='javascript']")).toBeNull();
    expect(popupElement.querySelector("a[href^='javascript']")).toBeNull();
    expect(popupElement.querySelector("a[href^='data']")).toBeNull();
    expect(popupElement.querySelector("img[src^='data']")).toBeNull();

    const links = Array.from(popupElement.querySelectorAll<HTMLAnchorElement>(".annot-link a"));
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("<b>Safe link</b>");
    expect(links[0].getAttribute("href")).toBe("https://safe.example/path");

    const images = Array.from(popupElement.querySelectorAll<HTMLImageElement>(".annot-image img"));
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("https://safe.example/image.png");
    expect(images[0].getAttribute("alt")).toBe("<script>Safe alt</script>");
    expect(images[0].referrerPolicy).toBe("no-referrer");
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

    hoverGraphAtMiddlePoint(svg);

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

    const map = (L.map as jest.Mock).mock.results[0].value;

    hoverGraphAtMiddlePoint(svg);

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

  test("switches graph dataset when a route layer is clicked", async () => {
    document.body.innerHTML = `
      <figure class="stgy-track-map" data-src="#multi-route">
        <div class="stgy-track-canvas"></div>
      </figure>
    `;

    jest.spyOn(TrackLoader.prototype, "load").mockResolvedValue(makeTwoRouteTrackWithGraphs());

    renderer.hydrate(document.body);

    await flushPromises();

    const renderedGeoJsonResult = findRenderedGeoJsonWithFeatureLayers(2);
    const firstLayer = renderedGeoJsonResult?.value.__featureLayers[0];
    const secondLayer = renderedGeoJsonResult?.value.__featureLayers[1];

    expect(firstLayer).toBeDefined();
    expect(secondLayer).toBeDefined();

    const secondClickHandler = getLayerHandler(secondLayer, "click");
    expect(typeof secondClickHandler).toBe("function");

    const firstSvg = document.querySelector<SVGSVGElement>(".stgy-track-graph svg");
    const firstReadout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");

    expect(firstSvg).not.toBeNull();
    expect(firstReadout).not.toBeNull();

    if (!firstSvg || !firstReadout) return;

    hoverGraphAtMiddlePoint(firstSvg);

    expect(firstReadout.textContent).toBe("0.10 km / 11.0 m");

    secondClickHandler();

    const secondSvg = document.querySelector<SVGSVGElement>(".stgy-track-graph svg");
    const secondReadout = document.querySelector<HTMLElement>(".stgy-track-graph-readout");

    expect(secondSvg).not.toBeNull();
    expect(secondReadout).not.toBeNull();

    if (!secondSvg || !secondReadout) return;

    hoverGraphAtMiddlePoint(secondSvg);

    expect(secondReadout.textContent).toBe("1.00 km / 200.0 m");
    expect(firstLayer.setStyle).toHaveBeenCalledWith(expect.objectContaining({
      color: "#ff0000",
      weight: 4,
      opacity: 0.8,
    }));
    expect(secondLayer.setStyle).toHaveBeenCalledWith(expect.objectContaining({
      color: "#00aa00",
      weight: 7,
      opacity: 1,
    }));
    expect(secondLayer.bringToFront).toHaveBeenCalled();
  });
});
