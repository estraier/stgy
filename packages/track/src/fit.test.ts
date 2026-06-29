import { Decoder, Stream } from "@garmin/fitsdk";
import {
  TrackActivity,
  TrackJsonConversionError,
  TrackParseError,
  downsampleTrackActivity,
  parseFitBytes,
  trackActivityToTrackJson,
} from "./fit";

jest.mock("@garmin/fitsdk", () => ({
  Decoder: jest.fn(),
  Stream: {
    fromArrayBuffer: jest.fn(),
  },
}));

type MockDecoderInstance = {
  isFIT: jest.Mock;
  read: jest.Mock;
};

const decoderMock = Decoder as unknown as jest.Mock;
const streamFromArrayBufferMock = Stream.fromArrayBuffer as jest.Mock;

const toSemicircle = (degrees: number) => {
  return Math.round((degrees * 2147483648) / 180);
};

const makeActivity = (count: number): TrackActivity => ({
  schemaVersion: 1,
  metadata: {
    source: {
      type: "test",
    },
    name: "Test activity",
  },
  points: Array.from({ length: count }, (_, index) => ({
    time: 1767222000 + index,
    lat: 35 + index * 0.001,
    lon: 139 + index * 0.001,
    distanceM: index * 10,
    elevationM: 100 + index,
    heartRateBpm: 120 + index,
    cadenceRpm: 80 + index,
    powerW: 150 + index,
    speedMps: 5 + index * 0.1,
    metrics: {
      torqueEffectiveness: 70 + index,
    },
  })),
  warnings: [
    {
      code: "test_warning",
      message: "Test warning",
    },
  ],
});

const mockFitDecoder = (
  readResult: unknown,
  isFit = true,
): MockDecoderInstance => {
  const stream = { stream: true };
  const decoder: MockDecoderInstance = {
    isFIT: jest.fn().mockReturnValue(isFit),
    read: jest.fn().mockReturnValue(readResult),
  };

  streamFromArrayBufferMock.mockReturnValue(stream);
  decoderMock.mockImplementation(() => decoder);

  return decoder;
};

describe("downsampleTrackActivity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("keeps activity unchanged when point count is within maxPoints", () => {
    const activity = makeActivity(3);

    const result = downsampleTrackActivity(activity, {
      maxPoints: 5,
    });

    expect(result).toEqual(activity);
    expect(result).not.toBe(activity);
    expect(result.metadata).not.toBe(activity.metadata);
    expect(result.metadata.source).not.toBe(activity.metadata.source);
    expect(result.points).not.toBe(activity.points);
    expect(result.points[0]).not.toBe(activity.points[0]);
    expect(result.points).toHaveLength(3);
  });

  test("reduces points to maxPoints and preserves endpoints by default", () => {
    const activity = makeActivity(10);

    const result = downsampleTrackActivity(activity, {
      maxPoints: 4,
    });

    expect(result.points).toHaveLength(4);
    expect(result.points.map((point) => point.time)).toEqual([
      1767222000,
      1767222003,
      1767222006,
      1767222009,
    ]);
  });

  test("keeps point order after downsampling", () => {
    const activity = makeActivity(20);

    const result = downsampleTrackActivity(activity, {
      maxPoints: 6,
    });

    const times = result.points.map((point) => {
      expect(point.time).toBeDefined();
      return point.time as number;
    });
    const sortedTimes = [...times].sort((a, b) => a - b);

    expect(times).toEqual(sortedTimes);
  });

  test("can downsample without preserving the last endpoint", () => {
    const activity = makeActivity(10);

    const result = downsampleTrackActivity(activity, {
      maxPoints: 4,
      preserveEndpoints: false,
    });

    expect(result.points.map((point) => point.time)).toEqual([
      1767222000,
      1767222002,
      1767222005,
      1767222007,
    ]);
  });

  test("does not mutate the original activity", () => {
    const activity = makeActivity(10);
    const originalJson = JSON.stringify(activity);

    const result = downsampleTrackActivity(activity, {
      maxPoints: 4,
    });

    result.metadata.name = "Changed";
    result.points[0].time = 1;
    if (result.points[0].metrics) {
      result.points[0].metrics.torqueEffectiveness = 1;
    }
    result.warnings[0].message = "Changed";

    expect(JSON.stringify(activity)).toBe(originalJson);
  });

  test("rejects invalid maxPoints", () => {
    const activity = makeActivity(10);

    expect(() => downsampleTrackActivity(activity, {
      maxPoints: 1,
    })).toThrow(RangeError);

    expect(() => downsampleTrackActivity(activity, {
      maxPoints: Number.NaN,
    })).toThrow(RangeError);
  });

  test("rejects unsupported downsampling strategy", () => {
    const activity = makeActivity(10);

    expect(() => downsampleTrackActivity(activity, {
      strategy: "distance" as unknown as "uniform",
    })).toThrow(RangeError);
  });
});

describe("trackActivityToTrackJson", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("converts TrackActivity to GeoJSON FeatureCollection", () => {
    const activity = makeActivity(3);

    const json = trackActivityToTrackJson(activity, {
      title: "Morning ride",
      description: "A short test ride",
      color: "#e67e22",
      weight: 6,
      opacity: 0.9,
    });

    const parsed = JSON.parse(json);

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].type).toBe("Feature");
    expect(parsed.features[0].geometry.type).toBe("LineString");
    expect(parsed.features[0].geometry.coordinates).toEqual([
      [139, 35],
      [139.001, 35.001],
      [139.002, 35.002],
    ]);
    expect(parsed.features[0].properties.title).toBe("Morning ride");
    expect(parsed.features[0].properties.description).toBe("A short test ride");
    expect(parsed.features[0].properties.color).toBe("#e67e22");
    expect(parsed.features[0].properties.weight).toBe(6);
    expect(parsed.features[0].properties.opacity).toBe(0.9);
  });

  test("writes standard coordinateProperties arrays", () => {
    const activity = makeActivity(3);

    const parsed = JSON.parse(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.times).toEqual([
      1767222000,
      1767222001,
      1767222002,
    ]);
    expect(coordinateProperties.distances).toEqual([0, 10, 20]);
    expect(coordinateProperties.elevations).toEqual([100, 101, 102]);
    expect(coordinateProperties.heartRates).toEqual([120, 121, 122]);
    expect(coordinateProperties.cadences).toEqual([80, 81, 82]);
    expect(coordinateProperties.powers).toEqual([150, 151, 152]);
    expect(coordinateProperties.speeds).toHaveLength(3);
    expect(coordinateProperties.speeds[0]).toBeCloseTo(18);
    expect(coordinateProperties.speeds[1]).toBeCloseTo(18.36);
    expect(coordinateProperties.speeds[2]).toBeCloseTo(18.72);
  });

  test("includes custom numeric metrics as graph series", () => {
    const activity = makeActivity(3);

    const parsed = JSON.parse(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.torqueEffectiveness).toEqual([70, 71, 72]);
  });

  test("can omit custom metrics", () => {
    const activity = makeActivity(3);

    const parsed = JSON.parse(trackActivityToTrackJson(activity, {
      includeMetrics: false,
    }));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.torqueEffectiveness).toBeUndefined();
  });

  test("fill-forwards selected standard series when some geo points are missing values", () => {
    const activity = makeActivity(3);
    delete activity.points[1].heartRateBpm;

    const parsed = JSON.parse(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.heartRates).toEqual([120, 120, 122]);
    expect(coordinateProperties.powers).toEqual([150, 151, 152]);
  });

  test("uses zero before the first available fill-forward value", () => {
    const activity = makeActivity(3);
    delete activity.points[0].heartRateBpm;
    delete activity.points[1].heartRateBpm;

    const parsed = JSON.parse(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.heartRates).toEqual([0, 0, 122]);
  });

  test("omits metric series when some geo points are missing values", () => {
    const activity = makeActivity(3);
    delete activity.points[1].metrics;

    const parsed = JSON.parse(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.torqueEffectiveness).toBeUndefined();
  });

  test("ignores reserved and unsafe metric names", () => {
    const activity = makeActivity(2);
    activity.points[0].metrics = {
      __proto__: 1,
      constructor: 2,
      times: 3,
      customMetric: 4,
    };
    activity.points[1].metrics = {
      __proto__: 5,
      constructor: 6,
      times: 7,
      customMetric: 8,
    };

    const parsed = JSON.parse(trackActivityToTrackJson(activity));
    const coordinateProperties = parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.customMetric).toEqual([4, 8]);
    expect(coordinateProperties.times).toEqual([1767222000, 1767222001]);
    expect(Object.prototype.hasOwnProperty.call(
      coordinateProperties,
      "constructor",
    )).toBe(false);
  });

  test("uses only points with both latitude and longitude", () => {
    const activity = makeActivity(4);
    delete activity.points[1].lat;
    delete activity.points[2].lon;

    const parsed = JSON.parse(trackActivityToTrackJson(activity));

    expect(parsed.features[0].geometry.coordinates).toEqual([
      [139, 35],
      [139.003, 35.003],
    ]);
    expect(parsed.features[0].properties.coordinateProperties.times).toEqual([
      1767222000,
      1767222003,
    ]);
  });

  test("throws no_position_points when no points have lat/lon", () => {
    const activity = makeActivity(3);
    activity.points.forEach((point) => {
      delete point.lat;
      delete point.lon;
    });

    expect(() => trackActivityToTrackJson(activity)).toThrow(
      TrackJsonConversionError
    );

    try {
      trackActivityToTrackJson(activity);
      throw new Error("Expected trackActivityToTrackJson to throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(TrackJsonConversionError);
      expect((e as TrackJsonConversionError).code).toBe("no_position_points");
    }
  });

  test("throws not_enough_position_points when only one point has lat/lon", () => {
    const activity = makeActivity(3);
    delete activity.points[1].lat;
    delete activity.points[1].lon;
    delete activity.points[2].lat;
    delete activity.points[2].lon;

    expect(() => trackActivityToTrackJson(activity)).toThrow(
      TrackJsonConversionError
    );

    try {
      trackActivityToTrackJson(activity);
      throw new Error("Expected trackActivityToTrackJson to throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(TrackJsonConversionError);
      expect((e as TrackJsonConversionError).code).toBe(
        "not_enough_position_points"
      );
    }
  });

  test("pretty-prints JSON when pretty is true", () => {
    const activity = makeActivity(2);

    const json = trackActivityToTrackJson(activity, {
      pretty: true,
    });

    expect(json).toContain("\n  ");
    expect(JSON.parse(json).type).toBe("FeatureCollection");
  });
});

describe("parseFitBytes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("throws TrackParseError empty_input for empty ArrayBuffer input", () => {
    expect(() => parseFitBytes(new ArrayBuffer(0))).toThrow(TrackParseError);

    try {
      parseFitBytes(new ArrayBuffer(0));
      throw new Error("Expected parseFitBytes to throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(TrackParseError);
      expect((e as TrackParseError).code).toBe("empty_input");
      expect((e as TrackParseError).sourceType).toBe("fit");
    }
  });

  test("throws TrackParseError empty_input for empty Uint8Array input", () => {
    expect(() => parseFitBytes(new Uint8Array())).toThrow(TrackParseError);

    try {
      parseFitBytes(new Uint8Array());
      throw new Error("Expected parseFitBytes to throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(TrackParseError);
      expect((e as TrackParseError).code).toBe("empty_input");
      expect((e as TrackParseError).sourceType).toBe("fit");
    }
  });

  test("throws TrackParseError decode_failed when input is not FIT", () => {
    mockFitDecoder({
      messages: {},
    }, false);

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      TrackParseError
    );

    try {
      parseFitBytes(new Uint8Array([1, 2, 3]));
      throw new Error("Expected parseFitBytes to throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(TrackParseError);
      expect((e as TrackParseError).code).toBe("decode_failed");
      expect((e as TrackParseError).sourceType).toBe("fit");
    }
  });

  test("throws TrackParseError decode_failed when decoder.read throws", () => {
    const stream = { stream: true };
    const decoder: MockDecoderInstance = {
      isFIT: jest.fn().mockReturnValue(true),
      read: jest.fn().mockImplementation(() => {
        throw new Error("broken fit");
      }),
    };

    streamFromArrayBufferMock.mockReturnValue(stream);
    decoderMock.mockImplementation(() => decoder);

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      TrackParseError
    );

    try {
      parseFitBytes(new Uint8Array([1, 2, 3]));
      throw new Error("Expected parseFitBytes to throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(TrackParseError);
      expect((e as TrackParseError).code).toBe("decode_failed");
      expect((e as TrackParseError).message).toContain("broken fit");
    }
  });

  test("throws TrackParseError no_record_messages when there are no records", () => {
    mockFitDecoder({
      messages: {
        fileIdMesgs: [
          {
            manufacturer: "garmin",
          },
        ],
      },
    });

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      TrackParseError
    );

    try {
      parseFitBytes(new Uint8Array([1, 2, 3]));
      throw new Error("Expected parseFitBytes to throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(TrackParseError);
      expect((e as TrackParseError).code).toBe("no_record_messages");
    }
  });

  test("throws decode_failed when decoder returns errors and no records", () => {
    mockFitDecoder({
      messages: {},
      errors: [
        new Error("checksum failed"),
      ],
    });

    try {
      parseFitBytes(new Uint8Array([1, 2, 3]));
      throw new Error("Expected parseFitBytes to throw.");
    } catch (e) {
      expect(e).toBeInstanceOf(TrackParseError);
      expect((e as TrackParseError).code).toBe("decode_failed");
      expect((e as TrackParseError).message).toContain("checksum failed");
    }
  });

  test("passes sliced Uint8Array data to Stream.fromArrayBuffer", () => {
    const source = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const slice = source.subarray(2, 5);

    mockFitDecoder({
      messages: {
        recordMesgs: [
          {
            timestamp: 1767222000,
          },
        ],
      },
    });

    parseFitBytes(slice);

    const passedBuffer = streamFromArrayBufferMock.mock.calls[0][0] as ArrayBuffer;
    expect(Array.from(new Uint8Array(passedBuffer))).toEqual([2, 3, 4]);
  });

  test("calls the FIT decoder with expected read options", () => {
    const decoder = mockFitDecoder({
      messages: {
        recordMesgs: [
          {
            timestamp: 1767222000,
          },
        ],
      },
    });

    parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(decoder.read).toHaveBeenCalledWith(expect.objectContaining({
      applyScaleAndOffset: true,
      expandSubFields: true,
      expandComponents: true,
      convertTypesToStrings: true,
      convertDateTimesToDates: true,
      mergeHeartRates: true,
    }));
  });

  test("returns TrackActivity with normalized metadata and points", () => {
    mockFitDecoder({
      messages: {
        fileIdMesgs: [
          {
            timeCreated: new Date("2026-01-01T00:00:00Z"),
            manufacturer: "garmin",
            productName: "Edge 1040",
            serialNumber: 123456789,
          },
        ],
        sportMesgs: [
          {
            sport: "cycling",
            subSport: "road",
          },
        ],
        sessionMesgs: [
          {
            startTime: new Date("2026-01-01T01:00:00Z"),
            totalElapsedTime: 3600,
            totalTimerTime: 3500,
            totalDistance: 12345.6,
          },
        ],
        recordMesgs: [
          {
            timestamp: new Date("2026-01-01T01:00:01Z"),
            positionLat: 35.681,
            positionLong: 139.767,
            distance: 10,
            altitude: 90,
            enhancedAltitude: 100,
            heartRate: 120,
            cadence: 80,
            power: 150,
            speed: 4,
            enhancedSpeed: 5,
            temperature: 20,
          },
          {
            timestamp: 1767229202000,
            position_lat: toSemicircle(35.682),
            position_long: toSemicircle(139.768),
            distance: 20,
            altitude: 91,
            enhanced_altitude: 101,
            heart_rate: 121,
            cadence: 81,
            power: 151,
            speed: 4.1,
            enhanced_speed: 5.1,
            temperature: 21,
          },
        ],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.schemaVersion).toBe(1);
    expect(activity.metadata).toEqual({
      source: {
        type: "fit",
      },
      sport: "cycling",
      subSport: "road",
      device: {
        manufacturer: "garmin",
        product: "Edge 1040",
        serialNumber: 123456789,
      },
      createdAt: 1767225600,
      startTime: 1767229200,
      totalElapsedTime: 3600,
      totalTimerTime: 3500,
      totalDistanceM: 12345.6,
    });
    expect(activity.points).toEqual([
      {
        time: 1767229201,
        lat: 35.681,
        lon: 139.767,
        distanceM: 10,
        elevationM: 100,
        heartRateBpm: 120,
        cadenceRpm: 80,
        powerW: 150,
        speedMps: 5,
        temperatureC: 20,
      },
      {
        time: 1767229202,
        lat: expect.closeTo(35.682, 6),
        lon: expect.closeTo(139.768, 6),
        distanceM: 20,
        elevationM: 101,
        heartRateBpm: 121,
        cadenceRpm: 81,
        powerW: 151,
        speedMps: 5.1,
        temperatureC: 21,
      },
    ]);
    expect(activity.warnings).toEqual([]);
  });

  test("uses regular altitude and speed when preferEnhancedFields is false", () => {
    mockFitDecoder({
      messages: {
        recordMesgs: [
          {
            timestamp: 1767222000,
            positionLat: 35.681,
            positionLong: 139.767,
            altitude: 90,
            enhancedAltitude: 100,
            speed: 4,
            enhancedSpeed: 5,
          },
        ],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]), {
      preferEnhancedFields: false,
    });

    expect(activity.points[0].elevationM).toBe(90);
    expect(activity.points[0].speedMps).toBe(4);
  });

  test("adds decoder errors to warnings when records exist", () => {
    mockFitDecoder({
      messages: {
        recordMesgs: [
          {
            timestamp: 1767222000,
            positionLat: 35.681,
            positionLong: 139.767,
          },
        ],
      },
      errors: [
        "minor warning",
      ],
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.warnings).toContainEqual({
      code: "fit_decoder_warning",
      message: "minor warning",
    });
  });

  test("adds warning when positioned point count is below minPositionPoints", () => {
    mockFitDecoder({
      messages: {
        recordMesgs: [
          {
            timestamp: 1767222000,
            positionLat: 35.681,
            positionLong: 139.767,
          },
          {
            timestamp: 1767222001,
          },
        ],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]), {
      minPositionPoints: 2,
    });

    expect(activity.warnings).toContainEqual({
      code: "not_enough_position_points",
      message: "Only 1 positioned point(s) were found.",
    });
  });

  test("adds warning when paused record filtering is requested", () => {
    mockFitDecoder({
      messages: {
        recordMesgs: [
          {
            timestamp: 1767222000,
          },
        ],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]), {
      includePausedRecords: false,
    });

    expect(activity.warnings).toContainEqual({
      code: "paused_record_filter_not_supported",
      message: "Paused record filtering is not implemented yet.",
    });
  });
});
