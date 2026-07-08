import { Decoder, Stream } from "@garmin/fitsdk";
import {
  TrackJsonConversionError,
  TrackParseError,
  addTrackJsonBbox,
  computeHeartRateZoneSummary,
  computePowerZoneSummary,
  downsampleTrackActivity,
  mergeTrackActivities,
  trackJsonDataToTrackActivity,
  getHeartRateZone,
  getPowerZone,
  parseFitBytes,
  obfuscateFitPrivacy,
  trackActivityToFit,
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
    expect(() => parseFitBytes(new ArrayBuffer(0))).toThrow(
      "FIT input is empty",
    );
  });

  test("rejects non-FIT input", () => {
    mockDecoder(false, {
      messages: {},
    });

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      TrackParseError,
    );
    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      "Input is not a FIT file",
    );
  });

  test("rejects FIT input without records", () => {
    mockDecoder(true, {
      messages: {},
    });

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      TrackParseError,
    );
    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      "FIT data does not contain record messages",
    );
  });

  test("reports decoder errors when no records exist", () => {
    mockDecoder(true, {
      messages: {},
      errors: [new Error("broken crc")],
    });

    expect(() => parseFitBytes(new Uint8Array([1, 2, 3]))).toThrow(
      "broken crc",
    );
  });

  test("parses record messages and metadata", () => {
    mockDecoder(true, {
      messages: {
        fileIdMesgs: [
          {
            timeCreated: new Date("2024-03-01T00:00:00Z"),
            manufacturer: "garmin",
            productName: "edge",
            serialNumber: 123456,
          },
        ],
        sportMesgs: [
          {
            sport: "cycling",
            subSport: "road",
          },
        ],
        deviceInfoMesgs: [
          {
            manufacturer: "garmin",
            productName: "Edge 1040",
            serialNumber: 777,
            softwareVersion: 19.12,
            hardwareVersion: 7,
            deviceType: "bike_computer",
            sourceType: "local",
          },
        ],
        sessionMesgs: [
          {
            startTime: new Date("2024-03-01T01:00:00Z"),
            totalElapsedTime: 3900.4,
            totalTimerTime: 3600.6,
            totalDistance: 12345.67,
          },
        ],
        activityMesgs: [
          {
            timestamp: new Date("2024-03-01T02:05:00Z"),
            localTimestamp: new Date("2024-03-01T11:05:00Z"),
          },
        ],
        recordMesgs: [
          {
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
          },
        ],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.schemaVersion).toBe(1);
    expect(activity.metadata.source).toEqual({ type: "fit" });
    expect(activity.metadata.sport).toBe("cycling");
    expect(activity.metadata.subSport).toBe("road");
    expect(activity.metadata.recordingDevice).toEqual({
      manufacturer: "garmin",
      product: "edge",
      serialNumber: 123456,
    });
    expect(activity.metadata.devices).toEqual([
      {
        manufacturer: "garmin",
        product: "Edge 1040",
        serialNumber: 777,
        softwareVersion: "19.12",
        hardwareVersion: "7",
        deviceType: "bike_computer",
        sourceType: "local",
      },
    ]);
    expect(activity.metadata.createdAt).toBe(1709251200);
    expect(activity.metadata.startTime).toBe(1709254800);
    expect(activity.metadata.endTime).toBeCloseTo(1709258700.4);
    expect(activity.metadata.localTimeOffsetSeconds).toBe(32400);
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

  test("reads raw FIT local timestamp seconds as a local time offset", () => {
    const rawLocalTimestamp = Date.parse("2024-03-01T11:05:00Z") / 1000 -
      631065600;

    mockDecoder(true, {
      messages: {
        activityMesgs: [
          {
            timestamp: new Date("2024-03-01T02:05:00Z"),
            localTimestamp: rawLocalTimestamp,
          },
        ],
        recordMesgs: [
          {
            timestamp: new Date("2024-03-01T01:00:01Z"),
            positionLat: 35.1234567,
            positionLong: 139.1234567,
          },
        ],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.metadata.localTimeOffsetSeconds).toBe(32400);
  });

  test("adds statistics and training metadata", () => {
    mockDecoder(true, {
      messages: {
        sessionMesgs: [
          {
            normalizedPower: 255.4,
            totalCalories: 812,
          },
        ],
        recordMesgs: [
          {
            timestamp: 1710000000,
            heartRate: 120,
            cadence: 80,
            power: 100,
            speed: 5,
            temperature: 20,
          },
          {
            timestamp: 1710000010,
            heartRate: 130,
            cadence: 90,
            power: 200,
            speed: 6,
            temperature: 22,
          },
          {
            timestamp: 1710000020,
            heartRate: 140,
            cadence: 100,
            power: 300,
            speed: 7,
            temperature: 24,
          },
          {
            timestamp: 1710000030,
            heartRate: 150,
            cadence: 110,
            power: 400,
            speed: 8,
            temperature: 30,
          },
        ],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.metadata.statistics?.speedKph?.avg).toBeCloseTo(23.4);
    expect(activity.metadata.statistics?.speedKph?.median).toBeCloseTo(23.4);
    expect(activity.metadata.statistics?.speedKph?.max).toBeCloseTo(28.8);
    expect(activity.metadata.statistics?.cadenceRpm).toEqual({
      avg: 95,
      median: 95,
      max: 110,
    });
    expect(activity.metadata.statistics?.heartRateBpm).toEqual({
      avg: 135,
      median: 135,
      max: 150,
    });
    expect(activity.metadata.statistics?.powerW).toEqual({
      avg: 250,
      median: 250,
      max: 400,
    });
    expect(activity.metadata.statistics?.temperatureC).toEqual({
      avg: 24,
      median: 23,
      max: 30,
    });
    expect(activity.metadata.training).toEqual({
      normalizedPowerW: 255.4,
      totalWorkJ: 7500,
      totalCaloriesCal: 812000,
      source: {
        normalizedPower: "fit",
        totalWork: "computed",
        totalCalories: "fit",
      },
    });
    expect(activity.metadata.histograms?.powerW).toEqual({
      bucketSizeW: 25,
      maxBucketW: 2000,
      totalSeconds: 30,
      buckets: [
        { label: "≤100 W", seconds: 10 },
        { label: "≤200 W", seconds: 10 },
        { label: "≤300 W", seconds: 10 },
      ],
    });
  });


  test("computes Strava-style best power efforts", () => {
    mockDecoder(true, {
      messages: {
        recordMesgs: Array.from({ length: 20 }, (_, index) => {
          return {
            timestamp: 1710000000 + index,
            power: index < 10 ? 100 : 300,
          };
        }),
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.metadata.bestEfforts?.powerW).toEqual({
      "5": 300,
      "10": 300,
      "15": 233.33333333333334,
      "20": 200,
    });
  });

  test("uses FIT total work when present", () => {
    mockDecoder(true, {
      messages: {
        sessionMesgs: [
          {
            totalWork: 123456,
          },
        ],
        recordMesgs: [
          { timestamp: 1710000000, power: 100 },
          { timestamp: 1710000010, power: 200 },
        ],
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.metadata.training?.totalWorkJ).toBe(123456);
    expect(activity.metadata.training?.source?.totalWork).toBe("fit");
  });

  test("computes normalized power when FIT summary omits it", () => {
    mockDecoder(true, {
      messages: {
        recordMesgs: Array.from({ length: 40 }, (_, index) => {
          return {
            timestamp: 1710000000 + index,
            power: 100,
          };
        }),
      },
    });

    const activity = parseFitBytes(new Uint8Array([1, 2, 3]));

    expect(activity.metadata.training?.normalizedPowerW).toBeCloseTo(100);
    expect(activity.metadata.training?.source?.normalizedPower).toBe(
      "computed",
    );
  });

  test("can prefer regular altitude and speed fields", () => {
    mockDecoder(true, {
      messages: {
        recordMesgs: [
          {
            positionLat: 35,
            positionLong: 139,
            enhancedAltitude: 101.2,
            altitude: 99.9,
            enhancedSpeed: 5.5,
            speed: 5.1,
          },
        ],
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
        recordMesgs: [
          {
            timestamp: 1710000000,
            heartRate: 120,
          },
        ],
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

    expect(getTimes(downsampled)).toEqual([
      1710000000, 1710000003, 1710000006, 1710000009,
    ]);
  });

  test("uniform downsampling can skip preserving endpoints", () => {
    const activity = makeActivity(10);
    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 4,
      strategy: "uniform",
      preserveEndpoints: false,
    });

    expect(getTimes(downsampled)).toEqual([
      1710000000, 1710000002, 1710000005, 1710000007,
    ]);
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
      1710000000, 1710000002, 1710000004, 1710000006,
    ]);
    expect(downsampled.points.map((point) => point.heartRateBpm)).toEqual([
      120.5, 122.5, 124.5, 126.5,
    ]);
    expect(downsampled.points.map((point) => point.powerW)).toEqual([
      150.5, 152.5, 154.5, 156.5,
    ]);
    expect(downsampled.points.map((point) => point.speedMps)).toEqual([
      5.05, 5.25, 5.45, 5.65,
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
      1710000000, 1710000002, 1710000006, 1710000009,
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

  test("preserves and clones metadata during downsampling", () => {
    const activity = makeActivity(10);
    activity.metadata.devices = [
      {
        manufacturer: "garmin",
        product: "Edge 1040",
      },
    ];
    activity.metadata.statistics = {
      powerW: { avg: 150, median: 150, max: 300 },
      temperatureC: { avg: 22, median: 22, max: 28 },
    };
    activity.metadata.training = {
      normalizedPowerW: 180,
      totalWorkJ: 123456,
      source: {
        normalizedPower: "computed",
        totalWork: "computed",
      },
    };
    activity.metadata.bestEfforts = {
      powerW: {
        "5": 450,
        "60": 250,
      },
    };
    activity.metadata.histograms = {
      powerW: {
        bucketSizeW: 25,
        maxBucketW: 2000,
        totalSeconds: 3,
        buckets: [
          { label: "≤150 W", seconds: 1 },
          { label: "≤175 W", seconds: 2 },
        ],
      },
    };

    const downsampled = downsampleTrackActivity(activity, {
      maxPoints: 4,
      strategy: "uniform",
    });

    expect(downsampled.metadata).toEqual(activity.metadata);
    expect(downsampled.metadata.devices).not.toBe(activity.metadata.devices);
    expect(downsampled.metadata.devices?.[0]).not.toBe(
      activity.metadata.devices?.[0],
    );
    expect(downsampled.metadata.statistics).not.toBe(
      activity.metadata.statistics,
    );
    expect(downsampled.metadata.training).not.toBe(activity.metadata.training);
    expect(downsampled.metadata.training?.source).not.toBe(
      activity.metadata.training.source,
    );
    expect(downsampled.metadata.bestEfforts).not.toBe(
      activity.metadata.bestEfforts,
    );
    expect(downsampled.metadata.bestEfforts?.powerW).not.toBe(
      activity.metadata.bestEfforts.powerW,
    );
    expect(downsampled.metadata.histograms).not.toBe(
      activity.metadata.histograms,
    );
    expect(downsampled.metadata.histograms?.powerW).not.toBe(
      activity.metadata.histograms.powerW,
    );
    expect(downsampled.metadata.histograms?.powerW?.buckets).not.toBe(
      activity.metadata.histograms.powerW!.buckets,
    );
  });

  test("rejects unsupported downsampling strategy", () => {
    const activity = makeActivity(3);

    expect(() =>
      downsampleTrackActivity(activity, {
        strategy: "distance" as unknown as "uniform",
      }),
    ).toThrow(RangeError);
  });

  test("rejects invalid maxPoints", () => {
    const activity = makeActivity(3);

    expect(() =>
      downsampleTrackActivity(activity, {
        maxPoints: 1,
      }),
    ).toThrow(RangeError);
  });
});

describe("trackJsonDataToTrackActivity", () => {
  test("converts TrackJSON LineString data to TrackActivity", () => {
    const activity = trackJsonDataToTrackActivity({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [139.0, 35.0, 10],
              [139.1, 35.1, 11],
            ],
          },
          properties: {
            title: "TrackJSON ride",
            metadata: {
              sport: "cycling",
              startTime: 100,
              endTime: 110,
              localTimeOffsetSeconds: 32400,
            },
            coordinateProperties: {
              times: [100, 110],
              distances: [0, 120],
              heartRates: [120, 130],
              powers: [150, 180],
              speeds: [18, 21.6],
              grade: [1.2, 1.4],
            },
          },
        },
      ],
    });

    expect(activity.metadata.source).toEqual({ type: "trackjson" });
    expect(activity.metadata.name).toBe("TrackJSON ride");
    expect(activity.metadata.sport).toBe("cycling");
    expect(activity.metadata.startTime).toBe(100);
    expect(activity.metadata.endTime).toBe(110);
    expect(activity.metadata.localTimeOffsetSeconds).toBe(32400);
    expect(activity.points).toHaveLength(2);
    expect(activity.points[1]).toMatchObject({
      time: 110,
      lon: 139.1,
      lat: 35.1,
      elevationM: 11,
      distanceM: 120,
      heartRateBpm: 130,
      powerW: 180,
      speedMps: 6,
      metrics: {
        grade: 1.4,
      },
    });
  });

  test("preserves TrackJSON LineString feature breaks", () => {
    const activity = trackJsonDataToTrackActivity({
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
            },
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [140.0, 36.0],
              [140.1, 36.1],
            ],
          },
          properties: {
            coordinateProperties: {
              times: [3, 4],
            },
          },
        },
      ],
    });

    expect(activity.points).toEqual([
      expect.objectContaining({ lon: 139.0, lat: 35.0, time: 1 }),
      expect.objectContaining({ lon: 139.1, lat: 35.1, time: 2 }),
      {},
      expect.objectContaining({ lon: 140.0, lat: 36.0, time: 3 }),
      expect.objectContaining({ lon: 140.1, lat: 36.1, time: 4 }),
    ]);
  });

});

describe("mergeTrackActivities", () => {
  test("merges three activities into one chronological activity", () => {
    const first = makeActivity(2);
    first.metadata.name = "Morning ride";
    first.metadata.createdAt = 300;
    first.points[0].time = 100;
    first.points[1].time = 110;
    first.points[0].distanceM = 0;
    first.points[1].distanceM = 100;
    first.points[0].speedMps = 5;
    first.points[1].speedMps = 5;

    const second = makeActivity(2);
    second.metadata.createdAt = 200;
    second.points[0].time = 200;
    second.points[1].time = 210;
    second.points[0].distanceM = 0;
    second.points[1].distanceM = 80;
    second.points[0].speedMps = 6;
    second.points[1].speedMps = 6;

    const third = makeActivity(2);
    third.metadata.createdAt = 400;
    third.points[0].time = 300;
    third.points[1].time = 310;
    third.points[0].distanceM = 0;
    third.points[1].distanceM = 50;
    third.points[0].speedMps = 7;
    third.points[1].speedMps = 7;

    const merged = mergeTrackActivities([first, second, third]);

    expect(merged.metadata.source).toEqual({ type: "merged" });
    expect(merged.metadata.name).toBe("Morning ride");
    expect(merged.metadata.createdAt).toBe(200);
    expect(merged.metadata.startTime).toBe(100);
    expect(merged.metadata.endTime).toBe(310);
    expect(merged.metadata.localTimeOffsetSeconds).toBe(32400);
    expect(merged.metadata.totalElapsedTime).toBe(210);
    expect(merged.metadata.totalTimerTime).toBe(30);
    expect(merged.metadata.totalDistanceM).toBe(230);
    expect(merged.points.map((point) => point.time)).toEqual([
      100, 110, 200, 210, 300, 310,
    ]);
    expect(merged.points.map((point) => point.distanceM)).toEqual([
      0, 100, 100, 180, 180, 230,
    ]);
  });

  test("drops merged local time offset unless all inputs agree", () => {
    const first = makeActivity(2);
    const second = makeActivity(2);
    second.metadata.localTimeOffsetSeconds = 3600;

    expect(mergeTrackActivities([first, second]).metadata.localTimeOffsetSeconds)
      .toBeUndefined();

    second.metadata.localTimeOffsetSeconds = 32400;
    delete first.metadata.localTimeOffsetSeconds;

    expect(mergeTrackActivities([first, second]).metadata.localTimeOffsetSeconds)
      .toBeUndefined();
  });

  test("writes merged activities as a single LineString", () => {
    const first = makeActivity(2);
    const second = makeActivity(2);
    second.points.forEach((point, index) => {
      point.time = 1710000100 + index;
      point.distanceM = index * 20;
    });

    const merged = mergeTrackActivities([first, second]);
    const parsed = parseTrackJson(trackActivityToTrackJson(merged));

    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].geometry.type).toBe("LineString");
    expect(parsed.features[0].geometry.coordinates).toHaveLength(4);
    expect(parsed.features[0].properties.metadata.source).toEqual({
      type: "merged",
    });
  });

  test("does not count gaps between source files as moving time", () => {
    const first = makeActivity(2);
    first.points[0].time = 0;
    first.points[1].time = 10;
    first.points[0].speedMps = 5;
    first.points[1].speedMps = 5;

    const second = makeActivity(2);
    second.points[0].time = 1000;
    second.points[1].time = 1010;
    second.points[0].speedMps = 5;
    second.points[1].speedMps = 5;

    const merged = mergeTrackActivities([first, second]);

    expect(merged.metadata.totalElapsedTime).toBe(1010);
    expect(merged.metadata.totalTimerTime).toBe(20);
  });
});

describe("trackActivityToTrackJson", () => {
  test("writes a GeoJSON FeatureCollection", () => {
    const parsed = parseTrackJson(
      trackActivityToTrackJson(makeActivity(3), {
        title: " Ride ",
        description: " Test route ",
      }),
    );
    const feature = parsed.features[0];

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.bbox).toEqual([139, 35, 139.00002, 35.00002]);
    expect(parsed.rcenter).toEqual([139.00001, 35.00001]);
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

  test("writes bbox using the output coordinate precision", () => {
    const parsed = parseTrackJson(
      trackActivityToTrackJson(makeActivity(2), {
        precision: { coordinates: 6 },
      }),
    );

    expect(parsed.bbox).toEqual([139.000001, 35.000001, 139.000011, 35.000011]);
    expect(parsed.rcenter).toEqual([139.000006, 35.000006]);
  });

  test("can add bbox and rcenter to TrackJSON features including pins", () => {
    const data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [138.12, 36.3],
              [138.4, 36.5],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [138.7, 36.8],
          },
          properties: { title: "東御市役所" },
        },
      ],
    };

    expect(addTrackJsonBbox(data)).toEqual({
      ...data,
      bbox: [138.12, 36.3, 138.7, 36.8],
      rcenter: [138.25982, 36.40008],
    });
  });

  test("computes rcenter across the antimeridian", () => {
    const parsed = parseTrackJson(
      trackActivityToTrackJson(
        {
          schemaVersion: 1,
          metadata: {},
          points: [
            { lat: 1, lon: 179.9 },
            { lat: 1, lon: -179.9 },
          ],
          warnings: [],
        },
        { precision: { coordinates: 4 } },
      ),
    );

    expect(parsed.rcenter).toEqual([180, 1]);
  });

  test("does not connect separated point segments", () => {
    const parsed = parseTrackJson(
      trackActivityToTrackJson(
        {
          schemaVersion: 1,
          metadata: {},
          points: [
            { lat: 35.0, lon: 139.0, time: 1, distanceM: 0 },
            { lat: 35.1, lon: 139.1, time: 2, distanceM: 1000 },
            {},
            { lat: 36.0, lon: 140.0, time: 3, distanceM: 2000 },
            { lat: 36.1, lon: 140.1, time: 4, distanceM: 3000 },
          ],
          warnings: [],
        },
        { precision: { coordinates: 4 } },
      ),
    );

    expect(parsed.features).toHaveLength(2);
    expect(parsed.features[0].geometry.coordinates).toEqual([
      [139, 35],
      [139.1, 35.1],
    ]);
    expect(parsed.features[1].geometry.coordinates).toEqual([
      [140, 36],
      [140.1, 36.1],
    ]);
    expect(parsed.features[0].properties.coordinateProperties.times).toEqual([1, 2]);
    expect(parsed.features[1].properties.coordinateProperties.times).toEqual([3, 4]);
  });

  test("writes standard coordinateProperties arrays", () => {
    const parsed = parseTrackJson(trackActivityToTrackJson(makeActivity(3)));
    const coordinateProperties =
      parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.times).toEqual([
      1710000000, 1710000001, 1710000002,
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
      endTime: 1710003902,
      localTimeOffsetSeconds: 32400,
      totalElapsedTime: 3901,
      totalTimerTime: 3601,
      totalDistanceM: 12345.7,
      recordingDevice: {
        manufacturer: "garmin",
        product: "edge",
        serialNumber: 123456789,
      },
    });
  });

  test("writes statistics and training metadata", () => {
    const activity = makeActivity(2);
    activity.metadata.devices = [
      {
        manufacturer: "garmin",
        product: "Edge 1040",
        softwareVersion: "19.12",
      },
    ];
    activity.metadata.statistics = {
      speedKph: { avg: 18.36, median: 18.36, max: 19.1 },
      powerW: { avg: 150.25, median: 150.25, max: 200 },
      temperatureC: { avg: 21.24, median: 21.24, max: 25 },
    };
    activity.metadata.training = {
      normalizedPowerW: 201.23,
      totalWorkJ: 123456.7,
      totalCaloriesCal: 789400,
      source: {
        normalizedPower: "computed",
        totalWork: "computed",
        totalCalories: "fit",
      },
    };
    activity.metadata.bestEfforts = {
      powerW: {
        "5": 512.34,
        "60": 234.56,
      },
    };
    activity.metadata.histograms = {
      powerW: {
        bucketSizeW: 25,
        maxBucketW: 2000,
        totalSeconds: 30.24,
        buckets: [
          { label: "0 W", seconds: 3 },
          { label: "≤25 W", seconds: 10.24 },
          { label: ">2000 W", seconds: 17 },
        ],
      },
    };

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const metadata = parsed.features[0].properties.metadata;

    expect(metadata.devices).toEqual([
      {
        manufacturer: "garmin",
        product: "Edge 1040",
        softwareVersion: "19.12",
      },
    ]);
    expect(metadata.statistics).toEqual({
      speedKph: { avg: 18.4, median: 18.4, max: 19.1 },
      powerW: { avg: 150.3, median: 150.3, max: 200 },
      temperatureC: { avg: 21.2, median: 21.2, max: 25 },
    });
    expect(metadata.training).toEqual({
      normalizedPowerW: 201.2,
      totalWorkJ: 123457,
      totalCaloriesCal: 789400,
      source: {
        normalizedPower: "computed",
        totalWork: "computed",
        totalCalories: "fit",
      },
    });
    expect(metadata.bestEfforts).toEqual({
      powerW: {
        "5": 512.3,
        "60": 234.6,
      },
    });
    expect(metadata.histograms).toEqual({
      powerW: {
        bucketSizeW: 25,
        maxBucketW: 2000,
        totalSeconds: 30.2,
        buckets: [
          { label: "0 W", seconds: 3 },
          { label: "≤25 W", seconds: 10.2 },
          { label: ">2000 W", seconds: 17 },
        ],
      },
    });
  });

  test("can omit metadata", () => {
    const parsed = parseTrackJson(
      trackActivityToTrackJson(makeActivity(2), {
        includeMetadata: false,
      }),
    );

    expect(parsed.features[0].properties.metadata).toBeUndefined();
  });

  test("can override output precision", () => {
    const parsed = parseTrackJson(
      trackActivityToTrackJson(makeActivity(3), {
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
      }),
    );
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
    const coordinateProperties =
      parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.heartRates).toEqual([120, 120, 122]);
    expect(coordinateProperties.powers).toEqual([150, 151, 152]);
  });

  test("uses zero before the first available fill-forward value", () => {
    const activity = makeActivity(3);
    delete activity.points[0].heartRateBpm;
    delete activity.points[1].heartRateBpm;

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties =
      parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.heartRates).toEqual([0, 0, 122]);
  });

  test("omits a fill-forward series when it has no valid values", () => {
    const activity = makeActivity(3);
    activity.points.forEach((point) => {
      delete point.heartRateBpm;
    });

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties =
      parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.heartRates).toBeUndefined();
  });

  test("omits complete standard series when some geo points are missing values", () => {
    const activity = makeActivity(3);
    delete activity.points[1].elevationM;

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties =
      parsed.features[0].properties.coordinateProperties;

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
    const coordinateProperties =
      parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.grade).toEqual([1.2, 2.3, 3.5]);
    expect(
      Object.prototype.hasOwnProperty.call(coordinateProperties, "constructor"),
    ).toBe(false);
    expect(coordinateProperties.powers).toEqual([150, 151, 152]);
  });

  test("omits incomplete custom metric series", () => {
    const activity = makeActivity(3);
    activity.points[0].metrics = { grade: 1 };
    activity.points[1].metrics = {};
    activity.points[2].metrics = { grade: 3 };

    const parsed = parseTrackJson(trackActivityToTrackJson(activity));
    const coordinateProperties =
      parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.grade).toBeUndefined();
  });

  test("can omit custom metrics", () => {
    const activity = makeActivity(3);
    activity.points.forEach((point, index) => {
      point.metrics = { grade: index };
    });

    const parsed = parseTrackJson(
      trackActivityToTrackJson(activity, {
        includeMetrics: false,
      }),
    );
    const coordinateProperties =
      parsed.features[0].properties.coordinateProperties;

    expect(coordinateProperties.grade).toBeUndefined();
  });

  test("throws when there are no positioned points", () => {
    const activity = makeActivity(3);
    activity.points.forEach((point) => {
      delete point.lat;
      delete point.lon;
    });

    expect(() => trackActivityToTrackJson(activity)).toThrow(
      TrackJsonConversionError,
    );
  });

  test("throws when there is only one positioned point", () => {
    const activity = makeActivity(1);

    expect(() => trackActivityToTrackJson(activity)).toThrow(
      TrackJsonConversionError,
    );
  });

  test("pretty-prints TrackJSON when requested", () => {
    const json = trackActivityToTrackJson(makeActivity(2), {
      pretty: true,
    });

    expect(json).toContain("\n  ");
  });
});


describe("training zones", () => {
  test("classifies Coggan-style power zones", () => {
    expect(getPowerZone(110, 200)).toBe("z1");
    expect(getPowerZone(110.1, 200)).toBe("z2");
    expect(getPowerZone(150, 200)).toBe("z2");
    expect(getPowerZone(150.1, 200)).toBe("z3");
    expect(getPowerZone(180, 200)).toBe("z3");
    expect(getPowerZone(210, 200)).toBe("z4");
    expect(getPowerZone(240, 200)).toBe("z5");
    expect(getPowerZone(300, 200)).toBe("z6");
    expect(getPowerZone(300.1, 200)).toBe("z7");
  });

  test("classifies LTHR-based heart-rate zones", () => {
    expect(getHeartRateZone(129.6, 160)).toBe("z1");
    expect(getHeartRateZone(129.7, 160)).toBe("z2");
    expect(getHeartRateZone(142.4, 160)).toBe("z2");
    expect(getHeartRateZone(142.5, 160)).toBe("z3");
    expect(getHeartRateZone(150.4, 160)).toBe("z3");
    expect(getHeartRateZone(150.5, 160)).toBe("z4");
    expect(getHeartRateZone(160, 160)).toBe("z4");
    expect(getHeartRateZone(160.1, 160)).toBe("z5");
  });

  test("computes timed power zone durations", () => {
    const points: TrackPoint[] = [
      { time: 0, powerW: 100 },
      { time: 10, powerW: 160 },
      { time: 20, powerW: 220 },
      { time: 30, powerW: 320 },
    ];

    const summary = computePowerZoneSummary(points, 200);

    expect(summary.totalSeconds).toBe(30);
    expect(summary.durations).toEqual({
      z1: 10,
      z2: 0,
      z3: 10,
      z4: 0,
      z5: 10,
      z6: 0,
      z7: 0,
    });
    expect(summary.percentages.z1).toBeCloseTo(33.3333);
  });

  test("computes timed heart-rate zone durations", () => {
    const points: TrackPoint[] = [
      { time: 0, heartRateBpm: 120 },
      { time: 10, heartRateBpm: 140 },
      { time: 20, heartRateBpm: 155 },
      { time: 30, heartRateBpm: 170 },
    ];

    const summary = computeHeartRateZoneSummary(points, 160);

    expect(summary.totalSeconds).toBe(30);
    expect(summary.durations).toEqual({
      z1: 10,
      z2: 10,
      z3: 0,
      z4: 10,
      z5: 0,
    });
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
      endTime: 1710003902,
      localTimeOffsetSeconds: 32400,
      totalElapsedTime: 3900.6,
      totalTimerTime: 3600.6,
      totalDistanceM: 12345.67,
      recordingDevice: {
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

type TestPoint = {
  lat: number;
  lon: number;
  distanceM?: number;
};

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400,
  0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

function buildFit(points: TestPoint[], includeDistance = true): Uint8Array {
  const fields = includeDistance
    ? [
      [0, 4, 0x85],
      [1, 4, 0x85],
      [5, 4, 0x86],
    ]
    : [
      [0, 4, 0x85],
      [1, 4, 0x85],
    ];

  const records: number[] = [
    0x40,
    0x00,
    0x00,
    0x14,
    0x00,
    fields.length,
  ];
  fields.forEach(([fieldNumber, size, baseType]) => {
    records.push(fieldNumber, size, baseType);
  });

  points.forEach((point, index) => {
    records.push(0x00);
    pushInt32(records, degreesToSemicircle(point.lat));
    pushInt32(records, degreesToSemicircle(point.lon));
    if (includeDistance) {
      pushUint32(records, Math.round((point.distanceM ?? index * 500) * 100));
    }
  });

  const headerSize = 14;
  const data = new Uint8Array(headerSize + records.length + 2);
  data[0] = headerSize;
  data[1] = 16;
  writeUint16(data, 2, 0);
  writeUint32(data, 4, records.length);
  data[8] = ".".charCodeAt(0);
  data[9] = "F".charCodeAt(0);
  data[10] = "I".charCodeAt(0);
  data[11] = "T".charCodeAt(0);
  records.forEach((value, index) => {
    data[headerSize + index] = value;
  });
  writeUint16(
    data,
    headerSize + records.length,
    calculateFitCrc(data, 0, headerSize + records.length)
  );
  return data;
}

function readRecordCoordinates(fit: Uint8Array, includeDistance = true): Array<[number, number]> {
  const headerSize = fit[0];
  const definitionSize = includeDistance ? 15 : 12;
  const recordSize = includeDistance ? 13 : 9;
  const coordinates: Array<[number, number]> = [];
  let offset = headerSize + definitionSize;
  const dataEndOffset = headerSize + readUint32(fit, 4);

  while (offset < dataEndOffset) {
    offset += 1;
    const lat = semicircleToDegrees(readInt32(fit, offset));
    const lon = semicircleToDegrees(readInt32(fit, offset + 4));
    coordinates.push([round6(lat), round6(lon)]);
    offset += recordSize - 1;
  }

  return coordinates;
}

function expectValidFileCrc(fit: Uint8Array): void {
  const dataEndOffset = fit[0] + readUint32(fit, 4);
  expect(readUint16(fit, dataEndOffset)).toBe(calculateFitCrc(fit, 0, dataEndOffset));
}

function pushInt32(values: number[], value: number): void {
  pushUint32(values, value >>> 0);
}

function pushUint32(values: number[], value: number): void {
  values.push(
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff
  );
}

function writeUint16(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
}

function readUint16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function writeUint32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >> 8) & 0xff;
  data[offset + 2] = (value >> 16) & 0xff;
  data[offset + 3] = (value >> 24) & 0xff;
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}

function readInt32(data: Uint8Array, offset: number): number {
  const value = readUint32(data, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function degreesToSemicircle(value: number): number {
  return Math.round(value * 2147483648 / 180);
}

function semicircleToDegrees(value: number): number {
  return value * 180 / 2147483648;
}

function round6(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function calculateFitCrc(data: Uint8Array, offset: number, length: number): number {
  let crc = 0;
  for (let i = offset; i < offset + length; i += 1) {
    let tmp = CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[data[i] & 0x0f];

    tmp = CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(data[i] >> 4) & 0x0f];
  }
  return crc & 0xffff;
}

describe("obfuscateFitPrivacy", () => {
  const points: TestPoint[] = [
    { lat: 35.0000, lon: 139.0000, distanceM: 0 },
    { lat: 35.0005, lon: 139.0005, distanceM: 500 },
    { lat: 35.0010, lon: 139.0010, distanceM: 1000 },
    { lat: 35.0015, lon: 139.0015, distanceM: 1500 },
    { lat: 35.0020, lon: 139.0020, distanceM: 2000 },
  ];

  test("clamps start coordinates to the start boundary point", () => {
    const fit = buildFit(points);
    const obfuscated = obfuscateFitPrivacy(fit, { startDistanceM: 1000 });
    const coordinates = readRecordCoordinates(obfuscated);

    expect(coordinates).toEqual([
      [35.0010, 139.0010],
      [35.0010, 139.0010],
      [35.0010, 139.0010],
      [35.0015, 139.0015],
      [35.0020, 139.0020],
    ]);
    expectValidFileCrc(obfuscated);
  });

  test("clamps end coordinates to the end boundary point", () => {
    const fit = buildFit(points);
    const obfuscated = obfuscateFitPrivacy(fit, { endDistanceM: 700 });
    const coordinates = readRecordCoordinates(obfuscated);

    expect(coordinates).toEqual([
      [35.0000, 139.0000],
      [35.0005, 139.0005],
      [35.0010, 139.0010],
      [35.0010, 139.0010],
      [35.0010, 139.0010],
    ]);
    expectValidFileCrc(obfuscated);
  });

  test("clamps all coordinates to the midpoint when privacy ranges overlap", () => {
    const fit = buildFit(points);
    const obfuscated = obfuscateFitPrivacy(fit, {
      startDistanceM: 1200,
      endDistanceM: 1200,
    });
    const coordinates = readRecordCoordinates(obfuscated);

    expect(coordinates).toEqual([
      [35.0010, 139.0010],
      [35.0010, 139.0010],
      [35.0010, 139.0010],
      [35.0010, 139.0010],
      [35.0010, 139.0010],
    ]);
    expectValidFileCrc(obfuscated);
  });

  test("falls back to coordinate distance when FIT distance is unavailable", () => {
    const fit = buildFit([
      { lat: 35.0000, lon: 139.0000 },
      { lat: 35.0000, lon: 139.0050 },
      { lat: 35.0000, lon: 139.0100 },
    ], false);
    const obfuscated = obfuscateFitPrivacy(fit, { startDistanceM: 100 });
    const coordinates = readRecordCoordinates(obfuscated, false);

    expect(coordinates).toEqual([
      [35.0000, 139.0050],
      [35.0000, 139.0050],
      [35.0000, 139.0100],
    ]);
    expectValidFileCrc(obfuscated);
  });

  test("does not mutate the input buffer", () => {
    const fit = buildFit(points);
    const original = new Uint8Array(fit);

    obfuscateFitPrivacy(fit, { startDistanceM: 1000 });

    expect(fit).toEqual(original);
  });

  test("rejects negative privacy distances", () => {
    const fit = buildFit(points);

    expect(() => obfuscateFitPrivacy(fit, { startDistanceM: -1 })).toThrow(
      "FIT privacy obfuscation distance must be a non-negative finite number"
    );
  });
});


describe("trackActivityToFit", () => {
  test("exports TrackActivity as FIT bytes", () => {
    const exported = trackActivityToFit({
      schemaVersion: 1,
      metadata: {
        sport: "cycling",
        startTime: 1710000000,
        endTime: 1710000010,
        totalElapsedTime: 10,
        totalTimerTime: 10,
        totalDistanceM: 120,
        training: {
          totalCaloriesCal: 123000,
          source: {
            totalCalories: "fit",
          },
        },
      },
      points: [
        {
          time: 1710000000,
          lat: 35,
          lon: 139,
          distanceM: 0,
          elevationM: 10,
          speedMps: 12,
          heartRateBpm: 100,
          cadenceRpm: 80,
          powerW: 150,
          temperatureC: 20,
        },
        {
          time: 1710000010,
          lat: 35.0001,
          lon: 139.0001,
          distanceM: 120,
          elevationM: 11,
          speedMps: 12,
          heartRateBpm: 102,
          cadenceRpm: 82,
          powerW: 160,
          temperatureC: 21,
        },
      ],
      warnings: [],
    });

    const definitions = readFitExportDefinitions(exported);

    expect(exported[0]).toBe(14);
    expect(String.fromCharCode(...exported.slice(8, 12))).toBe(".FIT");
    expect(exported.length).toBeGreaterThan(14 + 2);
    expect(getFitExportDefinition(definitions, 18)?.fields.map((field) => field.num))
      .toContain(11);
    expect(getFitExportDefinition(definitions, 19)?.fields.map((field) => field.num))
      .toContain(11);
  });
});


type FitExportDefinition = {
  localMessageType: number;
  globalMessageNumber: number;
  fields: { num: number; size: number; baseType: number }[];
};

function readFitExportDefinitions(bytes: Uint8Array): FitExportDefinition[] {
  const headerSize = bytes[0];
  const dataSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(4, true);
  const definitions = new Map<number, FitExportDefinition>();
  const output: FitExportDefinition[] = [];
  let offset = headerSize;
  const end = headerSize + dataSize;

  while (offset < end) {
    const recordHeader = bytes[offset];
    offset += 1;
    const localMessageType = recordHeader & 0x0f;

    if ((recordHeader & 0x40) !== 0) {
      offset += 1;
      const architecture = bytes[offset];
      offset += 1;
      const littleEndian = architecture === 0;
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 2);
      const globalMessageNumber = view.getUint16(0, littleEndian);
      offset += 2;
      const fieldCount = bytes[offset];
      offset += 1;
      const fields = Array.from({ length: fieldCount }, () => {
        const field = {
          num: bytes[offset],
          size: bytes[offset + 1],
          baseType: bytes[offset + 2],
        };
        offset += 3;
        return field;
      });
      const definition = { localMessageType, globalMessageNumber, fields };
      definitions.set(localMessageType, definition);
      output.push(definition);
      continue;
    }

    const definition = definitions.get(localMessageType);
    if (!definition) {
      throw new Error(`FIT data message has no definition: ${localMessageType}`);
    }
    offset += definition.fields.reduce((sum, field) => sum + field.size, 0);
  }

  return output;
}

function getFitExportDefinition(
  definitions: FitExportDefinition[],
  globalMessageNumber: number,
): FitExportDefinition | undefined {
  return definitions.find((definition) => {
    return definition.globalMessageNumber === globalMessageNumber;
  });
}


describe("TrackJSON Point Feature pins", () => {
  test("preserves Point Features through TrackActivity", () => {
    const input = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [138.1, 36.1],
              [138.2, 36.2],
            ],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [138.330295, 36.35955],
          },
          properties: {
            title: "東御市役所",
            description: "雷電為右衛門の像があります",
            links: [{ href: "https://www.city.tomi.nagano.jp/", text: "東御市役所" }],
            images: [{ src: "/data/demo-raiden.jpg", alt: "雷電為右衛門の像" }],
          },
        },
      ],
    };

    const activity = trackJsonDataToTrackActivity(input, { sourceType: "trackjson" });
    expect(activity.pins).toEqual([
      {
        lat: 36.35955,
        lon: 138.330295,
        properties: {
          title: "東御市役所",
          description: "雷電為右衛門の像があります",
          links: [{ href: "https://www.city.tomi.nagano.jp/", text: "東御市役所" }],
          images: [{ src: "/data/demo-raiden.jpg", alt: "雷電為右衛門の像" }],
        },
      },
    ]);

    const output = JSON.parse(trackActivityToTrackJson(activity, {
      precision: { coordinates: 6 },
    }));
    const pointFeature = output.features.find((feature: any) => {
      return feature.geometry?.type === "Point";
    });

    expect(pointFeature).toEqual(input.features[1]);
    expect(output.bbox).toEqual([138.1, 36.1, 138.330295, 36.35955]);
  });

  test("keeps pins when downsampling and merging activities", () => {
    const activity: TrackActivity = {
      schemaVersion: 1,
      metadata: {},
      points: [
        { lat: 36.1, lon: 138.1, distanceM: 0 },
        { lat: 36.2, lon: 138.2, distanceM: 1000 },
        { lat: 36.3, lon: 138.3, distanceM: 2000 },
      ],
      pins: [
        {
          lat: 36.35955,
          lon: 138.330295,
          properties: { title: "東御市役所" },
        },
      ],
      warnings: [],
    };

    const downsampled = downsampleTrackActivity(activity, { maxPoints: 2 });
    expect(downsampled.pins).toEqual(activity.pins);

    const merged = mergeTrackActivities([activity], { name: "Merged" });
    expect(merged.pins).toEqual(activity.pins);
  });
});


describe("TrackJSON metadata round-trip", () => {
  test("preserves training calories from FIT-derived TrackJSON", () => {
    const activity: TrackActivity = {
      schemaVersion: 1,
      metadata: {
        name: "Calorie Ride",
        totalElapsedTime: 2,
        totalTimerTime: 2,
        totalDistanceM: 12,
        training: {
          normalizedPowerW: 147,
          totalWorkJ: 294,
          totalCaloriesCal: 123456,
          source: {
            normalizedPower: "computed",
            totalWork: "computed",
            totalCalories: "fit",
          },
        },
      },
      points: [
        {
          lat: 36,
          lon: 138,
          time: 1000,
          distanceM: 0,
          powerW: 147,
        },
        {
          lat: 36.0001,
          lon: 138.0001,
          time: 1002,
          distanceM: 12,
          powerW: 147,
        },
      ],
      warnings: [],
    };

    const trackJson = trackActivityToTrackJson(activity, { includeMetadata: true });
    const parsed = trackJsonDataToTrackActivity(JSON.parse(trackJson));

    expect(parsed.metadata.training?.totalCaloriesCal).toBe(123456);
    expect(parsed.metadata.training?.source?.totalCalories).toBe("fit");
  });
});

