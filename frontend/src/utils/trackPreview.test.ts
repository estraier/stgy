import { gunzipSync, gzipSync } from "zlib";
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
  TRACK_OBFUSCATION_DEFAULT_DISTANCE_M,
  TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  createTrackObfuscationDistances,
  formatTrackPreviewDistance,
  formatTrackPreviewElapsedTime,
  formatTrackPreviewStartTime,
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

jest.mock("stgy-track/gpx", () => ({
  parseGpxText: jest.fn(),
}));

const obfuscateFitPrivacyMock = jest.mocked(obfuscateFitPrivacy);
const parseFitBytesMock = jest.mocked(parseFitBytes);
const downsampleTrackActivityMock = jest.mocked(downsampleTrackActivity);
const trackActivityToTrackJsonMock = jest.mocked(trackActivityToTrackJson);
const trackJsonDataToTrackActivityMock = jest.mocked(trackJsonDataToTrackActivity);
const parseTrackJsonDataMock = jest.mocked(parseTrackJsonData);
const downsampleTrackJsonDataMock = jest.mocked(downsampleTrackJsonData);
const compactTrackJsonDataMock = jest.mocked(compactTrackJsonData);
const parseGpxTextMock = jest.mocked(parseGpxText);

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

test("builds a GPX preview with uniform downsampling", async () => {
  const activity = {
    metadata: {
      startTime: 1_700_000_000,
      totalDistanceM: 20_000,
      totalElapsedTime: 3600,
    },
    points: new Array(4000),
  };
  const preview = { points: new Array(3000) };

  parseGpxTextMock.mockReturnValue(activity as never);
  downsampleTrackActivityMock.mockReturnValue(preview as never);
  trackActivityToTrackJsonMock.mockReturnValue('{"type":"FeatureCollection"}');

  await expect(makeGpxPreview("<gpx />")).resolves.toEqual({
    json: '{"type":"FeatureCollection"}',
    metadata: activity.metadata,
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
  ).resolves.toEqual({ json: JSON.stringify(data), metadata: {} });
  await expect(
    makeTrackUploadPreview({
      name: "ride.trj",
      arrayBuffer: jest.fn().mockResolvedValue(bytes(JSON.stringify(data))),
    }),
  ).resolves.toEqual({ json: JSON.stringify(data), metadata: {} });
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
  expect(obfuscateFitPrivacyMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
    startDistanceM: 1100,
    endDistanceM: 1200,
  });
});

test("keeps TRJGZ uploads unchanged", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "ride.trjgz", {
    type: "application/gzip",
  });

  await expect(prepareTrackUploadPayload(file)).resolves.toEqual({
    payload: file,
    filename: "ride.trjgz",
    contentType: "application/gzip",
  });
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
