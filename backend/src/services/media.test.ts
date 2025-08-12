import { jest } from "@jest/globals";
import Redis from "ioredis";
import { MediaService } from "./media";
import type { StorageService, StorageObjectMetadata, PresignedPostResult } from "./storage";

jest.mock("../config", () => ({
  Config: {
    MEDIA_IMAGE_BUCKET: "fakebook-images",
    MEDIA_IMAGE_BYTE_LIMIT: 10 * 1024 * 1024,
    MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH: 100 * 1024 * 1024,
    MEDIA_PROFILE_BUCKET: "fakebook-profiles",
    MEDIA_ICON_BYTE_LIMIT: 1 * 1024 * 1024,
  },
}));

describe("MediaService", () => {
  let storage: jest.Mocked<StorageService>;
  let redis: Redis;
  let service: MediaService;

  const imageBucket = "fakebook-images";
  const profileBucket = "fakebook-profiles";
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
    service = new MediaService(storage, redis);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function makeMeta(
    key: string,
    size = 1234,
    contentType?: string,
    bucket = imageBucket,
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
      bucket: imageBucket,
      key: "u1/797491/",
    });

    expect(storage.createPresignedPost).toHaveBeenCalled();
    const arg = storage.createPresignedPost.mock.calls[0][0];
    expect(arg.bucket).toBe(imageBucket);
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
    storage.headObject.mockResolvedValueOnce(
      makeMeta(stagingKey, 2 * 1024 * 1024, "image/png", imageBucket),
    );
    storage.loadObject.mockResolvedValueOnce(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
    );
    storage.listObjects.mockResolvedValueOnce([]);
    const dstMeta = makeMeta(
      "u1/797491/8244988800000deadbeef.png",
      2 * 1024 * 1024,
      "image/png",
      imageBucket,
    );
    storage.headObject.mockResolvedValueOnce(dstMeta);

    const meta = await service.finalizeImage(userId, stagingKey);

    expect(storage.moveObject).toHaveBeenCalledTimes(1);
    const [, dst] = storage.moveObject.mock.calls[0];
    expect(dst.bucket).toBe(imageBucket);
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
    storage.headObject.mockResolvedValueOnce(makeMeta(stagingKey, 1000, "image/png", imageBucket));
    storage.loadObject.mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4, 5]));
    await expect(service.finalizeImage(userId, stagingKey)).rejects.toThrow(/invalid image data/i);
    expect(storage.deleteObject).toHaveBeenCalledWith({ bucket: imageBucket, key: stagingKey });
  });

  test("listImages: returns objects", async () => {
    const objs = [
      makeMeta("u1/797491/a.png", 100, undefined, imageBucket),
      makeMeta("u1/797491/b.jpg", 200, undefined, imageBucket),
    ];
    storage.listObjects.mockResolvedValueOnce(objs);

    const res = await service.listImages(userId, 0, 100);

    expect(storage.listObjects).toHaveBeenCalledWith(
      { bucket: imageBucket, key: "u1/" },
      { offset: 0, limit: 100 },
    );
    expect(res).toEqual(objs);
  });

  test("getImageBytes: success", async () => {
    const keyWithout = "797491/foo.webp";
    const fullKey = `${userId}/${keyWithout}`;
    const meta = makeMeta(fullKey, 321, "image/webp", imageBucket);
    const bytes = new Uint8Array([7, 8, 9]);

    storage.headObject.mockResolvedValueOnce(meta);
    storage.loadObject.mockResolvedValueOnce(bytes);

    const out = await service.getImageBytes(userId, keyWithout);

    expect(storage.headObject).toHaveBeenCalledWith({ bucket: imageBucket, key: fullKey });
    expect(storage.loadObject).toHaveBeenCalledWith({ bucket: imageBucket, key: fullKey });
    expect(out.meta).toEqual(meta);
    expect(out.bytes).toEqual(bytes);
  });

  test("deleteImage: deletes master and its thumbs", async () => {
    const keyWithout = "797491/foo.webp";
    const fullKey = `${userId}/${keyWithout}`;

    const thumbs = [
      makeMeta(`${userId}/thumbs/foo.webp_image.webp`, 11, "image/webp", imageBucket),
      makeMeta(`${userId}/thumbs/foo.webp_icon.webp`, 12, "image/webp", imageBucket),
    ];
    storage.listObjects.mockResolvedValueOnce(thumbs);

    await service.deleteImage(userId, keyWithout);

    expect(storage.deleteObject).toHaveBeenCalledWith({ bucket: imageBucket, key: fullKey });
    expect(storage.listObjects).toHaveBeenCalledWith({
      bucket: imageBucket,
      key: `${userId}/thumbs/foo.webp_`,
    });
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: imageBucket,
      key: `${userId}/thumbs/foo.webp_image.webp`,
    });
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: imageBucket,
      key: `${userId}/thumbs/foo.webp_icon.webp`,
    });
  });

  test("presignProfileUpload: success with sizeLimit", async () => {
    const presigned: PresignedPostResult = {
      url: "http://minio:9000/fakebook-profiles",
      fields: { key: "profiles-staging/u1/avatar/uuid.png", "Content-Type": "image/png" },
      objectKey: "profiles-staging/u1/avatar/uuid.png",
      maxBytes: 1 * 1024 * 1024,
      expiresInSec: 300,
    };
    storage.createPresignedPost.mockResolvedValueOnce(presigned);

    const res = await service.presignProfileUpload(
      userId,
      "avatar",
      "icon.png",
      100_000,
      1_000_000,
    );

    expect(storage.createPresignedPost).toHaveBeenCalled();
    const arg = storage.createPresignedPost.mock.calls[0][0];
    expect(arg.bucket).toBe(profileBucket);
    expect(arg.contentTypeWhitelist).toBe("image/png");
    expect(arg.key).toMatch(/^profiles-staging\/u1\/avatar\/.+\.png$/);
    expect(res).toEqual(presigned);
  });

  test("presignProfileUpload: rejects when over given sizeLimit", async () => {
    await expect(
      service.presignProfileUpload(userId, "avatar", "icon.png", 2_000_000, 1_000_000),
    ).rejects.toThrow(/file too large/i);
    expect(storage.createPresignedPost).not.toHaveBeenCalled();
  });

  test("finalizeProfile: success, move and enqueue icon thumbnail", async () => {
    const stagingKey = "profiles-staging/u1/avatar/tmp.png";
    storage.headObject.mockResolvedValueOnce(
      makeMeta(stagingKey, 200_000, "image/png", profileBucket),
    );
    storage.loadObject.mockResolvedValueOnce(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const masterMeta = makeMeta("u1/avatar.png", 200_000, "image/png", profileBucket);
    storage.headObject.mockResolvedValueOnce(masterMeta);

    const out = await service.finalizeProfile(userId, "avatar", stagingKey, {
      sizeLimitBytes: 1_000_000,
      thumbnailType: "icon",
    });

    expect(storage.moveObject).toHaveBeenCalledWith(
      { bucket: profileBucket, key: stagingKey },
      { bucket: profileBucket, key: "u1/avatar.png" },
    );
    expect(out).toEqual(masterMeta);

    expect((redis.lpush as jest.Mock).mock.calls[0][0]).toBe("media-thumb-queue");
    const payload = (redis.lpush as jest.Mock).mock.calls[0][1] as string;
    expect(payload).toContain('"type":"icon"');
    expect(payload).toContain('"sourceBucket":"fakebook-profiles"');
    expect(payload).toContain('"sourceKey":"u1/avatar.png"');
    expect(payload).toContain('"outputBucket":"fakebook-profiles"');
    expect(payload).toContain('"outputKey":"u1/thumbs/avatar_icon.webp"');
  });

  test("finalizeProfile: rejects invalid key path", async () => {
    await expect(
      service.finalizeProfile(userId, "avatar", "profiles-staging/u2/avatar/tmp.png"),
    ).rejects.toThrow(/invalid key/i);
  });

  test("getProfileBytes: picks master and returns bytes", async () => {
    const objs = [
      makeMeta("u1/avatar.png", 123, "image/png", profileBucket),
      makeMeta("u1/thumbs/avatar_icon.webp", 45, "image/webp", profileBucket),
    ];
    storage.listObjects.mockResolvedValueOnce(objs);

    const meta = makeMeta("u1/avatar.png", 123, "image/png", profileBucket);
    const bytes = new Uint8Array([1, 2, 3]);
    storage.headObject.mockResolvedValueOnce(meta);
    storage.loadObject.mockResolvedValueOnce(bytes);

    const out = await service.getProfileBytes(userId, "avatar");

    expect(storage.listObjects).toHaveBeenCalledWith({
      bucket: profileBucket,
      key: "u1/avatar",
    });
    expect(out.meta).toEqual(meta);
    expect(out.bytes).toEqual(bytes);
  });

  test("deleteProfile: deletes master and its thumbs", async () => {
    storage.listObjects.mockResolvedValueOnce([
      makeMeta("u1/avatar.png", 100, "image/png", profileBucket),
      makeMeta("u1/thumbs/avatar_icon.webp", 10, "image/webp", profileBucket),
    ]);
    storage.listObjects.mockResolvedValueOnce([
      makeMeta("u1/thumbs/avatar_icon.webp", 10, "image/webp", profileBucket),
      makeMeta("u1/thumbs/avatar_extra.webp", 12, "image/webp", profileBucket),
    ]);

    await service.deleteProfile(userId, "avatar");

    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: profileBucket,
      key: "u1/avatar.png",
    });
    expect(storage.listObjects).toHaveBeenCalledWith({
      bucket: profileBucket,
      key: "u1/thumbs/avatar_",
    });
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: profileBucket,
      key: "u1/thumbs/avatar_icon.webp",
    });
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: profileBucket,
      key: "u1/thumbs/avatar_extra.webp",
    });
  });
});
