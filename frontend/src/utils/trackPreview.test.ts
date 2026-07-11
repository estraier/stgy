import { gzipSync } from "zlib";
import {
  downsampleTrackActivity,
  obfuscateFitPrivacy,
  parseFitBytes,
  trackActivityToTrackJson,
  trackJsonDataToTrackActivity,
} from "stgy-track/fit";
import {
  compactTrackJsonData,
  downsampleTrackJsonData,
  parseTrackJsonData,
} from "stgy-track/trackjson";
import {
  TRACK_OBFUSCATION_MAX_DISTANCE_M,
  TRACK_OBFUSCATION_MIN_DISTANCE_M,
  TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  createTrackObfuscationDistances,
  formatTrackPreviewDistance,
  formatTrackPreviewElapsedTime,
  formatTrackPreviewStartTime,
  makeFitPreview,
  makeFitPreviewJson,
  makeTrackJsonPreview,
  makeTrackJsonPreviewJson,
  makeTrackUploadPreview,
  makeTrackUploadPreviewJson,
  normalizeTrackObfuscationDistance,
  prepareTrackUploadPayload,
} from "./trackPreview";

jest.mock("stgy-track/fit", () => ({
  downsampleTrackActivity: jest.fn(),
  obfuscateFitPrivacy: jest.fn(),
  parseFitBytes: jest.fn(),
  trackActivityToTrackJson: jest.fn(),
  trackJsonDataToTrackActivity: jest.fn(),
}));

jest.mock("stgy-track/trackjson", () => ({
  compactTrackJsonData: jest.fn(),
  downsampleTrackJsonData: jest.fn(),
  parseTrackJsonData: jest.fn(),
}));

const obfuscateFitPrivacyMock = jest.mocked(obfuscateFitPrivacy);
const parseFitBytesMock = jest.mocked(parseFitBytes);
const downsampleTrackActivityMock = jest.mocked(downsampleTrackActivity);
const trackActivityToTrackJsonMock = jest.mocked(trackActivityToTrackJson);
const trackJsonDataToTrackActivityMock = jest.mocked(trackJsonDataToTrackActivity);
const parseTrackJsonDataMock = jest.mocked(parseTrackJsonData);
const downsampleTrackJsonDataMock = jest.mocked(downsampleTrackJsonData);
const compactTrackJsonDataMock = jest.mocked(compactTrackJsonData);

beforeEach(() => {
  jest.clearAllMocks();
});

test("builds a FIT preview with uniform 3000-point downsampling and metadata", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const activity = {
    metadata: {
      startTime: 1_700_000_000,
      localTimeOffsetSeconds: 9 * 3600,
      totalDistanceM: 42_195,
      totalElapsedTime: 12_345,
      name: "ignored",
    },
    points: new Array(4000),
  };
  const preview = { points: new Array(3000) };

  parseFitBytesMock.mockReturnValue(activity as never);
  downsampleTrackActivityMock.mockReturnValue(preview as never);
  trackActivityToTrackJsonMock.mockReturnValue('{"type":"FeatureCollection"}');

  await expect(makeFitPreview(bytes)).resolves.toEqual({
    json: '{"type":"FeatureCollection"}',
    metadata: {
      startTime: 1_700_000_000,
      localTimeOffsetSeconds: 9 * 3600,
      totalDistanceM: 42_195,
      totalElapsedTime: 12_345,
    },
  });
  await expect(makeFitPreviewJson(bytes)).resolves.toBe('{"type":"FeatureCollection"}');
  expect(parseFitBytesMock).toHaveBeenCalledWith(bytes);
  expect(downsampleTrackActivityMock).toHaveBeenCalledWith(activity, {
    maxPoints: TRACK_UPLOAD_PREVIEW_MAX_POINTS,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  expect(trackActivityToTrackJsonMock).toHaveBeenCalledWith(preview, {
    pretty: false,
  });
});

test("builds a compact TrackJSON preview and derives its metadata", async () => {
  const parsed = { type: "FeatureCollection", features: [] };
  const downsampled = { ...parsed, sampled: true };
  const compact = { ...parsed, compact: true };
  const activity = {
    metadata: {
      startTime: 1_700_000_000,
      totalDistanceM: 12_345,
      totalElapsedTime: 3_661,
    },
  };

  parseTrackJsonDataMock.mockReturnValue(parsed);
  trackJsonDataToTrackActivityMock.mockReturnValue(activity as never);
  downsampleTrackJsonDataMock.mockReturnValue(downsampled);
  compactTrackJsonDataMock.mockReturnValue(compact);

  await expect(makeTrackJsonPreview(JSON.stringify(parsed))).resolves.toEqual({
    json: JSON.stringify(compact),
    metadata: activity.metadata,
  });
  await expect(makeTrackJsonPreviewJson(JSON.stringify(parsed))).resolves.toBe(
    JSON.stringify(compact),
  );
  expect(trackJsonDataToTrackActivityMock).toHaveBeenCalledWith(parsed);
  expect(downsampleTrackJsonDataMock).toHaveBeenCalledWith(parsed, {
    maxPoints: TRACK_UPLOAD_PREVIEW_MAX_POINTS,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  expect(compactTrackJsonDataMock).toHaveBeenCalledWith(downsampled);
});

test("decompresses a TRJGZ file before building its preview", async () => {
  const text = '{"type":"FeatureCollection","features":[]}';
  const compressed = gzipSync(Buffer.from(text, "utf8"));
  const bytes = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  );
  const parsed = { type: "FeatureCollection", features: [] };
  const activity = { metadata: {} };

  parseTrackJsonDataMock.mockReturnValue(parsed);
  trackJsonDataToTrackActivityMock.mockReturnValue(activity as never);
  downsampleTrackJsonDataMock.mockReturnValue(parsed);
  compactTrackJsonDataMock.mockReturnValue(parsed);

  const file = {
    name: "ride.trjgz",
    arrayBuffer: jest.fn().mockResolvedValue(bytes),
  };

  await expect(makeTrackUploadPreview(file)).resolves.toEqual({
    json: JSON.stringify(parsed),
    metadata: {},
  });
  await expect(makeTrackUploadPreviewJson(file)).resolves.toBe(JSON.stringify(parsed));
  expect(parseTrackJsonDataMock).toHaveBeenCalledWith(text);
});

test("rejects unsupported upload formats", async () => {
  const file = {
    name: "ride.gpx",
    arrayBuffer: jest.fn(),
  };

  await expect(makeTrackUploadPreview(file)).rejects.toThrow(
    "Only FIT and TRJGZ files are supported.",
  );
  expect(file.arrayBuffer).not.toHaveBeenCalled();
});

test("formats preview date, distance, and elapsed time", () => {
  const metadata = {
    startTime: Date.UTC(2026, 6, 11, 1, 2, 3) / 1000,
    localTimeOffsetSeconds: 9 * 3600,
    totalDistanceM: 42_195,
    totalElapsedTime: 3_661,
  };

  expect(formatTrackPreviewStartTime(metadata)).toBe("2026-07-11 10:02:03");
  expect(formatTrackPreviewDistance(metadata)).toBe("42.20 km");
  expect(formatTrackPreviewElapsedTime(metadata)).toBe("1:01:01");
});

test("formats short distance and duration values", () => {
  expect(formatTrackPreviewDistance({ totalDistanceM: 750 })).toBe("750 m");
  expect(formatTrackPreviewElapsedTime({ totalElapsedTime: 125 })).toBe("2:05");
});

test("obfuscates FIT bytes before building the preview when enabled", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const obfuscated = new Uint8Array([4, 5, 6]);
  const activity = { metadata: {}, points: [] };

  obfuscateFitPrivacyMock.mockReturnValue(obfuscated);
  parseFitBytesMock.mockReturnValue(activity as never);
  downsampleTrackActivityMock.mockReturnValue(activity as never);
  trackActivityToTrackJsonMock.mockReturnValue('{"type":"FeatureCollection"}');

  await makeFitPreview(bytes, TRACK_UPLOAD_PREVIEW_MAX_POINTS, {
    enabled: true,
    startDistanceM: 1100,
    endDistanceM: 1300,
  });

  expect(obfuscateFitPrivacyMock).toHaveBeenCalledWith(bytes, {
    startDistanceM: 1100,
    endDistanceM: 1300,
  });
  expect(parseFitBytesMock).toHaveBeenCalledWith(obfuscated);
});

test("chooses independent random obfuscation distances within 1000-1500m", () => {
  const values = [0, 0.999999];
  const distances = createTrackObfuscationDistances(100_000, () => values.shift() || 0);

  expect(distances).toEqual({
    startDistanceM: TRACK_OBFUSCATION_MIN_DISTANCE_M,
    endDistanceM: TRACK_OBFUSCATION_MAX_DISTANCE_M,
  });
});

test("caps default and edited obfuscation distances at five percent", () => {
  const values = [0.25, 0.75];
  expect(createTrackObfuscationDistances(20_000, () => values.shift() || 0)).toEqual({
    startDistanceM: 1000,
    endDistanceM: 1000,
  });
  expect(normalizeTrackObfuscationDistance(1400, 20_000)).toBe(1000);
  expect(normalizeTrackObfuscationDistance(-10, 20_000)).toBe(0);
});

test("rewrites only enabled FIT upload payloads", async () => {
  const originalBytes = new Uint8Array([1, 2, 3]);
  const outputBytes = new Uint8Array([4, 5, 6]);
  const file = {
    name: "ride.fit",
    type: "application/octet-stream",
    size: originalBytes.byteLength,
    arrayBuffer: jest.fn().mockResolvedValue(originalBytes.buffer),
  } as unknown as File;
  obfuscateFitPrivacyMock.mockReturnValue(outputBytes);

  await expect(
    prepareTrackUploadPayload(file, {
      enabled: false,
      startDistanceM: 1000,
      endDistanceM: 1000,
    }),
  ).resolves.toBe(file);

  const payload = await prepareTrackUploadPayload(file, {
    enabled: true,
    startDistanceM: 1100,
    endDistanceM: 1200,
  });

  expect(payload).toBeInstanceOf(Blob);
  expect(payload.size).toBe(outputBytes.byteLength);
  expect(obfuscateFitPrivacyMock).toHaveBeenCalledWith(originalBytes.buffer, {
    startDistanceM: 1100,
    endDistanceM: 1200,
  });


  const trackJsonFile = {
    ...file,
    name: "ride.trjgz",
  } as File;
  await expect(
    prepareTrackUploadPayload(trackJsonFile, {
      enabled: true,
      startDistanceM: 1100,
      endDistanceM: 1200,
    }),
  ).resolves.toBe(trackJsonFile);
});
