import { jest } from "@jest/globals";
import { gzipSync } from "zlib";
import { TracksService } from "./tracks";
import type { StorageObjectMetadata, PresignedPostResult } from "../models/storage";
import type { StorageService } from "./storage";

jest.mock("../config", () => ({
  Config: {
    MEDIA_BUCKET_TRACKS: "test-bucket-tracks",
    MEDIA_TRACK_BYTE_LIMIT: 10 * 1024 * 1024,
    MEDIA_TRACK_BYTE_LIMIT_PER_MONTH: 100 * 1024 * 1024,
    MEDIA_TRACK_PREVIEW_MAX_POINTS: 3000,
    MEDIA_TRACK_JSON_BYTE_LIMIT: 1024,
    MEDIA_TRACK_JSON_FEATURE_LIMIT: 100,
    MEDIA_TRACK_JSON_POINT_LIMIT: 100000,
    MEDIA_TRACK_JSON_PROPERTY_VALUE_LIMIT: 1000000,
    MEDIA_TRACK_JSON_DEPTH_LIMIT: 32,
  },
}));

jest.mock("./trackPreview", () => ({
  makeFitTrackPreview: jest.fn(() =>
    new Uint8Array(
      gzipSync(
        Buffer.from(
          JSON.stringify({
            type: "FeatureCollection",
            features: [],
          }),
        ),
      ),
    ),
  ),
  makeTrackJsonTrackPreview: jest.fn(() =>
    new Uint8Array(
      gzipSync(
        Buffer.from(
          JSON.stringify({
            type: "FeatureCollection",
            features: [],
          }),
        ),
      ),
    ),
  ),
}));


describe("TracksService", () => {
  let storage: jest.Mocked<StorageService>;
  let service: TracksService;

  const bucket = "test-bucket-tracks";
  const userId = "u1";

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date("2025-08-12T00:00:00Z"));
  });

  beforeEach(() => {
    storage = {
      createPresignedPost: jest.fn(),
      headObject: jest.fn(),
      publicUrl: jest.fn(({ bucket, key }) => `https://cdn.example/${bucket}/${key}`),
      listObjects: jest.fn(),
      loadObject: jest.fn(),
      saveObject: jest.fn(),
      copyObject: jest.fn(),
      moveObject: jest.fn(),
      deleteObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;
    service = new TracksService(storage);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function makeMeta(
    key: string,
    size = 1234,
    contentType?: string,
  ): StorageObjectMetadata {
    return {
      bucket,
      key,
      size,
      etag: "abc",
      lastModified: new Date("2025-08-12T00:00:00Z").toISOString(),
      storageClass: "STANDARD",
      contentType,
    };
  }

  function makeFitBytes(): Uint8Array {
    const bytes = new Uint8Array(14);
    bytes[0] = 14;
    bytes[8] = 0x2e;
    bytes[9] = 0x46;
    bytes[10] = 0x49;
    bytes[11] = 0x54;
    return bytes;
  }

  test("presignTrackUpload: success for FIT with monthly quota check", async () => {
    storage.listObjects
      .mockResolvedValueOnce([makeMeta(`${userId}/masters/797491/exist.fit`, 512 * 1024)])
      .mockResolvedValueOnce([makeMeta(`${userId}/previews/797491/exist.trjgz`, 64 * 1024)]);

    const presigned: PresignedPostResult = {
      url: "http://minio:9000/test-bucket-tracks",
      fields: {
        key: "tracks-staging/u1/uuid.fit",
        "Content-Type": "application/octet-stream",
      },
      objectKey: "tracks-staging/u1/uuid.fit",
      maxBytes: 10 * 1024 * 1024,
      expiresInSec: 300,
    };
    storage.createPresignedPost.mockResolvedValueOnce(presigned);

    const res = await service.presignTrackUpload(userId, "ride.fit", 2 * 1024 * 1024);

    expect(storage.listObjects).toHaveBeenNthCalledWith(1, {
      bucket,
      key: "u1/masters/797491/",
    });
    expect(storage.listObjects).toHaveBeenNthCalledWith(2, {
      bucket,
      key: "u1/previews/797491/",
    });

    const arg = storage.createPresignedPost.mock.calls[0][0];
    expect(arg.bucket).toBe(bucket);
    expect(arg.contentTypeWhitelist).toBe("application/octet-stream");
    expect(arg.key).toMatch(/^tracks-staging\/u1\/.+\.fit$/);
    expect(res).toEqual(presigned);
  });

  test("presignTrackUpload: success for TRJGZ", async () => {
    storage.listObjects.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    storage.createPresignedPost.mockResolvedValueOnce({
      url: "http://minio:9000/test-bucket-tracks",
      fields: {
        key: "tracks-staging/u1/uuid.trjgz",
        "Content-Type": "application/gzip",
      },
      objectKey: "tracks-staging/u1/uuid.trjgz",
      maxBytes: 10 * 1024 * 1024,
      expiresInSec: 300,
    });

    await service.presignTrackUpload(userId, "ride.trjgz", 1024);

    const arg = storage.createPresignedPost.mock.calls[0][0];
    expect(arg.contentTypeWhitelist).toBe("application/gzip");
    expect(arg.key).toMatch(/^tracks-staging\/u1\/.+\.trjgz$/);
  });

  test("presignTrackUpload: rejects unsupported extension", async () => {
    await expect(service.presignTrackUpload(userId, "ride.gpx", 1024)).rejects.toThrow(
      /unsupported track file/i,
    );
    expect(storage.createPresignedPost).not.toHaveBeenCalled();
  });

  test("presignTrackUpload: rejects single-file over limit", async () => {
    await expect(service.presignTrackUpload(userId, "big.fit", 11 * 1024 * 1024)).rejects.toThrow(
      /file too large/i,
    );
  });

  test("presignTrackUpload: rejects monthly quota exceeded", async () => {
    storage.listObjects
      .mockResolvedValueOnce([makeMeta("u1/masters/797491/a.fit", 99 * 1024 * 1024)])
      .mockResolvedValueOnce([makeMeta("u1/previews/797491/a.trjgz", 2 * 1024 * 1024)]);

    await expect(service.presignTrackUpload(userId, "next.fit", 1 * 1024 * 1024)).rejects.toThrow(
      /monthly quota exceeded/i,
    );
  });

  test("presignTrackUpload: skips monthly quota when requested", async () => {
    const presigned: PresignedPostResult = {
      url: "http://minio:9000/test-bucket-tracks",
      fields: {
        key: "tracks-staging/u1/uuid.fit",
        "Content-Type": "application/octet-stream",
      },
      objectKey: "tracks-staging/u1/uuid.fit",
      maxBytes: 10 * 1024 * 1024,
      expiresInSec: 300,
    };
    storage.createPresignedPost.mockResolvedValueOnce(presigned);

    await expect(
      service.presignTrackUpload(userId, "next.fit", 1 * 1024 * 1024, true),
    ).resolves.toEqual(presigned);
    expect(storage.listObjects).not.toHaveBeenCalled();
  });

  test("finalizeTrack: success for FIT, move master and synchronously save preview", async () => {
    const stagingKey = "tracks-staging/u1/tmp.fit";
    storage.headObject.mockResolvedValueOnce(
      makeMeta(stagingKey, 2 * 1024 * 1024, "application/octet-stream"),
    );
    storage.loadObject.mockResolvedValueOnce(makeFitBytes()).mockResolvedValueOnce(makeFitBytes());
    storage.listObjects.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const masterMeta = makeMeta(
      "u1/masters/797491/8244988800000deadbeef.fit",
      2 * 1024 * 1024,
      "application/octet-stream",
    );
    const previewMeta = makeMeta(
      "u1/previews/797491/8244988800000deadbeef.trjgz",
      5120,
      "application/gzip",
    );
    storage.headObject.mockResolvedValueOnce(masterMeta).mockResolvedValueOnce(previewMeta);

    const result = await service.finalizeTrack(userId, stagingKey);

    expect(storage.moveObject).toHaveBeenCalledTimes(1);
    const [src, dst, attrs] = storage.moveObject.mock.calls[0];
    expect(src).toEqual({ bucket, key: stagingKey });
    expect(dst.bucket).toBe(bucket);
    expect(dst.key).toMatch(/^u1\/masters\/797491\/[0-9a-f]{16}\.fit$/);
    expect(attrs?.contentType).toBe("application/octet-stream");
    expect(attrs?.metadata?.["track-format"]).toBe("fit");
    expect(attrs?.metadata?.["preview-key"]).toMatch(
      /^u1\/previews\/797491\/[0-9a-f]{16}\.trjgz$/,
    );

    expect(storage.saveObject).toHaveBeenCalledTimes(1);
    const [previewId, previewBytes, previewContentType] = storage.saveObject.mock.calls[0];
    expect(previewId.bucket).toBe(bucket);
    expect(previewId.key).toMatch(/^u1\/previews\/797491\/[0-9a-f]{16}\.trjgz$/);
    expect(previewBytes.length).toBeGreaterThan(0);
    expect(previewContentType).toBe("application/gzip");

    expect(result.master.publicUrl).toContain(masterMeta.key);
    expect(result.master.previewKey).toBe(previewMeta.key);
    expect(result.preview.publicUrl).toContain(previewMeta.key);
  });

  test("finalizeTrack: success for TRJGZ", async () => {
    const stagingKey = "tracks-staging/u1/tmp.trjgz";
    const trackJson = JSON.stringify({
      type: "FeatureCollection",
      features: [],
    });
    storage.headObject.mockResolvedValueOnce(makeMeta(stagingKey, 1000, "application/gzip"));
    storage.loadObject
      .mockResolvedValueOnce(new Uint8Array(gzipSync(Buffer.from(trackJson))).slice(0, 64))
      .mockResolvedValueOnce(new Uint8Array(gzipSync(Buffer.from(trackJson))));
    storage.listObjects.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    storage.headObject
      .mockResolvedValueOnce(makeMeta("u1/masters/797491/master.trjgz", 1000, "application/gzip"))
      .mockResolvedValueOnce(makeMeta("u1/previews/797491/master.trjgz", 200, "application/gzip"));

    await service.finalizeTrack(userId, stagingKey);

    const [, dst, attrs] = storage.moveObject.mock.calls[0];
    expect(dst.key).toMatch(/^u1\/masters\/797491\/[0-9a-f]{16}\.trjgz$/);
    expect(attrs?.contentType).toBe("application/gzip");
    expect(attrs?.metadata?.["track-format"]).toBe("trjgz");
    expect(storage.saveObject.mock.calls[0][0].key).toMatch(
      /^u1\/previews\/797491\/[0-9a-f]{16}\.trjgz$/,
    );
  });

  test("finalizeTrack: deletes and rejects invalid FIT header", async () => {
    const stagingKey = "tracks-staging/u1/tmp.fit";
    storage.headObject.mockResolvedValueOnce(makeMeta(stagingKey, 1000, "application/octet-stream"));
    storage.loadObject.mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4]));

    await expect(service.finalizeTrack(userId, stagingKey)).rejects.toThrow(/invalid track data/i);
    expect(storage.deleteObject).toHaveBeenCalledWith({ bucket, key: stagingKey });
    expect(storage.loadObject).toHaveBeenCalledTimes(1);
  });

  test("finalizeTrack: rejects invalid key path", async () => {
    await expect(service.finalizeTrack(userId, "tracks-staging/u2/tmp.fit")).rejects.toThrow(
      /invalid key/i,
    );
  });

  test("finalizeTrack: deletes and rejects invalid track data", async () => {
    const preview = jest.requireMock("./trackPreview") as {
      makeFitTrackPreview: jest.Mock;
    };
    preview.makeFitTrackPreview.mockImplementationOnce(() => {
      throw new Error("bad fit");
    });

    const stagingKey = "tracks-staging/u1/tmp.fit";
    storage.headObject.mockResolvedValueOnce(makeMeta(stagingKey, 1000, "application/octet-stream"));
    storage.loadObject.mockResolvedValueOnce(makeFitBytes()).mockResolvedValueOnce(makeFitBytes());

    await expect(service.finalizeTrack(userId, stagingKey)).rejects.toThrow(/invalid track data/i);
    expect(storage.deleteObject).toHaveBeenCalledWith({ bucket, key: stagingKey });
  });

  test("finalizeTrack: rejects monthly quota exceeded at finalize", async () => {
    const stagingKey = "tracks-staging/u1/tmp.fit";
    storage.headObject.mockResolvedValueOnce(
      makeMeta(stagingKey, 2 * 1024 * 1024, "application/octet-stream"),
    );
    storage.loadObject.mockResolvedValueOnce(makeFitBytes()).mockResolvedValueOnce(makeFitBytes());
    storage.listObjects
      .mockResolvedValueOnce([makeMeta("u1/masters/797491/a.fit", 99 * 1024 * 1024)])
      .mockResolvedValueOnce([makeMeta("u1/previews/797491/a.trjgz", 2 * 1024 * 1024)]);

    await expect(service.finalizeTrack(userId, stagingKey)).rejects.toThrow(
      /monthly quota exceeded/i,
    );
    expect(storage.deleteObject).toHaveBeenCalledWith({ bucket, key: stagingKey });
  });

  test("finalizeTrack: skips monthly quota when requested", async () => {
    const stagingKey = "tracks-staging/u1/tmp.fit";
    storage.headObject.mockResolvedValueOnce(
      makeMeta(stagingKey, 2 * 1024 * 1024, "application/octet-stream"),
    );
    storage.loadObject.mockResolvedValueOnce(makeFitBytes()).mockResolvedValueOnce(makeFitBytes());
    storage.headObject
      .mockResolvedValueOnce(
        makeMeta("u1/masters/797491/master.fit", 2 * 1024 * 1024, "application/octet-stream"),
      )
      .mockResolvedValueOnce(
        makeMeta("u1/previews/797491/master.trjgz", 5120, "application/gzip"),
      );

    await expect(service.finalizeTrack(userId, stagingKey, true)).resolves.toBeDefined();
    expect(storage.listObjects).not.toHaveBeenCalled();
  });

  test("finalizeTrack: deletes and rejects oversized TRJGZ JSON", async () => {
    const stagingKey = "tracks-staging/u1/tmp.trjgz";
    const body = JSON.stringify({
      type: "FeatureCollection",
      features: [],
      padding: "x".repeat(2048),
    });
    const gz = new Uint8Array(gzipSync(Buffer.from(body)));
    storage.headObject.mockResolvedValueOnce(makeMeta(stagingKey, gz.length, "application/gzip"));
    storage.loadObject.mockResolvedValueOnce(gz.slice(0, 64)).mockResolvedValueOnce(gz);

    await expect(service.finalizeTrack(userId, stagingKey)).rejects.toThrow(/invalid track data/i);
    expect(storage.deleteObject).toHaveBeenCalledWith({ bucket, key: stagingKey });
    expect(storage.moveObject).not.toHaveBeenCalled();
  });

  test("listTracks: returns masters with public and preview URLs", async () => {
    const objs = [
      makeMeta("u1/masters/797491/a.fit", 100, "application/octet-stream"),
      makeMeta("u1/masters/797491/b.trjgz", 200, "application/gzip"),
    ];
    storage.listObjects.mockResolvedValueOnce(objs);

    const res = await service.listTracks(userId, 0, 100);

    expect(storage.listObjects).toHaveBeenCalledWith(
      { bucket, key: "u1/masters/" },
      { offset: 0, limit: 100 },
    );
    expect(res[0].publicUrl).toBe("https://cdn.example/test-bucket-tracks/u1/masters/797491/a.fit");
    expect(res[0].previewKey).toBe("u1/previews/797491/a.trjgz");
    expect(res[0].previewUrl).toBe(
      "https://cdn.example/test-bucket-tracks/u1/previews/797491/a.trjgz",
    );
  });

  test("getTrackBytes: success for masters and previews", async () => {
    storage.headObject.mockResolvedValueOnce(makeMeta("u1/masters/797491/a.fit", 123));
    storage.loadObject.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    const master = await service.getTrackBytes(userId, "masters/797491/a.fit");

    expect(master.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(storage.headObject).toHaveBeenCalledWith({ bucket, key: "u1/masters/797491/a.fit" });

    storage.headObject.mockResolvedValueOnce(makeMeta("u1/previews/797491/a.trjgz", 45));
    storage.loadObject.mockResolvedValueOnce(new Uint8Array([4, 5, 6]));

    const preview = await service.getTrackBytes(userId, "previews/797491/a.trjgz");

    expect(preview.bytes).toEqual(new Uint8Array([4, 5, 6]));
    expect(storage.headObject).toHaveBeenCalledWith({
      bucket,
      key: "u1/previews/797491/a.trjgz",
    });
  });

  test("getTrackBytes: rejects invalid key", async () => {
    await expect(service.getTrackBytes(userId, "tracks-staging/u1/tmp.fit")).rejects.toThrow(
      /invalid key/i,
    );
  });

  test("deleteTrack: deletes master and derived preview", async () => {
    await service.deleteTrack(userId, "masters/797491/foo.fit");

    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket,
      key: "u1/masters/797491/foo.fit",
    });
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket,
      key: "u1/previews/797491/foo.trjgz",
    });
  });

  test("calculateMonthlyQuota: sums masters and previews", async () => {
    storage.listObjects
      .mockResolvedValueOnce([
        makeMeta("u1/masters/797491/a.fit", 10),
        makeMeta("u1/masters/797491/b.trjgz", 20),
      ])
      .mockResolvedValueOnce([
        makeMeta("u1/previews/797491/a.trjgz", 1),
        makeMeta("u1/previews/797491/b.trjgz", 2),
      ]);

    const quota = await service.calculateMonthlyQuota(userId);

    expect(storage.listObjects).toHaveBeenNthCalledWith(1, {
      bucket,
      key: "u1/masters/797491/",
    });
    expect(storage.listObjects).toHaveBeenNthCalledWith(2, {
      bucket,
      key: "u1/previews/797491/",
    });

    expect(quota).toEqual({
      userId,
      yyyymm: "202508",
      bytesMasters: 30,
      bytesPreviews: 3,
      bytesTotal: 33,
      limitSingleBytes: 10 * 1024 * 1024,
      limitMonthlyBytes: 100 * 1024 * 1024,
    });
  });

  test("calculateMonthlyQuota: reports no monthly limit when quota is skipped", async () => {
    storage.listObjects.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const quota = await service.calculateMonthlyQuota(userId, undefined, true);

    expect(quota.limitMonthlyBytes).toBeNull();
  });

  test("deleteAllTracks: deletes masters, previews, and staging", async () => {
    const masters = [makeMeta("u1/masters/797491/a.fit", 10)];
    const previews = [makeMeta("u1/previews/797491/a.trjgz", 1)];
    const staging = [makeMeta("tracks-staging/u1/tmp.fit", 5)];
    storage.listObjects
      .mockResolvedValueOnce(masters)
      .mockResolvedValueOnce(previews)
      .mockResolvedValueOnce(staging);

    await service.deleteAllTracks(userId);

    expect(storage.listObjects).toHaveBeenCalledWith({
      bucket,
      key: "u1/masters/",
    });
    expect(storage.listObjects).toHaveBeenCalledWith({
      bucket,
      key: "u1/previews/",
    });
    expect(storage.listObjects).toHaveBeenCalledWith({
      bucket,
      key: "tracks-staging/u1/",
    });
    expect(storage.deleteObject).toHaveBeenCalledTimes(3);
  });
});
