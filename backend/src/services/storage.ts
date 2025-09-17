import {
  PresignedPostRequest,
  PresignedPostResult,
  StorageObjectId,
  StorageObjectMetadata,
  StorageObjectListRange,
  StorageObjectDataRange,
  StorageOverwriteAttributes,
} from "../models/storage";

export interface StorageService {
  createPresignedPost(req: PresignedPostRequest): Promise<PresignedPostResult>;

  headObject(objId: StorageObjectId): Promise<StorageObjectMetadata>;

  publicUrl(objId: StorageObjectId): string;

  listObjects(
    objId: StorageObjectId,
    range?: StorageObjectListRange,
  ): Promise<StorageObjectMetadata[]>;

  loadObject(objId: StorageObjectId, range?: StorageObjectDataRange): Promise<Uint8Array>;

  saveObject(objId: StorageObjectId, content: Uint8Array, contentType?: string): Promise<void>;

  copyObject(
    srcId: StorageObjectId,
    dstId: StorageObjectId,
    attrs?: StorageOverwriteAttributes,
  ): Promise<void>;

  moveObject(
    srcId: StorageObjectId,
    dstId: StorageObjectId,
    attrs?: StorageOverwriteAttributes,
  ): Promise<void>;

  deleteObject(objId: StorageObjectId): Promise<void>;
}
