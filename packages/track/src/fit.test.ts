import { Decoder, Stream } from "@garmin/fitsdk";
import {
  TrackJsonConversionError,
  TrackParseError,
  downsampleTrackActivity,
  parseFitBytes,
  trackActivityToTrackJson,
} from "./fit";
import type { TrackActivity, TrackPoint } from "./fit";

jest.mock("@garmin/fitsdk", () => {
  return {
    Decoder: jest.fn(),
    Stream: {
      fromArrayBuffer: jest.fn(),
    },
  };
});

type MockFitReadResult = {
  messages?: Record<string, unknown>;
  errors?: unknown[];
};

const decoderMock = Decoder as unknown as jest.Mock;
const fromArrayBufferMock = Stream.fromArrayBuffer as unknown as jest.Mock;

beforeEach(() => {
  decoderMock.mockReset();
  fromArrayBufferMock.mockReset();
  fromArrayBufferMock.mockReturnValue({});
});

describe("parseFitBytes", () => {
  test("rejects empty input", () => {
    expect(() => parseFitBytes(new ArrayBuffer(0))).toThrow(TrackParseError);
    expect(() => parseFitBytes(new ArrayBuffer(0))).toThrow("FIT input is empty");
  });

  test("rejects non-FIT input", () => {
    mockDecoder(false, {
      messages: {},
    });

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(TrackParseError);
    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      "Input is not a FIT file"
    );
  });

  test("rejects FIT input without records", () => {
    mockDecoder(true, {
      messages: {},
    });

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(TrackParseError);
    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      "FIT data does not contain record messages"
    );
  });

  test("reports decoder errors when no records exist", () => {
    mockDecoder(true, {
      messages: {},
      errors: [new Error("broken crc")],
    });

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow("broken crc");
  });

  test("parses record messages and metadata", () => {
    mockDecoder(true, {
      messages: {
        fileIdMesgs: [{
          timeCreated: new Date("2024-03-01T00:00:00Z"),
          manufacturer: "garmin",
          productName: "edge",
          serialNumber: 123456,
        }],
        sportMesgs: [{
          sport: "cycling",
          subSport: "road",
        }],
        sessionMesgs: [{
          startTime: new Date("2024-03-01T01:00:00Z"),
          totalElapsedTime: 3900.4,
          totalTimerTime: 3600.6,
          totalDistance: 12345.67,
        }],
        recordMesgs: [{
          timestamp: new Date("2024-03-01T01:00:01Z"),
          positionLat: 35.1234567,
          positionLong: 139.1234567,
          distance: 12.3,
          enhancedAltitude: 101.2,
          altitude: 99.9,
          heartRate: 120,
          cadence: 81,
          power: 150,
          enhancedSpeed: 5.5,
          speed: 5.1,
          temperature: 20,
        }],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.schemaVersion).toBe(1);
    expect(activity.metadata.source).toEqual({ type: "fit" });
    expect(activity.metadata.sport).toBe("cycling");
    expect(activity.metadata.subSport).toBe("road");
    expect(activity.metadata.device).toEqual({
      manufacturer: "garmin",
      product: "edge",
      serialNumber: 123456,
    });
    expect(activity.metadata.createdAt).toBe(1709251200);
    expect(activity.metadata.startTime).toBe(1709254800);
    expect(activity.metadata.totalElapsedTime).toBeCloseTo(3900.4);
    expect(activity.metadata.totalTimerTime).toBeCloseTo(3600.6);
    expect(activity.metadata.totalDistanceM).toBeCloseTo(12345.67);

    expect(activity.points).toHaveLength(1);
    expect(activity.points[0]).toMatchObject({
      time: 1709254801,
      lat: 35.1234567,
      lon: 139.1234567,
      distanceM: 12.3,
      elevationM: 101.2,
      heartRateBpm: 120,
      cadenceRpm: 81,
      powerW: 150,
      speedMps: 5.5,
      temperatureC: 20,
    });
  });

  test("can prefer regular altitude and speed fields", () => {
    mockDecoder(true, {
      messages: {
        recordMesgs: [{
          positionLat: 35,
          positionLong: 139,
          enhancedAltitude: 101.2,
          altitude: 99.9,
          enhancedSpeed: 5.5,
          speed: 5.1,
        }],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]), {
      preferEnhancedFields: false,
    });

    expect(activity.points[0].elevationM).toBeCloseTo(99.9);
    expect(activity.points[0].speedMps).toBeCloseTo(5.1);
  });

  test("adds warnings for decoder errors and low positioned point counts", () => {
    mockDecoder(true, {
      messages: {
        recordMesgs: [{
          timestamp: 1710000000,
          heartRate: 120,
        }],
      },
      errors: ["minor warning"],
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]), {
      includePausedRecords: false,
      minPositionPoints: 2,
    });

    expect(activity.warnings).toEqual([
      {
        code: "fit_decoder_warning",
        message: "minor warning",
      },
      {
        code: "paused_record_filter_not_supported",
        message: "Paused record filtering is not implemented yet.",
      },
      {
        code: "not_enough_position_points",
        message: "Only 0 positioned point(s) were found.",
      },
    ]);
  });
});

describe("downsampleTrackActivity", () => {
  test("returns a cloned activity when it is already small enough", () => {
    const activity = makeActivity(3);
    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 3,
    });

    expect(downsampled).not.toBe(activity);
    expect(downsampled.points).not.toBe(activity.points);
    expect(downsampled.points).toEqual(activity.points);

    downsampled.points[0].heartRateBpm = 999;
    expect(activity.points[0].heartRateBpm).toBe(120);
  });

  test("uniform downsampling preserves endpoints by default", () => {
    const activity = makeActivity(10);
    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 4,
      strategy: "uniform",
    });

    expect(getTimes(downsampled)).toEqual([1710000000, 1710000003, 1710000006, 1710000009]);
  });

  test("uniform downsampling can skip preserving endpoints", () => {
    const activity = makeActivity(10);
    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 4,
      strategy: "uniform",
      preserveEndpoints: false,
    });

    expect(getTimes(downsampled)).toEqual([1710000000, 1710000002, 1710000005, 1710000007]);
  });

  test("aggregate downsampling averages sensor values without preserving endpoints", () => {
    const activity = makeActivity(8);
    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 4,
      strategy: "aggregate",
      preserveEndpoints: false,
    });

    expect(downsampled.points).toHaveLength(4);
    expect(getTimes(downsampled)).toEqual([
      1710000000,
      1710000002,
      1710000004,
      1710000006,
    ]);
    expect(downsampled.points.map((point) => point.heartRateBpm)).toEqual([
      120.5,
      122.5,
      124.5,
      126.5,
    ]);
    expect(downsampled.points.map((point) => point.powerW)).toEqual([
      150.5,
      152.5,
      154.5,
      156.5,
    ]);
    expect(downsampled.points.map((point) => point.speedMps)).toEqual([
      5.05,
      5.25,
      5.45,
      5.65,
    ]);
  });

  test("aggregate downsampling preserves raw endpoints when requested", () => {
    const activity = makeActivity(10);
    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 4,
      strategy: "aggregate",
      preserveEndpoints: true,
    });

    expect(downsampled.points).toHaveLength(4);
    expect(getTimes(downsampled)).toEqual([
      1710000000,
      1710000002,
      1710000006,
      1710000009,
    ]);
    expect(downsampled.points[0].heartRateBpm).toBe(120);
    expect(downsampled.points[1].heartRateBpm).toBe(122.5);
    expect(downsampled.points[2].heartRateBpm).toBe(126.5);
    expect(downsampled.points[3].heartRateBpm).toBe(129);
  });

  test("aggregate downsampling treats zero as a valid value", () => {
    const activity = makeActivity(4);
    activity.points[0].powerW = 0;
    activity.points[1].powerW = 100;
    activity.points[2].powerW = 0;
    activity.points[3].powerW = 200;

    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 2,
      strategy: "aggregate",
      preserveEndpoints: false,
    });

    expect(downsampled.points.map((point) => point.powerW)).toEqual([50, 100]);
  });

  test("aggregate downsampling averages metrics", () => {
    const activity = makeActivity(4);
    activity.points[0].metrics = { grade: 1, ignored: 10 };
    activity.points[1].metrics = { grade: 3 };
    activity.points[2].metrics = { grade: 5 };
    activity.points[3].metrics = { grade: 7, ignored: 20 };

    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 2,
      strategy: "aggregate",
      preserveEndpoints: false,
    });

    expect(downsampled.points[0].metrics).toEqual({
      grade: 2,
      ignored: 10,
    });
    expect(downsampled.points[1].metrics).toEqual({
      grade: 6,
      ignored: 20,
    });
  });

  test("rejects unsupported downsampling strategy", () => {
    const activity = makeActivity(3);

    expect(() => downsampleTrackActivity(activity, {
      strategy: "distance" as unknown as "uniform",
    })).toThrow(RangeError);
  });

  test("rejects invalid maxPoints", () => {
    const activity = makeActivity(3);

    expect(() => downsampleTrackActivity(activity, {
      maxPoints: 1,
    })).toThrow(RangeError);
  });
});

describe("trackActivityToTrackJson", () => {
  test("writes a GeoJSON FeatureCollection", () => {
    const parsed = parseTrackJson(trackActivityToTrackJson(makeActivity(3), {
      title: " Ride ",
      description: " Test route ",
    }));
    const feature = parsed.features[0];

    expect(parsed.type).toBe("FeatureCollection");
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.properties.title).toBe("Ride");
    expect(feature.properties.description).toBe("Test route");
    expect(feature.properties.color).toBe("#0078A8");
    expect(feature.properties.weight).toBe(4);
    expect(feature.properties.opacity).toBe(0.8);
  });

  test("rounds coordinates to the default output precision", () => {
    const parsed = parseTrackJson(trackActivityToTrackJson(makeActivity(2)));

    expect(parsed.features[0].geometry.coordinates).toEqual([
      [139, 35],
      [139.00001, 35.00001],
    ]);
  });

  test("writes standard coordinateProperties arrays", () => {
    const parsed = parseTrackJson(trackActivityToTrackJson(makeActivity(3)));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.times).toEqual([
      1710000000,
      1710000001,
      1710000002,
    ]);
    expect(coordinateProperties.distances).toEqual([0, 10.2, 20.5]);
    expect(coordinateProperties.elevations).toEqual([100.1, 101.1, 102.1]);
    expect(coordinateProperties.heartRates).toEqual([120, 121, 122]);
    expect(coordinateProperties.cadences).toEqual([80, 81, 82]);
    expect(coordinateProperties.powers).toEqual([150, 151, 152]);
    expect(coordinateProperties.speeds).toEqual([18, 18.4, 18.7]);
  });

  test("writes metadata by default", () => {
    const parsed = parseTrackJson(trackActivityToTrackJson(makeActivity(2)));
    const metadata = parsed.features[0].properties.metadata;

    expect(metadata).toEqual({
      source: {
        type: "fit",
      },
      sport: "cycling",
      subSport: "road",
      createdAt: 1710000000,
      startTime: 1710000001,
      totalElapsedTime: 3901,
      totalTimerTime: 3601,
      totalDistanceM: 12345.7,
      device: {
        manufacturer: "garmin",
        product: "edge",
        serialNumber: 123456789,
      },
    });
  });

  test("can omit metadata", () => {
    const parsed = parseTrackJson(trackActivityToTrackJson(makeActivity(2), {
      includeMetadata: false,
    }));

    expect(parsed.features[0].properties.metadata).toBeUndefined();
  });

  test("can override output precision", () => {
    const parsed = parseTrackJson(trackActivityToTrackJson(makeActivity(3), {
      precision: {
        coordinates: 6,
        distances: 0,
        elevations: 0,
        heartRates: 0,
        cadences: 0,
        powers: 0,
        speeds: 2,
        metadata: 0,
      },
    }));
    const feature = parsed.features[0];
    const coordinateProperties = feature.properties.coordinateProperties;

    expect(feature.geometry.coordinates[1]).toEqual([139.000011, 35.000011]);
    expect(coordinateProperties.distances).toEqual([0, 10, 20]);
    expect(coordinateProperties.elevations).toEqual([100, 101, 102]);
    expect(coordinateProperties.speeds).toEqual([18, 18.36, 18.72]);
    expect(feature.properties.metadata.totalDistanceM).toBe(12346);
  });

  test("fill-forwards selected standard series when some geo points are missing values", () => {
    const activity = makeActivity(3);
    delete activity.points[1].heartRateBpm;

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.heartRates).toEqual([120, 120, 122]);
    expect(coordinateProperties.powers).toEqual([150, 151, 152]);
  });

  test("uses zero before the first available fill-forward value", () => {
    const activity = makeActivity(3);
    delete activity.points[0].heartRateBpm;
    delete activity.points[1].heartRateBpm;

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.heartRates).toEqual([0, 0, 122]);
  });

  test("omits a fill-forward series when it has no valid values", () => {
    const activity = makeActivity(3);
    activity.points.forEach((point) => {
      delete point.heartRateBpm;
    });

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.heartRates).toBeUndefined();
  });

  test("omits complete standard series when some geo points are missing values", () => {
    const activity = makeActivity(3);
    delete activity.points[1].elevationM;

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.elevations).toBeUndefined();
    expect(coordinateProperties.heartRates).toEqual([120, 121, 122]);
  });

  test("writes custom metric series when complete and safe", () => {
    const activity = makeActivity(3);
    activity.points[0].metrics = {
      grade: 1.23,
      powers: 999,
      constructor: 999,
    };
    activity.points[1].metrics = {
      grade: 2.34,
      powers: 999,
      constructor: 999,
    };
    activity.points[2].metrics = {
      grade: 3.45,
      powers: 999,
      constructor: 999,
    };

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.grade).toEqual([1.2, 2.3, 3.5]);
    expect(Object.prototype.hasOwnProperty.call(
      coordinateProperties,
      "constructor"
    )).toBe(false);
    expect(coordinateProperties.powers).toEqual([150, 151, 152]);
  });

  test("omits incomplete custom metric series", () => {
    const activity = makeActivity(3);
    activity.points[0].metrics = { grade: 1 };
    activity.points[1].metrics = {};
    activity.points[2].metrics = { grade: 3 };

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.grade).toBeUndefined();
  });

  test("can omit custom metrics", () => {
    const activity = makeActivity(3);
    activity.points.forEach((point, index) => {
      point.metrics = { grade: index };
    });

    const parsed = parseTrackJson(trackActivityToTrackJson(activity, {
      includeMetrics: false,
    }));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.grade).toBeUndefined();
  });

  test("throws when there are no positioned points", () => {
    const activity = makeActivity(3);
    activity.points.forEach((point) => {
      delete point.lat;
      delete point.lon;
    });

    expect(() => trackActivityToTrackJson(activity)).toThrow(
      TrackJsonConversionError
    );
  });

  test("throws when there is only one positioned point", () => {
    const activity = makeActivity(1);

    expect(() => trackActivityToTrackJson(activity)).toThrow(
      TrackJsonConversionError
    );
  });

  test("pretty-prints TrackJSON when requested", () => {
    const json = trackActivityToTrackJson(makeActivity(2), {
      pretty: true,
    });

    expect(json).toContain("\n  ");
  });
});

function mockDecoder(isFIT: boolean, readResult: MockFitReadResult) {
  decoderMock.mockImplementation(() => {
    return {
      isFIT: () => isFIT,
      read: () => readResult,
    };
  });
}

function makeActivity(pointCount: number): TrackActivity {
  return {
    schemaVersion: 1,
    metadata: {
      source: {
        type: "fit",
      },
      sport: "cycling",
      subSport: "road",
      createdAt: 1710000000.4,
      startTime: 1710000001.4,
      totalElapsedTime: 3900.6,
      totalTimerTime: 3600.6,
      totalDistanceM: 12345.67,
      device: {
        manufacturer: "garmin",
        product: "edge",
        serialNumber: 123456789,
      },
    },
    points: Array.from({ length: pointCount }, (_, index) => makePoint(index)),
    warnings: [],
  };
}

function makePoint(index: number): TrackPoint {
  return {
    time: 1710000000 + index,
    lat: 35 + index * 0.00001 + 0.00000123,
    lon: 139 + index * 0.00001 + 0.00000123,
    distanceM: index * 10.234,
    elevationM: 100.123 + index,
    heartRateBpm: 120 + index,
    cadenceRpm: 80 + index,
    powerW: 150 + index,
    speedMps: 5 + index * 0.1,
    temperatureC: 20 + index * 0.1,
  };
}

function getTimes(activity: TrackActivity): number[] {
  return activity.points.map((point) => point.time as number);
}

function parseTrackJson(json: string): any {
  return JSON.parse(json);
}
