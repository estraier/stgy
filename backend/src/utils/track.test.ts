import { gzipSync } from "zlib";
import {
  gunzipWithLimit,
  sniffFitHeader,
  sniffGzipHeader,
  validateTrackJsonOperationalLimits,
} from "./track";

function makeFitHeader(headerSize = 14): Uint8Array {
  const bytes = new Uint8Array(headerSize);
  bytes[0] = headerSize;
  bytes[8] = 0x2e;
  bytes[9] = 0x46;
  bytes[10] = 0x49;
  bytes[11] = 0x54;
  return bytes;
}

describe("track utility validation", () => {
  test("sniffFitHeader accepts FIT magic", () => {
    expect(sniffFitHeader(makeFitHeader(12))).toBe(true);
    expect(sniffFitHeader(makeFitHeader(14))).toBe(true);
  });

  test("sniffFitHeader rejects invalid FIT magic", () => {
    expect(sniffFitHeader(new Uint8Array([1, 2, 3]))).toBe(false);
    const bytes = makeFitHeader();
    bytes[10] = 0x58;
    expect(sniffFitHeader(bytes)).toBe(false);
  });

  test("sniffGzipHeader accepts gzip magic", () => {
    const bytes = new Uint8Array(gzipSync(Buffer.from("{}")));
    expect(sniffGzipHeader(bytes)).toBe(true);
  });

  test("sniffGzipHeader rejects non gzip data", () => {
    expect(sniffGzipHeader(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  test("gunzipWithLimit returns uncompressed bytes under limit", async () => {
    const src = Buffer.from("hello");
    const out = await gunzipWithLimit(new Uint8Array(gzipSync(src)), 100);
    expect(Buffer.from(out).toString("utf8")).toBe("hello");
  });

  test("gunzipWithLimit rejects output over limit", async () => {
    const src = Buffer.from("x".repeat(1024));
    await expect(gunzipWithLimit(new Uint8Array(gzipSync(src)), 100)).rejects.toThrow(
      /too large/i,
    );
  });

  test("validateTrackJsonOperationalLimits accepts small TrackJSON", () => {
    const data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [139.0, 35.0],
              [139.1, 35.1],
            ],
          },
          properties: {
            coordinateProperties: {
              times: [1, 2],
              powers: [100, 101],
            },
          },
        },
      ],
    };
    expect(() =>
      validateTrackJsonOperationalLimits(data, {
        maxFeatures: 10,
        maxPoints: 10,
        maxPropertyValues: 20,
        maxDepth: 20,
      }),
    ).not.toThrow();
  });

  test("validateTrackJsonOperationalLimits rejects too many features", () => {
    const data = {
      type: "FeatureCollection",
      features: [{}, {}, {}],
    };
    expect(() =>
      validateTrackJsonOperationalLimits(data, {
        maxFeatures: 2,
        maxPoints: 100,
        maxPropertyValues: 100,
        maxDepth: 20,
      }),
    ).toThrow(/too many track features/i);
  });

  test("validateTrackJsonOperationalLimits rejects too many points", () => {
    const data = {
      type: "FeatureCollection",
      features: [
        {
          geometry: {
            coordinates: [
              [139.0, 35.0],
              [139.1, 35.1],
              [139.2, 35.2],
            ],
          },
        },
      ],
    };
    expect(() =>
      validateTrackJsonOperationalLimits(data, {
        maxFeatures: 10,
        maxPoints: 2,
        maxPropertyValues: 100,
        maxDepth: 20,
      }),
    ).toThrow(/too many track points/i);
  });

  test("validateTrackJsonOperationalLimits rejects too many coordinate properties", () => {
    const data = {
      type: "FeatureCollection",
      features: [
        {
          properties: {
            coordinateProperties: {
              times: [1, 2, 3],
              powers: [100, 101, 102],
            },
          },
        },
      ],
    };
    expect(() =>
      validateTrackJsonOperationalLimits(data, {
        maxFeatures: 10,
        maxPoints: 100,
        maxPropertyValues: 5,
        maxDepth: 20,
      }),
    ).toThrow(/too many track property values/i);
  });

  test("validateTrackJsonOperationalLimits rejects deep JSON", () => {
    const data = {
      type: "FeatureCollection",
      features: [
        {
          properties: {
            a: {
              b: {
                c: {
                  d: {},
                },
              },
            },
          },
        },
      ],
    };
    expect(() =>
      validateTrackJsonOperationalLimits(data, {
        maxFeatures: 10,
        maxPoints: 100,
        maxPropertyValues: 100,
        maxDepth: 5,
      }),
    ).toThrow(/too deep/i);
  });
});
