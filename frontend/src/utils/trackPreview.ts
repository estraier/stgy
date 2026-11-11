import type { TrackActivity, TrackActivityMetadata } from "stgy-track/activity";
import { getTrackFileKind, getTrackUploadContentType, getTrackUploadFilename } from "./tracks";

export const TRACK_UPLOAD_PREVIEW_MAX_POINTS = 3000;
export const TRACK_UPLOAD_POINT_LIMIT = 100000;
export const TRACK_UPLOAD_DOWNSAMPLE_REDUCTION_POINTS = 50000;
export const TRACK_OBFUSCATION_DEFAULT_DISTANCE_M = 1000;
export const TRACK_OBFUSCATION_MAX_ROUTE_RATIO = 0.05;

export type TrackUploadPreviewMetadata = Pick<
  TrackActivityMetadata,
  "startTime" | "localTimeOffsetSeconds" | "totalDistanceM" | "totalElapsedTime"
>;

export type TrackUploadPreview = {
  json: string;
  metadata: TrackUploadPreviewMetadata;
  pointCount: number;
};

export type TrackUploadObfuscationOptions = {
  enabled: boolean;
  startDistanceM: number;
  endDistanceM: number;
};

export type TrackUploadCorrectionOptions = {
  coordinates: boolean;
  altitudes: boolean;
  /** Cancels outstanding elevation-tile requests when a preview is superseded. */
  signal?: AbortSignal;
};

function hasCorrections(options?: TrackUploadCorrectionOptions): boolean {
  return Boolean(options?.coordinates || options?.altitudes);
}

export type TrackObfuscationDistances = {
  startDistanceM: number;
  endDistanceM: number;
};

export type PreparedTrackUpload = {
  payload: Blob | File;
  filename: string;
  contentType: string;
};

type TrackPreviewFile = Pick<File, "name" | "arrayBuffer">;

export async function makeTrackUploadPreview(
  file: TrackPreviewFile,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  obfuscation?: TrackUploadObfuscationOptions,
  corrections?: TrackUploadCorrectionOptions,
): Promise<TrackUploadPreview> {
  const kind = getTrackFileKind(file.name);
  if (kind === "FIT") {
    return makeFitPreview(await file.arrayBuffer(), maxPoints, obfuscation, corrections);
  }
  if (kind === "GPX") {
    return makeGpxPreview(decodeUtf8(await file.arrayBuffer()), maxPoints, obfuscation, corrections);
  }
  if (kind === "TRJ") {
    return makeTrackJsonPreview(decodeUtf8(await file.arrayBuffer()), maxPoints, obfuscation, corrections);
  }
  if (kind === "TRJGZ") {
    const text = await decompressGzipText(await file.arrayBuffer());
    return makeTrackJsonPreview(text, maxPoints, obfuscation, corrections);
  }
  throw new Error("Only FIT, GPX, TRJ, and TRJGZ files are supported.");
}

export async function makeTrackUploadPreviewJson(
  file: TrackPreviewFile,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<string> {
  return (await makeTrackUploadPreview(file, maxPoints)).json;
}

export async function makeFitPreview(
  bytes: ArrayBuffer,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  obfuscation?: TrackUploadObfuscationOptions,
  corrections?: TrackUploadCorrectionOptions,
): Promise<TrackUploadPreview> {
  const [fit, trackjson] = await Promise.all([
    import("stgy-track/fit"),
    import("stgy-track/trackjson"),
  ]);
  const sourceBytes = hasCorrections(corrections)
    ? await transformFitForUpload(fit, bytes, obfuscation, corrections)
    : obfuscation?.enabled
      ? fit.obfuscateFitPrivacy(bytes, {
          startDistanceM: obfuscation.startDistanceM,
          endDistanceM: obfuscation.endDistanceM,
        })
      : bytes;
  const activity = fit.parseFitBytes(sourceBytes);
  const pointCount = fit.countFitRecordMessages(sourceBytes);
  const fullTrackJson = trackjson.parseTrackJsonData(
    fit.trackActivityToTrackJson(activity, { pretty: false }),
  );
  let preview = trackjson.downsampleTrackJsonData(fullTrackJson, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  if (trackjson.countTrackJsonPositionedPoints(preview) > maxPoints) {
    const previewActivity = fit.downsampleTrackActivity(activity, {
      maxPoints,
      strategy: "uniform",
      preserveEndpoints: true,
    });
    preview = trackjson.parseTrackJsonData(
      fit.trackActivityToTrackJson(previewActivity, { pretty: false }),
    );
  }
  return {
    json: JSON.stringify(preview),
    metadata: pickPreviewMetadata(activity.metadata),
    pointCount,
  };
}

export async function makeFitPreviewJson(
  bytes: ArrayBuffer,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<string> {
  return (await makeFitPreview(bytes, maxPoints)).json;
}

export async function makeGpxPreview(
  text: string,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  obfuscation?: TrackUploadObfuscationOptions,
  corrections?: TrackUploadCorrectionOptions,
): Promise<TrackUploadPreview> {
  const [fit, gpx] = await Promise.all([import("stgy-track/fit"), import("stgy-track/gpx")]);
  const activity = gpx.parseGpxText(text);
  const pointCount = countTrackActivityPositionedPoints(activity);
  let previewActivity = activity;
  if (hasCorrections(corrections)) {
    previewActivity = await transformActivityForUpload(fit, activity, obfuscation, corrections);
  } else if (obfuscation?.enabled) {
    const trackjson = await import("stgy-track/trackjson");
    const data = trackjson.parseTrackJsonData(
      fit.trackActivityToTrackJson(activity, { pretty: false }),
    );
    const obfuscated = fit.addTrackJsonDerivedProperties(
      trackjson.obfuscateTrackJsonPrivacy(data, {
        startDistanceM: obfuscation.startDistanceM,
        endDistanceM: obfuscation.endDistanceM,
      }),
    );
    previewActivity = fit.trackJsonDataToTrackActivity(obfuscated);
  }
  const preview = fit.downsampleTrackActivity(previewActivity, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  return {
    json: fit.trackActivityToTrackJson(preview, {
      pretty: false,
    }),
    metadata: pickPreviewMetadata(activity.metadata),
    pointCount,
  };
}

export async function makeTrackJsonPreview(
  text: string,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  obfuscation?: TrackUploadObfuscationOptions,
  corrections?: TrackUploadCorrectionOptions,
): Promise<TrackUploadPreview> {
  const [fit, trackjson] = await Promise.all([
    import("stgy-track/fit"),
    import("stgy-track/trackjson"),
  ]);
  const data = trackjson.parseTrackJsonData(text);
  const pointCount = trackjson.countTrackJsonPositionedPoints(data);
  const source = hasCorrections(corrections)
    ? await transformTrackJsonForUpload(fit, trackjson, data, obfuscation, corrections)
    : obfuscation?.enabled
      ? fit.addTrackJsonDerivedProperties(
          trackjson.obfuscateTrackJsonPrivacy(data, {
            startDistanceM: obfuscation.startDistanceM,
            endDistanceM: obfuscation.endDistanceM,
          }),
        )
      : data;
  const activity = fit.trackJsonDataToTrackActivity(source);
  const preview = trackjson.downsampleTrackJsonData(source, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  const output = obfuscation?.enabled || hasCorrections(corrections)
    ? fit.addTrackJsonDerivedProperties(preview)
    : preview;
  return {
    json: JSON.stringify(trackjson.compactTrackJsonData(output)),
    metadata: pickPreviewMetadata(activity.metadata),
    pointCount,
  };
}

export async function makeTrackJsonPreviewJson(
  text: string,
  maxPoints = TRACK_UPLOAD_PREVIEW_MAX_POINTS,
): Promise<string> {
  return (await makeTrackJsonPreview(text, maxPoints)).json;
}

export function createTrackObfuscationDistances(
  totalDistanceM: number | undefined,
): TrackObfuscationDistances {
  const defaultDistanceM = normalizeTrackObfuscationDistance(
    TRACK_OBFUSCATION_DEFAULT_DISTANCE_M,
    totalDistanceM,
  );
  return {
    startDistanceM: defaultDistanceM,
    endDistanceM: defaultDistanceM,
  };
}

export function getTrackObfuscationMaxDistance(
  totalDistanceM: number | undefined,
): number | undefined {
  if (!isFiniteNumber(totalDistanceM) || totalDistanceM < 0) return undefined;
  return Math.max(0, Math.floor(totalDistanceM * TRACK_OBFUSCATION_MAX_ROUTE_RATIO));
}

export function normalizeTrackObfuscationDistance(
  value: number,
  totalDistanceM: number | undefined,
): number {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const maxDistanceM = getTrackObfuscationMaxDistance(totalDistanceM);
  return maxDistanceM === undefined ? normalized : Math.min(normalized, maxDistanceM);
}

export function getTrackUploadDownsamplePointCount(pointCount: number): number {
  const normalized = Number.isFinite(pointCount) ? Math.max(0, Math.floor(pointCount)) : 0;
  if (normalized <= TRACK_UPLOAD_POINT_LIMIT) {
    return normalized;
  }
  return Math.min(
    normalized - TRACK_UPLOAD_DOWNSAMPLE_REDUCTION_POINTS,
    TRACK_UPLOAD_POINT_LIMIT,
  );
}

export async function prepareTrackUploadPayload(
  file: File,
  obfuscation?: TrackUploadObfuscationOptions,
  corrections?: TrackUploadCorrectionOptions,
): Promise<PreparedTrackUpload> {
  const kind = getTrackFileKind(file.name);
  if (!kind) {
    throw new Error("Only FIT, GPX, TRJ, and TRJGZ files are supported.");
  }

  const filename = getTrackUploadFilename(file.name);
  const contentType = getTrackUploadContentType(filename);

  if (kind === "FIT") {
    const fit = await import("stgy-track/fit");
    const input = await file.arrayBuffer();
    const sourcePointCount = fit.countFitRecordMessages(input);
    const uploadPointCount = getTrackUploadDownsamplePointCount(sourcePointCount);
    if (!obfuscation?.enabled && !hasCorrections(corrections) &&
        uploadPointCount === sourcePointCount) {
      return { payload: file, filename, contentType };
    }

    let output: Uint8Array = new Uint8Array(input);
    if (hasCorrections(corrections)) {
      output = await transformFitForUpload(fit, input, obfuscation, corrections);
    }
    if (obfuscation?.enabled && !hasCorrections(corrections)) {
      output = fit.obfuscateFitPrivacy(output, {
        startDistanceM: obfuscation.startDistanceM,
        endDistanceM: obfuscation.endDistanceM,
      });
    }
    if (uploadPointCount < sourcePointCount) {
      output = fit.downsampleFitRecordMessages(output, uploadPointCount);
    }
    return {
      payload: new Blob([copyUint8ArrayToArrayBuffer(output)], { type: contentType }),
      filename,
      contentType,
    };
  }

  if (kind === "TRJGZ") {
    const sourceText = await decompressGzipText(await file.arrayBuffer());
    const [fit, trackjson] = await Promise.all([
      import("stgy-track/fit"),
      import("stgy-track/trackjson"),
    ]);
    const parsed = trackjson.parseTrackJsonData(sourceText);
    const sourcePointCount = trackjson.countTrackJsonPositionedPoints(parsed);
    const uploadPointCount = getTrackUploadDownsamplePointCount(sourcePointCount);
    if (!obfuscation?.enabled && !hasCorrections(corrections) &&
        uploadPointCount === sourcePointCount) {
      return { payload: file, filename, contentType };
    }
    const corrected = hasCorrections(corrections)
      ? await transformTrackJsonForUpload(fit, trackjson, parsed, obfuscation, corrections)
      : parsed;
    const correctedCount = hasCorrections(corrections)
      ? trackjson.countTrackJsonPositionedPoints(corrected) : sourcePointCount;
    const correctedLimit = hasCorrections(corrections)
      ? getTrackUploadDownsamplePointCount(correctedCount) : uploadPointCount;
    const output = prepareTrackJsonUploadData(
      fit,
      trackjson,
      corrected,
      correctedCount,
      correctedLimit,
      hasCorrections(corrections) ? undefined : obfuscation,
    );
    return {
      payload: await compressGzipText(
        JSON.stringify(trackjson.compactTrackJsonData(output)),
      ),
      filename,
      contentType,
    };
  }

  const sourceText = decodeUtf8(await file.arrayBuffer());
  let trackJson: string;
  if (kind === "GPX") {
    const [fit, gpx] = await Promise.all([
      import("stgy-track/fit"),
      import("stgy-track/gpx"),
    ]);
    const activity = gpx.parseGpxText(sourceText);
    const sourcePointCount = countTrackActivityPositionedPoints(activity);
    const uploadPointCount = getTrackUploadDownsamplePointCount(sourcePointCount);
    if (hasCorrections(corrections)) {
      const processed = await transformActivityForUpload(fit, activity, obfuscation, corrections);
      const processedCount = countTrackActivityPositionedPoints(processed);
      const processedLimit = getTrackUploadDownsamplePointCount(processedCount);
      const uploadActivity = processedLimit < processedCount
        ? downsampleTrackActivityToPositionedPoints(fit, processed, processedLimit)
        : processed;
      trackJson = fit.trackActivityToTrackJson(uploadActivity, { pretty: false });
    } else if (!obfuscation?.enabled) {
      const uploadActivity =
        uploadPointCount < sourcePointCount
          ? downsampleTrackActivityToPositionedPoints(fit, activity, uploadPointCount)
          : activity;
      trackJson = fit.trackActivityToTrackJson(uploadActivity, { pretty: false });
    } else {
      const trackjson = await import("stgy-track/trackjson");
      const parsed = trackjson.parseTrackJsonData(
        fit.trackActivityToTrackJson(activity, { pretty: false }),
      );
      const output = prepareTrackJsonUploadData(
        fit,
        trackjson,
        parsed,
        sourcePointCount,
        uploadPointCount,
        obfuscation,
      );
      trackJson = JSON.stringify(trackjson.compactTrackJsonData(output));
    }
  } else {
    const [fit, trackjson] = await Promise.all([
      import("stgy-track/fit"),
      import("stgy-track/trackjson"),
    ]);
    const parsed = trackjson.parseTrackJsonData(sourceText);
    const sourcePointCount = trackjson.countTrackJsonPositionedPoints(parsed);
    const uploadPointCount = getTrackUploadDownsamplePointCount(sourcePointCount);
    const corrected = hasCorrections(corrections)
      ? await transformTrackJsonForUpload(fit, trackjson, parsed, obfuscation, corrections)
      : parsed;
    const correctedCount = hasCorrections(corrections)
      ? trackjson.countTrackJsonPositionedPoints(corrected) : sourcePointCount;
    const correctedLimit = hasCorrections(corrections)
      ? getTrackUploadDownsamplePointCount(correctedCount) : uploadPointCount;
    const output = prepareTrackJsonUploadData(
      fit,
      trackjson,
      corrected,
      correctedCount,
      correctedLimit,
      hasCorrections(corrections) ? undefined : obfuscation,
    );
    trackJson = JSON.stringify(trackjson.compactTrackJsonData(output));
  }

  return {
    payload: await compressGzipText(trackJson),
    filename,
    contentType,
  };
}

async function transformFitForUpload(
  fit: typeof import("stgy-track/fit"),
  bytes: ArrayBuffer | Uint8Array,
  obfuscation?: TrackUploadObfuscationOptions,
  corrections?: TrackUploadCorrectionOptions,
): Promise<Uint8Array> {
  let output: Uint8Array = bytes instanceof Uint8Array
    ? new Uint8Array(bytes) : new Uint8Array(bytes.slice(0));
  if (corrections?.coordinates) {
    const { correctTrackActivityCoordinates } = await import("stgy-track/coordinate-correction");
    const original = fit.parseFitBytes(output);
    const result = correctTrackActivityCoordinates(original);
    if (result.report.pointsCorrected > 0) {
      output = fit.patchFitRecordMeasurements(output, original, result.activity, { coordinates: true });
    }
  }
  if (obfuscation?.enabled) {
    output = fit.obfuscateFitPrivacy(output, {
      startDistanceM: obfuscation.startDistanceM,
      endDistanceM: obfuscation.endDistanceM,
    });
  }
  if (corrections?.altitudes) {
    const { correctTrackActivityAltitudes } = await import("stgy-track/altitude-correction");
    const original = fit.parseFitBytes(output);
    const result = await correctTrackActivityAltitudes(original, { signal: corrections.signal });
    if (result.report.pointsCorrected > 0) {
      output = fit.patchFitRecordMeasurements(output, original, result.activity, { altitudes: true });
    }
  }
  return output;
}

async function transformActivityForUpload(
  fit: typeof import("stgy-track/fit"),
  activity: TrackActivity,
  obfuscation?: TrackUploadObfuscationOptions,
  corrections?: TrackUploadCorrectionOptions,
): Promise<TrackActivity> {
  let output = activity;
  if (corrections?.coordinates) {
    const { correctTrackActivityCoordinates } = await import("stgy-track/coordinate-correction");
    output = correctTrackActivityCoordinates(output).activity;
  }
  if (obfuscation?.enabled) {
    const trackjson = await import("stgy-track/trackjson");
    const data = trackjson.parseTrackJsonData(fit.trackActivityToTrackJson(output, { pretty: false }));
    output = fit.trackJsonDataToTrackActivity(fit.addTrackJsonDerivedProperties(
      trackjson.obfuscateTrackJsonPrivacy(data, {
        startDistanceM: obfuscation.startDistanceM,
        endDistanceM: obfuscation.endDistanceM,
      }),
    ));
  }
  if (corrections?.altitudes) {
    const { correctTrackActivityAltitudes } = await import("stgy-track/altitude-correction");
    output = (await correctTrackActivityAltitudes(output, { signal: corrections.signal })).activity;
  }
  return output;
}

/** Replace just corrected series, preserving custom properties and POI features. */
function patchTrackJsonMeasurements(
  data: unknown,
  before: TrackActivity,
  after: TrackActivity,
): unknown {
  if (!isRecord(data) || before.points.length !== after.points.length) {
    throw new Error("Cannot safely patch corrected TrackJSON points.");
  }
  const features: unknown[] = data.type === "FeatureCollection" && Array.isArray(data.features)
    ? data.features : [data];
  let offset = 0;
  let previousFeatureHadPoints = false;
  const patched = features.map((feature): unknown => {
    if (!isRecord(feature) || !isRecord(feature.geometry) ||
        feature.geometry.type !== "LineString" || !Array.isArray(feature.geometry.coordinates)) {
      return feature;
    }
    const sourceCoordinates = feature.geometry.coordinates as unknown[];
    if (sourceCoordinates.length > 0 && previousFeatureHadPoints) offset++; // segment separator
    if (sourceCoordinates.length > 0) previousFeatureHadPoints = true;
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const coordinateProperties = isRecord(properties.coordinateProperties) ? properties.coordinateProperties : {};
    const oldAltitudes = Array.isArray(coordinateProperties.altitudes)
      ? coordinateProperties.altitudes as unknown[] : undefined;
    let changed = false;
    const altitudes = oldAltitudes ? [...oldAltitudes] : undefined;
    const coordinates = sourceCoordinates.map((coord, index) => {
      const sourcePoint = before.points[offset++];
      const targetPoint = after.points[offset - 1];
      if (!sourcePoint || !targetPoint || !Array.isArray(coord)) {
        throw new Error("Cannot safely patch TrackJSON: point alignment mismatch.");
      }
      const positionChanged = sourcePoint.lat !== targetPoint.lat || sourcePoint.lon !== targetPoint.lon;
      const altitudeChanged = sourcePoint.altitudeM !== targetPoint.altitudeM;
      if (!positionChanged && !altitudeChanged) return coord;
      const next = [...coord];
      if (positionChanged) {
        if (!isFiniteNumber(targetPoint.lat) || !isFiniteNumber(targetPoint.lon)) {
          throw new Error("Cannot safely patch TrackJSON: invalid corrected coordinate.");
        }
        next[0] = targetPoint.lon;
        next[1] = targetPoint.lat;
      }
      if (altitudeChanged && isFiniteNumber(targetPoint.altitudeM)) {
        if (next.length > 2) next[2] = targetPoint.altitudeM;
        if (altitudes) altitudes[index] = targetPoint.altitudeM;
        if (next.length <= 2 && !altitudes) next[2] = targetPoint.altitudeM;
      }
      changed = true;
      return next;
    });
    if (!changed) return feature;
    return {
      ...feature,
      geometry: { ...feature.geometry, coordinates },
      ...(altitudes ? {
        properties: { ...properties, coordinateProperties: { ...coordinateProperties, altitudes } },
      } : {}),
    };
  });
  if (offset !== before.points.length) {
    throw new Error("Cannot safely patch TrackJSON: decoded point count differs from its geometry.");
  }
  const metadataChanged = before.metadata.coordinateCorrection !== after.metadata.coordinateCorrection ||
    before.metadata.altitudeCorrection !== after.metadata.altitudeCorrection ||
    before.metadata.ascentM !== after.metadata.ascentM ||
    before.metadata.descentM !== after.metadata.descentM;
  if (metadataChanged) {
    const applyMetadata = (value: Record<string, unknown>): Record<string, unknown> => {
      const metadata = { ...value };
      if (after.metadata.coordinateCorrection) {
        metadata.coordinateCorrection = after.metadata.coordinateCorrection;
      }
      if (after.metadata.altitudeCorrection) {
        metadata.altitudeCorrection = after.metadata.altitudeCorrection;
      }
      if (isFiniteNumber(after.metadata.ascentM)) metadata.ascentM = after.metadata.ascentM;
      else if (before.metadata.ascentM !== after.metadata.ascentM) delete metadata.ascentM;
      if (isFiniteNumber(after.metadata.descentM)) metadata.descentM = after.metadata.descentM;
      else if (before.metadata.descentM !== after.metadata.descentM) delete metadata.descentM;
      return metadata;
    };
    for (let i = 0; i < patched.length; i++) {
      const feature = patched[i];
      if (!isRecord(feature) || !isRecord(feature.geometry) ||
          feature.geometry.type !== "LineString") continue;
      const properties = isRecord(feature.properties) ? feature.properties : {};
      const existing = isRecord(properties.metadata) ? properties.metadata : {};
      patched[i] = { ...feature,
        properties: { ...properties, metadata: applyMetadata(existing) },
      };
    }
  }
  if (data.type === "FeatureCollection") {
    const rootMetadata = isRecord(data.metadata) && metadataChanged
      ? applyRootMetadata(data.metadata, after) : data.metadata;
    return { ...data, features: patched,
      ...(rootMetadata !== undefined ? { metadata: rootMetadata } : {}),
    };
  }
  return patched[0];
}

function applyRootMetadata(
  metadata: Record<string, unknown>,
  activity: TrackActivity,
): Record<string, unknown> {
  return {
    ...metadata,
    ...(activity.metadata.coordinateCorrection
      ? { coordinateCorrection: activity.metadata.coordinateCorrection } : {}),
    ...(activity.metadata.altitudeCorrection
      ? { altitudeCorrection: activity.metadata.altitudeCorrection } : {}),
    ...(isFiniteNumber(activity.metadata.ascentM) ? { ascentM: activity.metadata.ascentM } : {}),
    ...(isFiniteNumber(activity.metadata.descentM) ? { descentM: activity.metadata.descentM } : {}),
  };
}

async function transformTrackJsonForUpload(
  fit: typeof import("stgy-track/fit"),
  trackjson: typeof import("stgy-track/trackjson"),
  input: unknown,
  obfuscation?: TrackUploadObfuscationOptions,
  corrections?: TrackUploadCorrectionOptions,
): Promise<unknown> {
  let output = input;
  if (corrections?.coordinates) {
    const { correctTrackActivityCoordinates } = await import("stgy-track/coordinate-correction");
    const original = fit.trackJsonDataToTrackActivity(output);
    const result = correctTrackActivityCoordinates(original);
    if (result.report.pointsCorrected > 0) {
      output = patchTrackJsonMeasurements(output, original, result.activity);
      output = fit.addTrackJsonDerivedProperties(output);
    }
  }
  if (obfuscation?.enabled) {
    output = fit.addTrackJsonDerivedProperties(trackjson.obfuscateTrackJsonPrivacy(output, {
      startDistanceM: obfuscation.startDistanceM,
      endDistanceM: obfuscation.endDistanceM,
    }));
  }
  if (corrections?.altitudes) {
    const { correctTrackActivityAltitudes } = await import("stgy-track/altitude-correction");
    const original = fit.trackJsonDataToTrackActivity(output);
    const result = await correctTrackActivityAltitudes(original, { signal: corrections.signal });
    if (result.report.pointsCorrected > 0) {
      output = patchTrackJsonMeasurements(output, original, result.activity);
      output = fit.addTrackJsonDerivedProperties(output);
    }
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type TrackFitModule = typeof import("stgy-track/fit");
type TrackJsonModule = typeof import("stgy-track/trackjson");

function prepareTrackJsonUploadData(
  fit: TrackFitModule,
  trackjson: TrackJsonModule,
  data: unknown,
  sourcePointCount: number,
  uploadPointCount: number,
  obfuscation?: TrackUploadObfuscationOptions,
): unknown {
  let output = data;

  if (obfuscation?.enabled) {
    output = trackjson.obfuscateTrackJsonPrivacy(output, {
      startDistanceM: obfuscation.startDistanceM,
      endDistanceM: obfuscation.endDistanceM,
    });
  }

  if (uploadPointCount < sourcePointCount) {
    output = downsampleTrackJsonToPositionedPoints(
      fit,
      trackjson,
      output,
      uploadPointCount,
    );
  }

  return obfuscation?.enabled ? fit.addTrackJsonDerivedProperties(output) : output;
}

function downsampleTrackJsonToPositionedPoints(
  fit: TrackFitModule,
  trackjson: TrackJsonModule,
  data: unknown,
  maxPoints: number,
): unknown {
  const directlyDownsampled = trackjson.downsampleTrackJsonData(data, {
    maxPoints,
    strategy: "uniform",
    preserveEndpoints: true,
  });
  if (trackjson.countTrackJsonPositionedPoints(directlyDownsampled) <= maxPoints) {
    return directlyDownsampled;
  }

  const activity = fit.trackJsonDataToTrackActivity(data);
  const downsampled = downsampleTrackActivityToPositionedPoints(fit, activity, maxPoints);
  return trackjson.parseTrackJsonData(
    fit.trackActivityToTrackJson(downsampled, { pretty: false }),
  );
}

function downsampleTrackActivityToPositionedPoints(
  fit: TrackFitModule,
  activity: TrackActivity,
  maxPoints: number,
): TrackActivity {
  const segmentCount = countTrackActivityPositionSegments(activity);
  return fit.downsampleTrackActivity(activity, {
    maxPoints: maxPoints + Math.max(0, segmentCount - 1),
    strategy: "uniform",
    preserveEndpoints: true,
  });
}

function countTrackActivityPositionedPoints(activity: TrackActivity): number {
  return activity.points.reduce((count, point) => {
    return isFiniteNumber(point.lat) && isFiniteNumber(point.lon) ? count + 1 : count;
  }, 0);
}

function countTrackActivityPositionSegments(activity: TrackActivity): number {
  let count = 0;
  let inSegment = false;
  activity.points.forEach((point) => {
    const positioned = isFiniteNumber(point.lat) && isFiniteNumber(point.lon);
    if (positioned && !inSegment) {
      count += 1;
    }
    inSegment = positioned;
  });
  return count;
}

function copyUint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function formatTrackPreviewStartTime(
  metadata: TrackUploadPreviewMetadata,
): string | undefined {
  const startTime = metadata.startTime;
  if (!isFiniteNumber(startTime)) return undefined;

  const offsetSeconds = metadata.localTimeOffsetSeconds;
  if (isFiniteNumber(offsetSeconds)) {
    return formatDateTimeParts(new Date((startTime + offsetSeconds) * 1000), true);
  }
  return formatDateTimeParts(new Date(startTime * 1000), false);
}

export function formatTrackPreviewDistance(
  metadata: TrackUploadPreviewMetadata,
): string | undefined {
  const distanceM = metadata.totalDistanceM;
  if (!isFiniteNumber(distanceM) || distanceM < 0) return undefined;
  if (distanceM >= 1000) {
    return `${formatNumber(distanceM / 1000, 2)} km`;
  }
  return `${formatNumber(distanceM, 0)} m`;
}

export function formatTrackPreviewElapsedTime(
  metadata: TrackUploadPreviewMetadata,
): string | undefined {
  const seconds = metadata.totalElapsedTime;
  if (!isFiniteNumber(seconds) || seconds < 0) return undefined;

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) {
    return (
      `${hours}:${String(minutes).padStart(2, "0")}:` + String(remainingSeconds).padStart(2, "0")
    );
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function pickPreviewMetadata(metadata: TrackActivityMetadata): TrackUploadPreviewMetadata {
  const output: TrackUploadPreviewMetadata = {};
  if (isFiniteNumber(metadata.startTime)) output.startTime = metadata.startTime;
  if (isFiniteNumber(metadata.localTimeOffsetSeconds)) {
    output.localTimeOffsetSeconds = metadata.localTimeOffsetSeconds;
  }
  if (isFiniteNumber(metadata.totalDistanceM)) {
    output.totalDistanceM = metadata.totalDistanceM;
  }
  if (isFiniteNumber(metadata.totalElapsedTime)) {
    output.totalElapsedTime = metadata.totalElapsedTime;
  }
  return output;
}

function formatDateTimeParts(date: Date, useUtcFields: boolean): string {
  const year = useUtcFields ? date.getUTCFullYear() : date.getFullYear();
  const month = useUtcFields ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = useUtcFields ? date.getUTCDate() : date.getDate();
  const hours = useUtcFields ? date.getUTCHours() : date.getHours();
  const minutes = useUtcFields ? date.getUTCMinutes() : date.getMinutes();
  const seconds = useUtcFields ? date.getUTCSeconds() : date.getSeconds();

  return (
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ` +
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    String(seconds).padStart(2, "0")
  );
}

function formatNumber(value: number, fractionDigits: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(buffer);
}

async function compressGzipText(text: string): Promise<Blob> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser does not support TRJGZ compression.");
  }

  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Blob([await new Response(stream).arrayBuffer()], {
    type: "application/gzip",
  });
}

async function decompressGzipText(buffer: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not support TRJGZ decompression.");
  }

  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
