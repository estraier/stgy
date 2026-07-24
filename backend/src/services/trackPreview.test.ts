import { jest } from "@jest/globals";
import { gunzipSync } from "zlib";
import type { GeoCoder } from "stgy-geocoder";
import { makeTrackJsonTrackPreview } from "./trackPreview";

jest.mock(
  "stgy-track/trackjson",
  () => ({
    parseTrackJsonData: (text: string) => JSON.parse(text),
    downsampleTrackJsonData: (data: unknown) => data,
    compactTrackJsonData: (data: unknown) => data,
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

describe("trackPreview", () => {
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
              { locale: "en", label: "Tokorozawa, Saitama", elements: [] },
              { locale: "ja", label: "埼玉県所沢市", elements: [] },
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
      { role: "start", coordinates: [139.46, 35.8], label: "埼玉県所沢市" },
      { role: "centroid", coordinates: [139.46, 35.8], label: "埼玉県所沢市" },
      { role: "end", coordinates: [139.5, 35.9] },
    ]);
  });
});
