import { jest } from "@jest/globals";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { StorageS3Service } from "./storageS3";

jest.mock("@aws-sdk/client-s3", () => {
  const send = jest.fn();
  const S3Client = function () {} as any;
  (S3Client as any).prototype.send = send;
  const makeCmd = (name: string) =>
    class {
      public name = name;
      public input: any;
      constructor(input: any) {
        this.input = input;
      }
    } as any;
  return {
    S3Client,
    HeadObjectCommand: makeCmd("HeadObjectCommand"),
    GetObjectCommand: makeCmd("GetObjectCommand"),
    PutObjectCommand: makeCmd("PutObjectCommand"),
    DeleteObjectCommand: makeCmd("DeleteObjectCommand"),
    ListObjectsV2Command: makeCmd("ListObjectsV2Command"),
    CopyObjectCommand: makeCmd("CopyObjectCommand"),
  };
});

jest.mock("@aws-sdk/s3-presigned-post", () => ({
  createPresignedPost: jest.fn(),
}));

jest.mock("../config", () => ({
  Config: {
    STORAGE_S3_ENDPOINT: "http://minio:9000",
    STORAGE_S3_REGION: "us-east-1",
    STORAGE_S3_ACCESS_KEY_ID: "key",
    STORAGE_S3_SECRET_ACCESS_KEY: "secret",
    STORAGE_S3_FORCE_PATH_STYLE: "true",
    STORAGE_PUBLIC_BASE_URL: "http://localhost:9000",
  },
}));

const getMockS3Send = (): any => {
  return (S3Client as any).prototype.send as any;
};

const getMockCreatePresignedPost = (): any => {
  return createPresignedPost as any;
};

describe("StorageS3Service", () => {
  beforeEach(() => {
    getMockS3Send().mockReset();
    getMockCreatePresignedPost().mockReset();
  });

  test("createPresignedPost includes content-type and size conditions", async () => {
    const svc = new StorageS3Service();
    const bucket = "fakebook-staging";
    const key = "u1/tmp/icon.png";
    const url = `http://minio:9000/${bucket}`;
    const fields = {
      key,
      "Content-Type": "image/png",
      "x-amz-meta-foo": "bar",
    };
    const mockCreate = getMockCreatePresignedPost();
    mockCreate.mockResolvedValue({ url, fields });
    const res = await svc.createPresignedPost({
      bucket,
      key,
      contentTypeWhitelist: "image/png",
      maxBytes: 1024 * 1024,
      expiresInSec: 300,
    });
    expect(res).toEqual({
      url,
      fields,
      objectKey: key,
      maxBytes: 1024 * 1024,
      expiresInSec: 300,
    });
    const callArgs = mockCreate.mock.calls[0][1] as any;
    expect(callArgs.Bucket).toBe(bucket);
    expect(callArgs.Key).toBe(key);
    expect(callArgs.Fields["Content-Type"]).toBe("image/png");
    const conds = callArgs.Conditions as any[];
    expect(conds).toEqual(
      expect.arrayContaining([
        ["eq", "$Content-Type", "image/png"],
        ["content-length-range", 1, 1024 * 1024],
      ]),
    );
  });

  test("createPresignedPost works without maxBytes", async () => {
    const svc = new StorageS3Service();
    const bucket = "fakebook-staging";
    const key = "u1/tmp/icon.jpg";
    const mockCreate = getMockCreatePresignedPost();
    mockCreate.mockResolvedValue({
      url: `http://minio:9000/${bucket}`,
      fields: { key, "Content-Type": "image/jpeg" },
    });
    const res = await svc.createPresignedPost({
      bucket,
      key,
      contentTypeWhitelist: "image/jpeg",
      expiresInSec: 120,
    });
    expect(res.maxBytes).toBe(0);
    const callArgs = mockCreate.mock.calls[0][1] as any;
    const conds = callArgs.Conditions as any[];
    expect(conds.find((c: any) => c[0] === "content-length-range")).toBeUndefined();
  });

  test("publicUrl returns correct public URL", () => {
    const svc = new StorageS3Service();
    const url = svc.publicUrl({ bucket: "fakebook-icons", key: "u1.png" });
    expect(url).toBe("http://localhost:9000/fakebook-icons/u1.png");
  });

  test("listObjects returns metadata list (single page)", async () => {
    const svc = new StorageS3Service();
    const send = getMockS3Send();
    send.mockResolvedValueOnce({
      Contents: [
        {
          Key: "u1/20250101/abc.png",
          Size: 1234,
          ETag: "etag1",
          LastModified: new Date("2025-01-01T00:00:00Z"),
          StorageClass: "STANDARD",
        },
        {
          Key: "u1/20250101/def.jpg",
          Size: 5678,
          ETag: "etag2",
          LastModified: new Date("2025-01-02T00:00:00Z"),
          StorageClass: "STANDARD",
        },
      ],
      IsTruncated: false,
    } as any);
    const list = await svc.listObjects({ bucket: "fakebook-images", key: "u1/20250101/" });
    expect(list).toEqual([
      {
        bucket: "fakebook-images",
        key: "u1/20250101/abc.png",
        size: 1234,
        etag: "etag1",
        lastModified: "2025-01-01T00:00:00.000Z",
        storageClass: "STANDARD",
      },
      {
        bucket: "fakebook-images",
        key: "u1/20250101/def.jpg",
        size: 5678,
        etag: "etag2",
        lastModified: "2025-01-02T00:00:00.000Z",
        storageClass: "STANDARD",
      },
    ]);
    const listInput = (send.mock.calls[0][0] as any).input;
    expect(listInput.Bucket).toBe("fakebook-images");
    expect(listInput.Prefix).toBe("u1/20250101/");
  });

  test("listObjects paginates when IsTruncated is true", async () => {
    const svc = new StorageS3Service();
    const send = getMockS3Send();
    send.mockResolvedValueOnce({
      Contents: [
        { Key: "k1", Size: 1, ETag: "e1", LastModified: new Date("2025-01-01T00:00:00Z") },
      ],
      IsTruncated: true,
      NextContinuationToken: "token-1",
    } as any);
    send.mockResolvedValueOnce({
      Contents: [
        { Key: "k2", Size: 2, ETag: "e2", LastModified: new Date("2025-01-02T00:00:00Z") },
      ],
      IsTruncated: false,
    } as any);
    const out = await svc.listObjects({ bucket: "b", key: "prefix/" });
    expect(out.map((o) => o.key)).toEqual(["k1", "k2"]);
    const firstInput = (send.mock.calls[0][0] as any).input;
    const secondInput = (send.mock.calls[1][0] as any).input;
    expect(firstInput.ContinuationToken).toBeUndefined();
    expect(secondInput.ContinuationToken).toBe("token-1");
  });

  test("loadObject returns Uint8Array", async () => {
    const svc = new StorageS3Service();
    const send = getMockS3Send();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => bytes },
    } as any);
    const out = await svc.loadObject({ bucket: "b", key: "k" });
    expect(out).toEqual(bytes);
    const getInput = (send.mock.calls[0][0] as any).input;
    expect(getInput.Bucket).toBe("b");
    expect(getInput.Key).toBe("k");
    expect(getInput.Range).toBeUndefined();
  });

  test("loadObject with range sets Range header", async () => {
    const svc = new StorageS3Service();
    const send = getMockS3Send();
    const bytes = new Uint8Array([10, 20]);
    send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => bytes },
    } as any);
    const out = await svc.loadObject({ bucket: "b", key: "k" }, { offset: 0, length: 64 });
    expect(out).toEqual(bytes);
    const getInput = (send.mock.calls[0][0] as any).input;
    expect(getInput.Range).toBe("bytes=0-63");
  });

  test("saveObject and deleteObject send correct inputs", async () => {
    const svc = new StorageS3Service();
    const send = getMockS3Send();
    send.mockResolvedValueOnce({} as any);
    const body = new Uint8Array([9, 9, 9]);
    await svc.saveObject({ bucket: "b", key: "k" }, body);
    const saveInput = (send.mock.calls[0][0] as any).input;
    expect(saveInput).toEqual({
      Bucket: "b",
      Key: "k",
      Body: body,
      ContentType: "application/octet-stream",
    });
    send.mockResolvedValueOnce({} as any);
    await svc.deleteObject({ bucket: "b", key: "k" });
    const delInput = (send.mock.calls[1][0] as any).input;
    expect(delInput).toEqual({ Bucket: "b", Key: "k" });
  });

  test("copyObject sends CopyObjectCommand with proper CopySource", async () => {
    const svc = new StorageS3Service();
    const send = getMockS3Send();
    send.mockResolvedValueOnce({} as any);
    await svc.copyObject(
      { bucket: "src-bucket", key: "u1/tmp/icon.png" },
      { bucket: "dst-bucket", key: "u1/media/icon.png" },
    );
    const copyInput = (send.mock.calls[0][0] as any).input;
    expect(copyInput).toEqual({
      Bucket: "dst-bucket",
      Key: "u1/media/icon.png",
      CopySource: "/src-bucket/u1%2Ftmp%2Ficon.png",
    });
  });

  test("moveObject performs copy then delete", async () => {
    const svc = new StorageS3Service();
    const send = getMockS3Send();
    send.mockResolvedValueOnce({} as any);
    send.mockResolvedValueOnce({} as any);
    await svc.moveObject(
      { bucket: "b", key: "u1/tmp/a.png" },
      { bucket: "b", key: "u1/media/a.png" },
    );
    expect(send).toHaveBeenCalledTimes(2);
    const copyInput = (send.mock.calls[0][0] as any).input;
    const delInput = (send.mock.calls[1][0] as any).input;
    expect(copyInput.Bucket).toBe("b");
    expect(copyInput.Key).toBe("u1/media/a.png");
    expect(copyInput.CopySource).toBe("/b/u1%2Ftmp%2Fa.png");
    expect(delInput).toEqual({ Bucket: "b", Key: "u1/tmp/a.png" });
  });
});
