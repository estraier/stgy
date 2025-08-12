import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
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

  async createPresignedPost(params: PresignedPostRequest): Promise<PresignedPostResult> {
    const { bucket, key, expiresInSec = 300, contentTypeWhitelist, maxBytes } = params;

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

  async headObject(params: StorageObjectId): Promise<StorageObjectMetadata> {
    const res = await this.s3.send(
      new HeadObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
      }),
    );
    return {
      bucket: params.bucket,
      key: params.key,
      size: res.ContentLength ?? 0,
      etag: stripEtagQuotes(res.ETag),
      lastModified: res.LastModified?.toISOString(),
      storageClass: res.StorageClass,
      contentType: res.ContentType,
    };
  }

  publicUrl(params: StorageObjectId): string {
    return `${Config.STORAGE_PUBLIC_BASE_URL}/${params.bucket}/${params.key}`;
  }

  async listObjects(params: StorageObjectId): Promise<StorageObjectMetadata[]> {
    const all: StorageObjectMetadata[] = [];
    let continuationToken: string | undefined = undefined;
    do {
      const res: ListObjectsV2CommandOutput = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: params.bucket,
          Prefix: params.key,
          MaxKeys: 10,
          ContinuationToken: continuationToken,
        }),
      );
      const page =
        res.Contents?.map((obj: _Object) => ({
          bucket: params.bucket,
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

  async loadObject(params: StorageObjectId): Promise<Uint8Array> {
    const res = await this.s3.send(
      new GetObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
      }),
    );
    return new Uint8Array(await res.Body!.transformToByteArray());
  }

  async saveObject(
    params: StorageObjectId,
    content: Uint8Array,
    contentType?: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        Body: content,
        ContentType: contentType ? contentType : "application/octet-stream",
      }),
    );
  }

  async deleteObject(params: StorageObjectId): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
      }),
    );
  }
}
