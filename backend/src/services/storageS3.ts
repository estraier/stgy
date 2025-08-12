import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  _Object,
} from "@aws-sdk/client-s3";
import { createPresignedPost as awsCreatePresignedPost } from "@aws-sdk/s3-presigned-post";
import type {
  StorageService,
  PresignedPostRequest,
  PresignedPostResult,
  StorageObjectId,
  StorageObjectMetadata,
  StorageObjectDataRange,
} from "./storage";
import { Config } from "../config";

function stripEtagQuotes(etag?: string): string | undefined {
  return etag?.replace(/^"|"$/g, "");
}

export class StorageS3Service implements StorageService {
  private s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      endpoint: Config.STORAGE_S3_ENDPOINT,
      region: Config.STORAGE_S3_REGION,
      credentials: {
        accessKeyId: Config.STORAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: Config.STORAGE_S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: Config.STORAGE_S3_FORCE_PATH_STYLE === "true",
    });
  }

  async createPresignedPost(req: PresignedPostRequest): Promise<PresignedPostResult> {
    const { bucket, key, expiresInSec = 300, contentTypeWhitelist, maxBytes } = req;
    type PostPolicyCondition =
      | ["eq", "$Content-Type", string]
      | ["content-length-range", number, number];
    const Conditions: PostPolicyCondition[] = [];
    const Fields: Record<string, string> = { key };
    if (contentTypeWhitelist) {
      Fields["Content-Type"] = contentTypeWhitelist;
      Conditions.push(["eq", "$Content-Type", contentTypeWhitelist]);
    }
    if (maxBytes !== undefined) {
      Conditions.push(["content-length-range", 1, maxBytes]);
    }
    const { url, fields } = await awsCreatePresignedPost(this.s3, {
      Bucket: bucket,
      Key: key,
      Fields,
      Conditions,
      Expires: expiresInSec,
    });
    return {
      url,
      fields,
      objectKey: key,
      maxBytes: maxBytes ?? 0,
      expiresInSec,
    };
  }

  async headObject(objId: StorageObjectId): Promise<StorageObjectMetadata> {
    const res = await this.s3.send(
      new HeadObjectCommand({
        Bucket: objId.bucket,
        Key: objId.key,
      }),
    );
    return {
      bucket: objId.bucket,
      key: objId.key,
      size: res.ContentLength ?? 0,
      etag: stripEtagQuotes(res.ETag),
      lastModified: res.LastModified?.toISOString(),
      storageClass: res.StorageClass,
      contentType: res.ContentType,
    };
  }

  publicUrl(objId: StorageObjectId): string {
    return `${Config.STORAGE_PUBLIC_BASE_URL}/${objId.bucket}/${objId.key}`;
  }

  async listObjects(objId: StorageObjectId): Promise<StorageObjectMetadata[]> {
    const all: StorageObjectMetadata[] = [];
    let continuationToken: string | undefined = undefined;
    do {
      const res: ListObjectsV2CommandOutput = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: objId.bucket,
          Prefix: objId.key,
          MaxKeys: 10,
          ContinuationToken: continuationToken,
        }),
      );
      const page =
        res.Contents?.map((obj: _Object) => ({
          bucket: objId.bucket,
          key: obj.Key!,
          size: obj.Size ?? 0,
          etag: stripEtagQuotes(obj.ETag),
          lastModified: obj.LastModified?.toISOString(),
          storageClass: obj.StorageClass,
        })) ?? [];

      all.push(...page);
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return all;
  }

  async loadObject(objId: StorageObjectId, range?: StorageObjectDataRange): Promise<Uint8Array> {
    const getParams: any = {
      Bucket: objId.bucket,
      Key: objId.key,
    };
    if (range) {
      const { offset, length } = range;
      if (offset < 0 || length <= 0) {
        throw new Error("invalid range");
      }
      const end = offset + length - 1;
      getParams.Range = `bytes=${offset}-${end}`;
    }
    const res = await this.s3.send(new GetObjectCommand(getParams));
    return new Uint8Array(await res.Body!.transformToByteArray());
  }

  async saveObject(
    objId: StorageObjectId,
    content: Uint8Array,
    contentType?: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: objId.bucket,
        Key: objId.key,
        Body: content,
        ContentType: contentType ? contentType : "application/octet-stream",
      }),
    );
  }

  async copyObject(srcId: StorageObjectId, dstId: StorageObjectId): Promise<void> {
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: dstId.bucket,
        Key: dstId.key,
        CopySource: `/${encodeURIComponent(srcId.bucket)}/${encodeURIComponent(srcId.key)}`,
      }),
    );
  }

  async moveObject(srcId: StorageObjectId, dstId: StorageObjectId): Promise<void> {
    await this.copyObject(srcId, dstId);
    await this.deleteObject(srcId);
  }

  async deleteObject(objId: StorageObjectId): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: objId.bucket,
        Key: objId.key,
      }),
    );
  }
}
