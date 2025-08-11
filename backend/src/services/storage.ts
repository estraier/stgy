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

export type StorageObjectMetadata = {
  bucket: string;
  key: string;
  size: number;
  etag?: string;
  lastModified?: string;
  storageClass?: string;
  contentType?: string;
};

export interface StorageService {
  createPresignedPost(params: PresignedPostRequest): Promise<PresignedPostResult>;

  headObject(params: StorageObjectId): Promise<StorageObjectMetadata>;

  publicUrl(params: StorageObjectId): string;

  listObjects(params: StorageObjectId): Promise<StorageObjectMetadata[]>;

  loadObject(params: StorageObjectId): Promise<Uint8Array>;

  saveObject(params: StorageObjectId, content: Uint8Array, contentType?: string): Promise<void>;

  deleteObject(params: StorageObjectId): Promise<void>;
}
