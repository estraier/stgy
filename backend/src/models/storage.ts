export type PresignedPostRequest = {
  bucket: string;
  key: string;
  contentTypeWhitelist: string;
  maxBytes?: number;
  expiresInSec?: number;
};

export type PresignedPostResult = {
  url: string;
  fields: Record<string, string>;
  objectKey: string;
  maxBytes: number;
  expiresInSec: number;
};

export type StorageObjectId = {
  bucket: string;
  key: string;
};

export type StorageObjectMetadata = StorageObjectId & {
  size: number;
  etag?: string;
  lastModified?: string;
  storageClass?: string;
  contentType?: string;
  metadata?: Record<string, string>;
};

export type StorageObjectListRange = {
  offset: number;
  limit: number;
};

export type StorageObjectDataRange = {
  offset: number;
  length: number;
};

export type StorageOverwriteAttributes = {
  contentType?: string;
  metadata?: Record<string, string>;
};

export type StorageMonthlyQuota = {
  userId: string;
  yyyymm: string;
  bytesMasters: number;
  bytesThumbs: number;
  bytesTotal: number;
  limitSingleBytes: number | null;
  limitMonthlyBytes: number | null;
};
