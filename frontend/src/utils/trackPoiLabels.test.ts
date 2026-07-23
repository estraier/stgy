import { decodeGeo } from "@/api/geo";
import { addTrackJsonPoiLabels } from "./trackPoiLabels";

jest.mock("@/api/geo", () => ({
  decodeGeo: jest.fn(),
}));

const mockDecodeGeo = decodeGeo as jest.MockedFunction<typeof decodeGeo>;

describe("addTrackJsonPoiLabels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("adds reverse-geocoded labels and deduplicates identical coordinates", async () => {
    mockDecodeGeo.mockResolvedValue([
      {
        level: 2,
        country: "JP",
        longitude: 138.2933,
        latitude: 36.37194,
        addresses: [
          {
            locale: "ja",
            label: "長野県上田市",
            elements: ["長野県", "上田市"],
          },
        ],
      },
    ]);

    const source = {
      poi: [
        { role: "start", coordinates: [138.2933, 36.37194] },
        { role: "centroid", coordinates: [138.2933, 36.37194] },
      ],
    };

    await expect(addTrackJsonPoiLabels(source)).resolves.toEqual({
      poi: [
        {
          role: "start",
          coordinates: [138.2933, 36.37194],
          label: "長野県上田市",
        },
        {
          role: "centroid",
          coordinates: [138.2933, 36.37194],
          label: "長野県上田市",
        },
      ],
    });
    expect(mockDecodeGeo).toHaveBeenCalledTimes(1);
    expect(mockDecodeGeo).toHaveBeenCalledWith(138.2933, 36.37194, "ja");
  });

  test("keeps a POI unlabeled when reverse geocoding has no result", async () => {
    mockDecodeGeo.mockResolvedValue([]);
    const source = {
      poi: [
        { role: "start", coordinates: [0, 0] },
      ],
    };

    await expect(addTrackJsonPoiLabels(source)).resolves.toBe(source);
  });

  test("uses the requested locale address when available", async () => {
    mockDecodeGeo.mockResolvedValue([
      {
        level: 2,
        country: "JP",
        longitude: 138.2933,
        latitude: 36.37194,
        addresses: [
          {
            locale: "en",
            label: "Ueda, Nagano",
            elements: ["Nagano", "Ueda"],
          },
          {
            locale: "ja",
            label: "長野県上田市",
            elements: ["長野県", "上田市"],
          },
        ],
      },
    ]);

    await expect(addTrackJsonPoiLabels({
      poi: [{ role: "start", coordinates: [138.2933, 36.37194] }],
    })).resolves.toEqual({
      poi: [{
        role: "start",
        coordinates: [138.2933, 36.37194],
        label: "長野県上田市",
      }],
    });
  });
});
