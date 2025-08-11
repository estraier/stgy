import type { StorageService } from "./storage";
import { StorageS3Service } from "./storageS3";

export function makeStorageService(driver: string): StorageService {
  switch ((driver || "").toLowerCase()) {
    case "s3":
      return new StorageS3Service();
    default:
      throw new Error(`Unsupported storage driver: ${driver}`);
  }
}
