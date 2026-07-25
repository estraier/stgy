import { gunzipSync, gzipSync } from "zlib";
import {
  addTrackJsonDerivedProperties,
  countFitRecordMessages,
  downsampleFitRecordMessages,
  downsampleTrackActivity,
  obfuscateFitPrivacy,
  parseFitBytes,
  trackActivityToTrackJson,
  trackJsonDataToTrackActivity,
} from "stgy-track/fit";
import {
  compactTrackJsonData,
  countTrackJsonPositionedPoints,
  downsampleTrackJsonData,
  obfuscateTrackJsonPrivacy,
  parseTrackJsonData,
} from "stgy-track/trackjson";
import {
  TRACK_OBFUSCATION_DEFAULT_DISTANCE_M,
  TRACK_UPLOAD_POINT_LIMIT,
  TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  createTrackObfuscationDistances,
  formatTrackPreviewDistance,
  formatTrackPreviewElapsedTime,
  formatTrackPreviewStartTime,
  getTrackUploadDownsamplePointCount,
  makeFitPreview,
  makeFitPreviewJson,
  makeGpxPreview,
  makeTrackJsonPreview,
  makeTrackJsonPreviewJson,
  makeTrackUploadPreview,
  makeTrackUploadPreviewJson,
  normalizeTrackObfuscationDistance,
  prepareTrackUploadPayload,
} from "./trackPreview";
import { parseGpxText } from "stgy-track/gpx";

jest.mock("stgy-track/fit", () => ({
  addTrackJsonDerivedProperties: jest.fn(),
  countFitRecordMessages: jest.fn(),
  downsampleFitRecordMessages: jest.fn(),
  downsampleTrackActivity: jest.fn(),
  obfuscateFitPrivacy: jest.fn(),
  parseFitBytes: jest.fn(),
  trackActivityToTrackJson: jest.fn(),
  trackJsonDataToTrackActivity: jest.fn(),
}));

jest.mock("stgy-track/trackjson", () => ({
  compactTrackJsonData: jest.fn(),
  countTrackJsonPositionedPoints: jest.fn(),
  downsampleTrackJsonData: jest.fn(),
  obfuscateTrackJsonPrivacy: jest.fn(),
  parseTrackJsonData: jest.fn(),
}));

jest.mock("stgy-track/gpx", () => ({
  parseGpxText: jest.fn(),
}));

const addTrackJsonDerivedPropertiesMock = jest.mocked(addTrackJsonDerivedProperties);
const obfuscateFitPrivacyMock = jest.mocked(obfuscateFitPrivacy);
const countFitRecordMessagesMock = jest.mocked(countFitRecordMessages);
const downsampleFitRecordMessagesMock = jest.mocked(downsampleFitRecordMessages);
const parseFitBytesMock = jest.mocked(parseFitBytes);
const downsampleTrackActivityMock = jest.mocked(downsampleTrackActivity);
const trackActivityToTrackJsonMock = jest.mocked(trackActivityToTrackJson);
const trackJsonDataToTrackActivityMock = jest.mocked(trackJsonDataToTrackActivity);
const parseTrackJsonDataMock = jest.mocked(parseTrackJsonData);
const downsampleTrackJsonDataMock = jest.mocked(downsampleTrackJsonData);
const obfuscateTrackJsonPrivacyMock = jest.mocked(obfuscateTrackJsonPrivacy);
const compactTrackJsonDataMock = jest.mocked(compactTrackJsonData);
const countTrackJsonPositionedPointsMock = jest.mocked(countTrackJsonPositionedPoints);
const parseGpxTextMock = jest.mocked(parseGpxText);

beforeEach(() => {
  jest.clearAllMocks();
  addTrackJsonDerivedPropertiesMock.mockImplementation((data: unknown) => data);
  obfuscateTrackJsonPrivacyMock.mockImplementation((data: unknown) => data);
  countFitRecordMessagesMock.mockReturnValue(0);
  countTrackJsonPositionedPointsMock.mockReturnValue(0);
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
    points: Array.from({ length: 4000 }, () => ({ lat: 35, lon: 139 })),
  };
  const preview = { points: new Array(3000) };

  countFitRecordMessagesMock.mockReturnValue(4000);
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
    pointCount: 4000,
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

test("builds a GPX preview with uniform downsampling", async () => {
  const activity = {
    metadata: {
      startTime: 1_700_000_000,
      totalDistanceM: 20_000,
      totalElapsedTime: 3600,
    },
    points: Array.from({ length: 4000 }, () => ({ lat: 35, lon: 139 })),
  };
  const preview = { points: new Array(3000) };

  parseGpxTextMock.mockReturnValue(activity as never);
  downsampleTrackActivityMock.mockReturnValue(preview as never);
  trackActivityToTrackJsonMock.mockReturnValue('{"type":"FeatureCollection"}');

  await expect(makeGpxPreview("<gpx />")).resolves.toEqual({
    json: '{"type":"FeatureCollection"}',
    metadata: activity.metadata,
    pointCount: 4000,
  });
  expect(parseGpxTextMock).toHaveBeenCalledWith("<gpx />");
  expect(downsampleTrackActivityMock).toHaveBeenCalledWith(activity, {
    maxPoints: TRACK_UPLOAD_PREVIEW_MAX_POINTS,
    strategy: "uniform",
    preserveEndpoints: true,
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
  countTrackJsonPositionedPointsMock.mockReturnValue(4000);

  await expect(makeTrackJsonPreview(JSON.stringify(parsed))).resolves.toEqual({
    json: JSON.stringify(compact),
    metadata: activity.metadata,
    pointCount: 4000,
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
    pointCount: 0,
  });
  await expect(makeTrackUploadPreviewJson(file)).resolves.toBe(JSON.stringify(parsed));
  expect(parseTrackJsonDataMock).toHaveBeenCalledWith(text);
});

test("reads GPX and TRJ files for upload previews", async () => {
  const activity = { metadata: {}, points: [] };
  const data = { type: "FeatureCollection", features: [] };
  const bytes = (value: string) => new TextEncoder().encode(value).buffer;

  parseGpxTextMock.mockReturnValue(activity as never);
  parseTrackJsonDataMock.mockReturnValue(data);
  trackJsonDataToTrackActivityMock.mockReturnValue(activity as never);
  downsampleTrackActivityMock.mockReturnValue(activity as never);
  downsampleTrackJsonDataMock.mockReturnValue(data);
  compactTrackJsonDataMock.mockReturnValue(data);
  trackActivityToTrackJsonMock.mockReturnValue(JSON.stringify(data));

  await expect(
    makeTrackUploadPreview({
      name: "ride.gpx",
      arrayBuffer: jest.fn().mockResolvedValue(bytes("<gpx />")),
    }),
  ).resolves.toEqual({ json: JSON.stringify(data), metadata: {}, pointCount: 0 });
  await expect(
    makeTrackUploadPreview({
      name: "ride.trj",
      arrayBuffer: jest.fn().mockResolvedValue(bytes(JSON.stringify(data))),
    }),
  ).resolves.toEqual({ json: JSON.stringify(data), metadata: {}, pointCount: 0 });
});

test("rejects unsupported upload formats", async () => {
  const file = {
    name: "ride.tcx",
    arrayBuffer: jest.fn(),
  };

  await expect(makeTrackUploadPreview(file)).rejects.toThrow(
    "Only FIT, GPX, TRJ, and TRJGZ files are supported.",
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

test("obfuscates GPX coordinates before building the preview when enabled", async () => {
  const activity = {
    metadata: { totalDistanceM: 20_000 },
    points: [
      { lat: 35, lon: 139 },
      { lat: 35.1, lon: 139.1 },
    ],
  };
  const source = { type: "FeatureCollection", features: [] };
  const obfuscated = { ...source, obfuscated: true };
  const derived = { ...obfuscated, derived: true };
  const obfuscatedActivity = { metadata: activity.metadata, points: activity.points };
  const preview = { metadata: activity.metadata, points: activity.points };

  parseGpxTextMock.mockReturnValue(activity as never);
  trackActivityToTrackJsonMock
    .mockReturnValueOnce(JSON.stringify(source))
    .mockReturnValueOnce('{"type":"FeatureCollection","preview":true}');
  parseTrackJsonDataMock.mockReturnValue(source);
  obfuscateTrackJsonPrivacyMock.mockReturnValue(obfuscated);
  addTrackJsonDerivedPropertiesMock.mockReturnValue(derived);
  trackJsonDataToTrackActivityMock.mockReturnValue(obfuscatedActivity as never);
  downsampleTrackActivityMock.mockReturnValue(preview as never);

  await expect(
    makeGpxPreview("<gpx />", TRACK_UPLOAD_PREVIEW_MAX_POINTS, {
      enabled: true,
      startDistanceM: 1000,
      endDistanceM: 1200,
    }),
  ).resolves.toEqual({
    json: '{"type":"FeatureCollection","preview":true}',
    metadata: activity.metadata,
    pointCount: 2,
  });
  expect(obfuscateTrackJsonPrivacyMock).toHaveBeenCalledWith(source, {
    startDistanceM: 1000,
    endDistanceM: 1200,
  });
  expect(trackJsonDataToTrackActivityMock).toHaveBeenCalledWith(derived);
  expect(downsampleTrackActivityMock).toHaveBeenCalledWith(obfuscatedActivity, {
    maxPoints: TRACK_UPLOAD_PREVIEW_MAX_POINTS,
    strategy: "uniform",
    preserveEndpoints: true,
  });
});

test("obfuscates TRJ and TRJGZ coordinates in their previews when enabled", async () => {
  const source = { type: "FeatureCollection", features: [] };
  const obfuscated = { ...source, obfuscated: true };
  const derived = { ...obfuscated, derived: true };
  const preview = { ...derived, sampled: true };
  const finalPreview = { ...preview, final: true };
  const compact = { type: "FeatureCollection", compact: true };
  const activity = { metadata: { totalDistanceM: 10_000 } };
  const options = {
    enabled: true,
    startDistanceM: 500,
    endDistanceM: 600,
  };

  parseTrackJsonDataMock.mockReturnValue(source);
  countTrackJsonPositionedPointsMock.mockReturnValue(12_000);
  obfuscateTrackJsonPrivacyMock.mockReturnValue(obfuscated);
  addTrackJsonDerivedPropertiesMock
    .mockReturnValueOnce(derived)
    .mockReturnValueOnce(finalPreview)
    .mockReturnValueOnce(derived)
    .mockReturnValueOnce(finalPreview);
  trackJsonDataToTrackActivityMock.mockReturnValue(activity as never);
  downsampleTrackJsonDataMock.mockReturnValue(preview);
  compactTrackJsonDataMock.mockReturnValue(compact);

  await expect(makeTrackJsonPreview(JSON.stringify(source), 3000, options)).resolves.toEqual({
    json: JSON.stringify(compact),
    metadata: activity.metadata,
    pointCount: 12_000,
  });

  const compressed = gzipSync(Buffer.from(JSON.stringify(source), "utf8"));
  const bytes = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  );
  await expect(
    makeTrackUploadPreview(
      { name: "route.trjgz", arrayBuffer: jest.fn().mockResolvedValue(bytes) },
      3000,
      options,
    ),
  ).resolves.toEqual({
    json: JSON.stringify(compact),
    metadata: activity.metadata,
    pointCount: 12_000,
  });

  expect(obfuscateTrackJsonPrivacyMock).toHaveBeenCalledTimes(2);
  expect(obfuscateTrackJsonPrivacyMock).toHaveBeenNthCalledWith(1, source, {
    startDistanceM: 500,
    endDistanceM: 600,
  });
  expect(obfuscateTrackJsonPrivacyMock).toHaveBeenNthCalledWith(2, source, {
    startDistanceM: 500,
    endDistanceM: 600,
  });
});

test("uses a fixed 1000m default obfuscation distance", () => {
  expect(createTrackObfuscationDistances(100_000)).toEqual({
    startDistanceM: TRACK_OBFUSCATION_DEFAULT_DISTANCE_M,
    endDistanceM: TRACK_OBFUSCATION_DEFAULT_DISTANCE_M,
  });
});

test("caps default and edited obfuscation distances at five percent", () => {
  expect(createTrackObfuscationDistances(20_000)).toEqual({
    startDistanceM: 1000,
    endDistanceM: 1000,
  });
  expect(normalizeTrackObfuscationDistance(1400, 20_000)).toBe(1000);
  expect(normalizeTrackObfuscationDistance(-10, 20_000)).toBe(0);
});

test("calculates the upload downsampling point count", () => {
  expect(getTrackUploadDownsamplePointCount(TRACK_UPLOAD_POINT_LIMIT)).toBe(100_000);
  expect(getTrackUploadDownsamplePointCount(100_001)).toBe(50_001);
  expect(getTrackUploadDownsamplePointCount(120_000)).toBe(70_000);
  expect(getTrackUploadDownsamplePointCount(150_000)).toBe(100_000);
  expect(getTrackUploadDownsamplePointCount(250_000)).toBe(100_000);
});

test("prepares original and obfuscated FIT upload payloads", async () => {
  const originalBytes = new Uint8Array([1, 2, 3]);
  const outputBytes = new Uint8Array([4, 5, 6]);
  const file = new File([originalBytes], "ride.fit", {
    type: "application/octet-stream",
  });
  obfuscateFitPrivacyMock.mockReturnValue(outputBytes);

  await expect(
    prepareTrackUploadPayload(file, {
      enabled: false,
      startDistanceM: 1000,
      endDistanceM: 1000,
    }),
  ).resolves.toEqual({
    payload: file,
    filename: "ride.fit",
    contentType: "application/octet-stream",
  });

  const prepared = await prepareTrackUploadPayload(file, {
    enabled: true,
    startDistanceM: 1100,
    endDistanceM: 1200,
  });

  expect(prepared.filename).toBe("ride.fit");
  expect(prepared.contentType).toBe("application/octet-stream");
  expect(prepared.payload).toBeInstanceOf(Blob);
  expect(prepared.payload.size).toBe(outputBytes.byteLength);
  expect(obfuscateFitPrivacyMock).toHaveBeenCalledWith(expect.any(Uint8Array), {
    startDistanceM: 1100,
    endDistanceM: 1200,
  });
});

test("downsamples an oversized FIT upload while keeping FIT format", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "ride.fit", {
    type: "application/octet-stream",
  });
  const downsampled = new Uint8Array([4, 5]);
  countFitRecordMessagesMock.mockReturnValue(250_000);
  downsampleFitRecordMessagesMock.mockReturnValue(downsampled);

  const prepared = await prepareTrackUploadPayload(file);

  expect(downsampleFitRecordMessagesMock).toHaveBeenCalledWith(
    expect.any(Uint8Array),
    100_000,
  );
  expect(prepared.filename).toBe("ride.fit");
  expect(prepared.contentType).toBe("application/octet-stream");
  expect(Array.from(new Uint8Array(await prepared.payload.arrayBuffer()))).toEqual([4, 5]);
});

test("keeps FIT obfuscation when an oversized upload is downsampled", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "ride.fit", {
    type: "application/octet-stream",
  });
  const obfuscated = new Uint8Array([4, 5, 6]);
  const downsampled = new Uint8Array([7, 8]);
  countFitRecordMessagesMock.mockReturnValue(250_000);
  obfuscateFitPrivacyMock.mockReturnValue(obfuscated);
  downsampleFitRecordMessagesMock.mockReturnValue(downsampled);

  const prepared = await prepareTrackUploadPayload(file, {
    enabled: true,
    startDistanceM: 1100,
    endDistanceM: 1200,
  });

  expect(obfuscateFitPrivacyMock).toHaveBeenCalledWith(expect.any(Uint8Array), {
    startDistanceM: 1100,
    endDistanceM: 1200,
  });
  expect(downsampleFitRecordMessagesMock).toHaveBeenCalledWith(obfuscated, 100_000);
  expect(Array.from(new Uint8Array(await prepared.payload.arrayBuffer()))).toEqual([7, 8]);
});

test("keeps TRJGZ uploads unchanged", async () => {
  const text = '{"type":"FeatureCollection","features":[]}';
  const file = new File([gzipSync(Buffer.from(text))], "ride.trjgz", {
    type: "application/gzip",
  });
  const parsed = { type: "FeatureCollection", features: [] };
  parseTrackJsonDataMock.mockReturnValue(parsed);

  await expect(prepareTrackUploadPayload(file)).resolves.toEqual({
    payload: file,
    filename: "ride.trjgz",
    contentType: "application/gzip",
  });
  expect(parseTrackJsonDataMock).toHaveBeenCalledWith(text);
});

test("downsamples an oversized TRJGZ upload", async () => {
  const source = { type: "FeatureCollection", features: [] };
  const sampled = { type: "FeatureCollection", features: [], sampled: true };
  const compact = { type: "FeatureCollection", features: [], compact: true };
  const file = new File([gzipSync(Buffer.from(JSON.stringify(source)))], "ride.trjgz", {
    type: "application/gzip",
  });
  parseTrackJsonDataMock.mockReturnValue(source);
  countTrackJsonPositionedPointsMock
    .mockReturnValueOnce(100_001)
    .mockReturnValueOnce(50_001);
  downsampleTrackJsonDataMock.mockReturnValue(sampled);
  compactTrackJsonDataMock.mockReturnValue(compact);

  const prepared = await prepareTrackUploadPayload(file);

  expect(downsampleTrackJsonDataMock).toHaveBeenCalledWith(source, {
    maxPoints: 50_001,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  expect(gunzipSync(Buffer.from(await prepared.payload.arrayBuffer())).toString()).toBe(
    JSON.stringify(compact),
  );
});

test("obfuscates and downsamples an oversized TRJGZ upload", async () => {
  const source = { type: "FeatureCollection", features: [] };
  const obfuscated = { ...source, obfuscated: true };
  const sampled = { ...obfuscated, sampled: true };
  const derived = { ...sampled, derived: true };
  const compact = { type: "FeatureCollection", compact: true };
  const file = new File([gzipSync(Buffer.from(JSON.stringify(source)))], "ride.trjgz", {
    type: "application/gzip",
  });
  parseTrackJsonDataMock.mockReturnValue(source);
  countTrackJsonPositionedPointsMock
    .mockReturnValueOnce(250_000)
    .mockReturnValueOnce(100_000);
  obfuscateTrackJsonPrivacyMock.mockReturnValue(obfuscated);
  downsampleTrackJsonDataMock.mockReturnValue(sampled);
  addTrackJsonDerivedPropertiesMock.mockReturnValue(derived);
  compactTrackJsonDataMock.mockReturnValue(compact);

  const prepared = await prepareTrackUploadPayload(file, {
    enabled: true,
    startDistanceM: 1000,
    endDistanceM: 1200,
  });

  expect(obfuscateTrackJsonPrivacyMock).toHaveBeenCalledWith(source, {
    startDistanceM: 1000,
    endDistanceM: 1200,
  });
  expect(downsampleTrackJsonDataMock).toHaveBeenCalledWith(obfuscated, {
    maxPoints: 100_000,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  expect(addTrackJsonDerivedPropertiesMock).toHaveBeenCalledWith(sampled);
  expect(obfuscateTrackJsonPrivacyMock.mock.invocationCallOrder[0]).toBeLessThan(
    downsampleTrackJsonDataMock.mock.invocationCallOrder[0],
  );
  expect(gunzipSync(Buffer.from(await prepared.payload.arrayBuffer())).toString()).toBe(
    JSON.stringify(compact),
  );
});

test("obfuscates and downsamples an oversized GPX upload", async () => {
  const activity = {
    metadata: {},
    points: Array.from({ length: 100_001 }, (_, index) => ({
      lat: 35 + index / 1_000_000,
      lon: 139 + index / 1_000_000,
    })),
  };
  const source = { type: "FeatureCollection", features: [] };
  const obfuscated = { ...source, obfuscated: true };
  const sampled = { ...obfuscated, sampled: true };
  const derived = { ...sampled, derived: true };
  const compact = { type: "FeatureCollection", compact: true };

  parseGpxTextMock.mockReturnValue(activity as never);
  trackActivityToTrackJsonMock.mockReturnValue(JSON.stringify(source));
  parseTrackJsonDataMock.mockReturnValue(source);
  obfuscateTrackJsonPrivacyMock.mockReturnValue(obfuscated);
  downsampleTrackJsonDataMock.mockReturnValue(sampled);
  countTrackJsonPositionedPointsMock.mockReturnValue(50_001);
  addTrackJsonDerivedPropertiesMock.mockReturnValue(derived);
  compactTrackJsonDataMock.mockReturnValue(compact);

  const prepared = await prepareTrackUploadPayload(
    new File(["<gpx />"], "ride.gpx", { type: "application/gpx+xml" }),
    {
      enabled: true,
      startDistanceM: 900,
      endDistanceM: 1100,
    },
  );

  expect(obfuscateTrackJsonPrivacyMock).toHaveBeenCalledWith(source, {
    startDistanceM: 900,
    endDistanceM: 1100,
  });
  expect(downsampleTrackJsonDataMock).toHaveBeenCalledWith(obfuscated, {
    maxPoints: 50_001,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  expect(gunzipSync(Buffer.from(await prepared.payload.arrayBuffer())).toString()).toBe(
    JSON.stringify(compact),
  );
});

test("obfuscates a TRJ upload without requiring downsampling", async () => {
  const source = { type: "FeatureCollection", features: [] };
  const obfuscated = { ...source, obfuscated: true };
  const derived = { ...obfuscated, derived: true };
  const compact = { type: "FeatureCollection", compact: true };

  parseTrackJsonDataMock.mockReturnValue(source);
  countTrackJsonPositionedPointsMock.mockReturnValue(80_000);
  obfuscateTrackJsonPrivacyMock.mockReturnValue(obfuscated);
  addTrackJsonDerivedPropertiesMock.mockReturnValue(derived);
  compactTrackJsonDataMock.mockReturnValue(compact);

  const prepared = await prepareTrackUploadPayload(
    new File([JSON.stringify(source)], "route.trj", { type: "application/json" }),
    {
      enabled: true,
      startDistanceM: 500,
      endDistanceM: 700,
    },
  );

  expect(obfuscateTrackJsonPrivacyMock).toHaveBeenCalledWith(source, {
    startDistanceM: 500,
    endDistanceM: 700,
  });
  expect(downsampleTrackJsonDataMock).not.toHaveBeenCalled();
  expect(addTrackJsonDerivedPropertiesMock).toHaveBeenCalledWith(obfuscated);
  expect(gunzipSync(Buffer.from(await prepared.payload.arrayBuffer())).toString()).toBe(
    JSON.stringify(compact),
  );
});

test("converts GPX and TRJ uploads to gzipped TrackJSON", async () => {
  const activity = { metadata: {}, points: [] };
  const data = { type: "FeatureCollection", features: [] };
  const compact = { type: "FeatureCollection", features: [], compact: true };

  parseGpxTextMock.mockReturnValue(activity as never);
  trackActivityToTrackJsonMock.mockReturnValue(JSON.stringify(data));
  parseTrackJsonDataMock.mockReturnValue(data);
  compactTrackJsonDataMock.mockReturnValue(compact);

  const gpx = await prepareTrackUploadPayload(
    new File(["<gpx />"], "ride.gpx", { type: "application/gpx+xml" }),
  );
  const trj = await prepareTrackUploadPayload(
    new File([JSON.stringify(data)], "route.trj", { type: "application/json" }),
  );

  expect(gpx.filename).toBe("ride.trjgz");
  expect(gpx.contentType).toBe("application/gzip");
  expect(gunzipSync(Buffer.from(await gpx.payload.arrayBuffer())).toString()).toBe(
    JSON.stringify(data),
  );
  expect(trj.filename).toBe("route.trjgz");
  expect(trj.contentType).toBe("application/gzip");
  expect(gunzipSync(Buffer.from(await trj.payload.arrayBuffer())).toString()).toBe(
    JSON.stringify(compact),
  );
});
