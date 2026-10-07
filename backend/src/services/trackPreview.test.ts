import { jest } from "@jest/globals";
import { gunzipSync } from "zlib";
import type { GeoCoder } from "stgy-geocoder";
import { makeFitTrackPreview, makeTrackJsonTrackPreview } from "./trackPreview";

jest.mock(
  "stgy-track/fit",
  () => ({
    parseFitBytes: jest.fn(),
    downsampleTrackActivity: jest.fn(),
    trackActivityToTrackJson: jest.fn(),
  }),
  { virtual: true },
);

jest.mock(
  "stgy-track/trackjson",
  () => ({
    parseTrackJsonData: (text: string) => JSON.parse(text),
    downsampleTrackJsonData: jest.fn((data: unknown) => data),
    compactTrackJsonData: (data: unknown) => data,
    countTrackJsonPositionedPoints: jest.fn(() => 3),
    getTrackJsonPoi: (data: unknown) => {
      if (typeof data !== "object" || data === null || !("poi" in data)) {
        return [];
      }
      const poi = (data as { poi?: unknown }).poi;
      return Array.isArray(poi) ? poi : [];
    },
    applyTrackJsonPoiLabels: (
      data: unknown,
      assignments: { longitude: number; latitude: number; label: string }[],
    ) => {
      if (typeof data !== "object" || data === null || !("poi" in data)) {
        return data;
      }
      const source = data as { poi?: unknown[] };
      const labels = new Map(
        assignments.map((assignment) => [
          `${assignment.longitude},${assignment.latitude}`,
          assignment.label,
        ]),
      );
      return {
        ...source,
        poi: source.poi?.map((point) => {
          if (typeof point !== "object" || point === null || !("coordinates" in point)) {
            return point;
          }
          const coordinates = (point as { coordinates?: unknown }).coordinates;
          if (!Array.isArray(coordinates)) {
            return point;
          }
          const label = labels.get(`${coordinates[0]},${coordinates[1]}`);
          return label ? { ...point, label } : point;
        }),
      };
    },
  }),
  { virtual: true },
);

const fitModuleMock = jest.requireMock("stgy-track/fit") as {
  parseFitBytes: ReturnType<typeof jest.fn>;
  downsampleTrackActivity: ReturnType<typeof jest.fn>;
  trackActivityToTrackJson: ReturnType<typeof jest.fn>;
};
const trackJsonModuleMock = jest.requireMock("stgy-track/trackjson") as {
  downsampleTrackJsonData: ReturnType<typeof jest.fn>;
  countTrackJsonPositionedPoints: ReturnType<typeof jest.fn>;
};
const parseFitBytesMock = fitModuleMock.parseFitBytes;
const downsampleTrackActivityMock = fitModuleMock.downsampleTrackActivity;
const trackActivityToTrackJsonMock = fitModuleMock.trackActivityToTrackJson;
const downsampleTrackJsonDataMock = trackJsonModuleMock.downsampleTrackJsonData;
const countTrackJsonPositionedPointsMock = trackJsonModuleMock.countTrackJsonPositionedPoints;

beforeEach(() => {
  jest.clearAllMocks();
  downsampleTrackJsonDataMock.mockImplementation((data: unknown) => data);
  countTrackJsonPositionedPointsMock.mockReturnValue(3);
});

describe("trackPreview", () => {
  test("downsamples FIT previews after converting the full activity to TrackJSON", async () => {
    const activity = {
      schemaVersion: 1,
      metadata: { source: { type: "fit" } },
      points: [{ segmentId: 0 }, { segmentId: 1 }, { segmentId: 2 }],
      warnings: [],
    };
    const full = {
      type: "FeatureCollection",
      stgyGraphGroup: "trackActivity",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [[139, 35], [139.1, 35.1], [139.2, 35.2]],
          },
          properties: {
            coordinateProperties: {
              segmentIds: [0, 1, 2],
              powers: [100, 200, 300],
            },
          },
        },
      ],
    };
    const sampled = { ...full, sampled: true };
    parseFitBytesMock.mockReturnValue(activity as never);
    trackActivityToTrackJsonMock.mockReturnValue(JSON.stringify(full));
    downsampleTrackJsonDataMock.mockReturnValue(sampled);
    const geoCoder = { decode: jest.fn(() => []) } as unknown as GeoCoder;

    const compressed = await makeFitTrackPreview(new Uint8Array([1, 2, 3]), 3000, geoCoder);
    const output = JSON.parse(gunzipSync(compressed).toString("utf8"));

    expect(output).toEqual(sampled);
    expect(trackActivityToTrackJsonMock).toHaveBeenCalledWith(activity, { pretty: false });
    expect(downsampleTrackJsonDataMock).toHaveBeenCalledWith(full, {
      maxPoints: 3000,
      strategy: "uniform",
      preserveEndpoints: true,
    });
    expect(downsampleTrackActivityMock).not.toHaveBeenCalled();
  });
  test(
    "falls back to activity downsampling when split TrackJSON features exceed the global cap",
    async () => {
      const activity = {
        schemaVersion: 1,
        metadata: { source: { type: "fit" } },
        points: new Array(7500).fill({}),
        warnings: [],
      };
      const full = { type: "FeatureCollection", stgyGraphGroup: "trackActivity", features: [] };
      const splitPreview = { ...full, splitPoints: 7500 };
      const sampledActivity = { ...activity, points: new Array(3000).fill({}) };
      const final = { ...full, finalPoints: 3000 };

      parseFitBytesMock.mockReturnValue(activity as never);
      trackActivityToTrackJsonMock
        .mockReturnValueOnce(JSON.stringify(full))
        .mockReturnValueOnce(JSON.stringify(final));
      downsampleTrackJsonDataMock.mockReturnValue(splitPreview);
      countTrackJsonPositionedPointsMock.mockReturnValueOnce(7500);
      downsampleTrackActivityMock.mockReturnValue(sampledActivity as never);
      const geoCoder = { decode: jest.fn(() => []) } as unknown as GeoCoder;

      const compressed = await makeFitTrackPreview(new Uint8Array([1, 2, 3]), 3000, geoCoder);
      const output = JSON.parse(gunzipSync(compressed).toString("utf8"));

      expect(output).toEqual(final);
      expect(downsampleTrackActivityMock).toHaveBeenCalledWith(activity, {
        maxPoints: 3000,
        strategy: "uniform",
        preserveEndpoints: true,
      });
    },
  );

  test("adds Japanese place labels to unique TrackJSON POI coordinates", async () => {
    const decode = jest.fn((longitude: number, latitude: number) => {
      if (longitude === 139.46 && latitude === 35.8) {
        return [
          {
            level: 3,
            country: "JP",
            longitude,
            latitude,
            addresses: [
              {
                locale: "en",
                label: "Tokorozawa, Saitama, Japan",
                elements: ["Japan", "Saitama", "Tokorozawa"],
              },
              {
                locale: "ja",
                label: "日本埼玉県所沢市",
                elements: ["日本", "埼玉県", "所沢市"],
              },
            ],
          },
        ];
      }
      return [];
    });
    const geoCoder = { decode } as unknown as GeoCoder;
    const input = JSON.stringify({
      type: "FeatureCollection",
      poi: [
        { role: "start", coordinates: [139.46, 35.8] },
        { role: "centroid", coordinates: [139.46, 35.8] },
        { role: "end", coordinates: [139.5, 35.9] },
      ],
      features: [],
    });

    const compressed = await makeTrackJsonTrackPreview(input, 3000, geoCoder);
    const output = JSON.parse(gunzipSync(compressed).toString("utf8"));

    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode).toHaveBeenCalledWith(139.46, 35.8, "ja");
    expect(decode).toHaveBeenCalledWith(139.5, 35.9, "ja");
    expect(output.poi).toEqual([
      { role: "start", coordinates: [139.46, 35.8], label: "日本埼玉県所沢市" },
      { role: "centroid", coordinates: [139.46, 35.8], label: "日本埼玉県所沢市" },
      { role: "end", coordinates: [139.5, 35.9] },
    ]);
  });
});
