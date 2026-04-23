import L from "leaflet";
import { StgyTrackRenderer } from "./renderer";
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
        pad: jest.fn().mockReturnThis()
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

  test("calls fitBounds when data-zoom is not provided", async () => {
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
});
