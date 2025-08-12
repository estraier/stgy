import { jest } from "@jest/globals";
import Redis from "ioredis";
import { MediaService } from "./media";
import type { StorageService, StorageObjectMetadata, PresignedPostResult } from "./storage";

jest.mock("../config", () => ({
  Config: {
    MEDIA_IMAGE_BUCKET: "fakebook-images",
    MEDIA_IMAGE_BYTE_LIMIT: 10 * 1024 * 1024,
    MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH: 100 * 1024 * 1024,
  },
}));

describe("MediaService", () => {
  let storage: jest.Mocked<StorageService>;
  let redis: Redis;
  let service: MediaService;
  const bucket = "fakebook-images";
  const userId = "u1";

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date("2025-08-12T00:00:00Z"));
  });

  beforeEach(() => {
    storage = {
      createPresignedPost: jest.fn(),
      headObject: jest.fn(),
      publicUrl: jest.fn(),
      listObjects: jest.fn(),
      loadObject: jest.fn(),
      saveObject: jest.fn(),
      copyObject: jest.fn(),
      moveObject: jest.fn(),
      deleteObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;
    redis = { lpush: jest.fn() } as unknown as Redis;
    service = new MediaService(storage, redis, bucket);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function makeMeta(key: string, size = 1234, contentType?: string): StorageObjectMetadata {
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

  test("presignImageUpload: success (png)", async () => {
    storage.listObjects.mockResolvedValueOnce([
      makeMeta(`${userId}/797491/old.png`, 1 * 1024 * 1024),
    ]);

    const presigned: PresignedPostResult = {
      url: "http://minio:9000/fakebook-images",
      fields: { key: "staging/u1/uuid.png", "Content-Type": "image/png" },
      objectKey: "staging/u1/uuid.png",
      maxBytes: 10 * 1024 * 1024,
      expiresInSec: 300,
    };
    storage.createPresignedPost.mockResolvedValueOnce(presigned);

    const res = await service.presignImageUpload(userId, "photo.png", 2 * 1024 * 1024);

    expect(storage.listObjects).toHaveBeenCalledWith({
      bucket,
      key: "u1/797491/",
    });

    expect(storage.createPresignedPost).toHaveBeenCalled();
    const arg = storage.createPresignedPost.mock.calls[0][0];
    expect(arg.bucket).toBe(bucket);
    expect(arg.contentTypeWhitelist).toBe("image/png");
    expect(arg.key).toMatch(/^staging\/u1\/.+\.png$/);

    expect(res).toEqual(presigned);
  });

  test("presignImageUpload: rejects unsupported mime", async () => {
    await expect(service.presignImageUpload(userId, "note.txt", 1024)).rejects.toThrow(
      /unsupported content type/i,
    );
    expect(storage.createPresignedPost).not.toHaveBeenCalled();
  });

  test("presignImageUpload: rejects single-file over limit", async () => {
    await expect(service.presignImageUpload(userId, "big.jpg", 20 * 1024 * 1024)).rejects.toThrow(
      /file too large/i,
    );
  });

  test("presignImageUpload: rejects monthly quota exceeded", async () => {
    storage.listObjects.mockResolvedValueOnce([
      makeMeta(`${userId}/797491/a.png`, 99 * 1024 * 1024),
    ]);
    await expect(service.presignImageUpload(userId, "next.png", 5 * 1024 * 1024)).rejects.toThrow(
      /monthly quota exceeded/i,
    );
  });

  test("finalizeImage: success (png sniff ok, move, enqueue)", async () => {
    const stagingKey = "staging/u1/tmp_abc.png";
    storage.headObject.mockResolvedValueOnce(makeMeta(stagingKey, 2 * 1024 * 1024, "image/png"));
    storage.loadObject.mockResolvedValueOnce(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
    );
    storage.listObjects.mockResolvedValueOnce([]);
    const dstMeta = makeMeta("u1/797491/8244988800000deadbeef.png", 2 * 1024 * 1024, "image/png");
    storage.headObject.mockResolvedValueOnce(dstMeta);

    const meta = await service.finalizeImage(userId, stagingKey);

    expect(storage.moveObject).toHaveBeenCalledTimes(1);
    const [, dst] = storage.moveObject.mock.calls[0];
    expect(dst.bucket).toBe(bucket);
    expect(dst.key).toMatch(/^u1\/797491\/\d{13}[0-9a-f]{8}\.png$/);

    expect((redis.lpush as jest.Mock).mock.calls[0][0]).toBe("media-thumb-queue");
    expect((redis.lpush as jest.Mock).mock.calls[0][1]).toMatch(
      /"type":"image","bucket":"fakebook-images","originalKey":"u1\/797491\/\d{13}[0-9a-f]{8}\.png"/,
    );

    expect(meta).toEqual(dstMeta);
  });

  test("finalizeImage: rejects invalid key path", async () => {
    await expect(service.finalizeImage(userId, "staging/u2/tmp.png")).rejects.toThrow(
      /invalid key/i,
    );
  });

  test("finalizeImage: deletes and rejects when sniff fails", async () => {
    const stagingKey = "staging/u1/tmp.png";
    storage.headObject.mockResolvedValueOnce(makeMeta(stagingKey, 1000, "image/png"));
    storage.loadObject.mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4, 5]));
    await expect(service.finalizeImage(userId, stagingKey)).rejects.toThrow(/invalid image data/i);
    expect(storage.deleteObject).toHaveBeenCalledWith({ bucket, key: stagingKey });
  });

  test("listImages: returns objects", async () => {
    const objs = [makeMeta("u1/797491/a.png", 100), makeMeta("u1/797491/b.jpg", 200)];
    storage.listObjects.mockResolvedValueOnce(objs);

    const res = await service.listImages(userId, 0, 100);

    expect(storage.listObjects).toHaveBeenCalledWith(
      { bucket, key: "u1/" },
      { offset: 0, limit: 100 },
    );
    expect(res).toEqual(objs);
  });

  test("getImageBytes: success", async () => {
    const keyWithout = "797491/foo.webp";
    const fullKey = `${userId}/${keyWithout}`;
    const meta = makeMeta(fullKey, 321, "image/webp");
    const bytes = new Uint8Array([7, 8, 9]);

    storage.headObject.mockResolvedValueOnce(meta);
    storage.loadObject.mockResolvedValueOnce(bytes);

    const out = await service.getImageBytes(userId, keyWithout);

    expect(storage.headObject).toHaveBeenCalledWith({ bucket, key: fullKey });
    expect(storage.loadObject).toHaveBeenCalledWith({ bucket, key: fullKey });
    expect(out.meta).toEqual(meta);
    expect(out.bytes).toEqual(bytes);
  });

  test("deleteImage: success", async () => {
    const keyWithout = "797491/foo.webp";
    const fullKey = `${userId}/${keyWithout}`;

    await service.deleteImage(userId, keyWithout);

    expect(storage.deleteObject).toHaveBeenCalledWith({ bucket, key: fullKey });
  });
});
