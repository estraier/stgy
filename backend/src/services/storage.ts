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

export type StorageObjectDataRange = {
  offset: number;
  length: number;
};

export interface StorageService {
  createPresignedPost(req: PresignedPostRequest): Promise<PresignedPostResult>;

  headObject(objId: StorageObjectId): Promise<StorageObjectMetadata>;

  publicUrl(objId: StorageObjectId): string;

  listObjects(objId: StorageObjectId): Promise<StorageObjectMetadata[]>;

  loadObject(objId: StorageObjectId, range?: StorageObjectDataRange): Promise<Uint8Array>;

  saveObject(objId: StorageObjectId, content: Uint8Array, contentType?: string): Promise<void>;

  copyObject(srcId: StorageObjectId, dstId: StorageObjectId): Promise<void>;

  moveObject(srcId: StorageObjectId, dstId: StorageObjectId): Promise<void>;

  deleteObject(objId: StorageObjectId): Promise<void>;
}
