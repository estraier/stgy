import { Config } from "./config";
import { createLogger } from "./utils/logger";
import sharp from "sharp";
import { makeStorageService } from "./services/storageFactory";
import type { StorageService } from "./services/storage";
import { connectRedisWithRetry } from "./utils/servers";
import { WorkerLifecycle, runIfMain } from "./utils/workerRunner";
import type Redis from "ioredis";

const logger = createLogger({ file: "mediaWorker" });
export const lifecycle = new WorkerLifecycle();

type ThumbQueueTask =
  | { type: "image"; bucket: string; originalKey: string }
  | { type: "icon"; bucket: string; originalKey: string };

const QUEUE = "media-thumb-queue";
const inflight = new Set<Promise<void>>();

function stripExt(file: string): string {
  return file.replace(/\.[^.]+$/, "");
}

function deriveOutKey(originalKey: string, kind: "image" | "icon"): string {
  const parts = originalKey.split("/");
  if (kind === "image") {
    if (parts.length < 4 || parts[1] !== "masters") {
      throw new Error(`invalid originalKey for image: ${originalKey}`);
    }
    const userId = parts[0];
    const revMM = parts[2];
    const file = parts[3];
    const base = stripExt(file);
    return `${userId}/thumbs/${revMM}/${base}_${kind}.webp`;
  } else {
    if (parts.length < 3 || parts[1] !== "masters") {
      throw new Error(`invalid originalKey for icon: ${originalKey}`);
    }
    const userId = parts[0];
    const file = parts[2];
    const base = stripExt(file);
    return `${userId}/thumbs/${base}_${kind}.webp`;
  }
}

function calcTargetSize(
  srcW: number | undefined,
  srcH: number | undefined,
  maxPixels: number,
): { width?: number; height?: number } {
  if (!srcW || !srcH || srcW <= 0 || srcH <= 0) {
    const side = Math.floor(Math.sqrt(maxPixels));
    return { width: side, height: side };
  }
  const pixels = srcW * srcH;
  if (pixels <= maxPixels) return { width: srcW, height: srcH };
  const scale = Math.sqrt(maxPixels / pixels);
  const w = Math.max(1, Math.floor(srcW * scale));
  const h = Math.max(1, Math.floor(srcH * scale));
  return { width: w, height: h };
}

async function generateKind(
  storage: StorageService,
  bucket: string,
  originalKey: string,
  kind: "image" | "icon",
) {
  const outKey = deriveOutKey(originalKey, kind);
  const maxPixels =
    kind === "image" ? Config.MEDIA_THUMB_MAX_PIXELS_IMAGE : Config.MEDIA_THUMB_MAX_PIXELS_ICON;

  const head = await storage.headObject({ bucket, key: originalKey });
  if (!head || head.size <= 0) {
    logger.warn(`not found or empty: ${bucket}/${originalKey}`);
    return;
  }

  const srcBytes = await storage.loadObject({ bucket, key: originalKey });
  const base = sharp(Buffer.from(srcBytes), { limitInputPixels: Config.MEDIA_INPUT_MAX_PIXELS });
  const meta = await base.metadata();
  const { width: tw, height: th } = calcTargetSize(meta.width, meta.height, maxPixels);

  const outBuf = await base
    .resize({ width: tw, height: th, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  await storage.saveObject({ bucket, key: outKey }, new Uint8Array(outBuf), "image/webp");
  logger.info(`wrote ${bucket}/${outKey} (${outBuf.length} bytes)`);
}

async function handleTask(storage: StorageService, task: ThumbQueueTask) {
  switch (task.type) {
    case "image":
    case "icon": {
      await generateKind(storage, task.bucket, task.originalKey, task.type);
      return;
    }
    default: {
      logger.warn(`unknown task: ${String(task)}`);
    }
  }
}

async function processQueue(queue: string, redis: Redis, storage: StorageService) {
  while (lifecycle.isActive) {
    try {
      if (inflight.size >= Config.MEDIA_WORKER_CONCURRENCY) {
        await Promise.race(inflight);
        continue;
      }

      const res = await redis.brpop(queue, 5);

      if (!lifecycle.isActive) break;

      if (!res) continue;
      const payload = res[1];
      const p = (async () => {
        try {
          let msg: unknown = JSON.parse(payload);
          if (typeof msg === "object" && msg !== null && "type" in msg) {
            await handleTask(storage, msg as ThumbQueueTask);
          } else {
            logger.error(`invalid task object in ${queue}: ${payload}`);
          }
        } catch (e) {
          logger.error(`error processing task: ${e}`);
        }
      })();
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    } catch (e) {
      if (!lifecycle.isActive) break;
      logger.error(`error processing ${queue}: ${e}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  if (inflight.size > 0) {
    logger.info(`Waiting for ${inflight.size} inflight tasks...`);
    await Promise.allSettled(Array.from(inflight));
  }
}

export async function startMediaWorker() {
  logger.info(`STGY media worker started (concurrency=${Config.MEDIA_WORKER_CONCURRENCY})`);
  const redis = await connectRedisWithRetry();
  const storage: StorageService = makeStorageService(Config.STORAGE_DRIVER);

  try {
    await processQueue(QUEUE, redis, storage);
  } finally {
    logger.info("Stopping media worker, disconnecting redis...");
    try {
      redis.disconnect();
    } catch (e) {
      logger.error(`Redis disconnect error: ${e}`);
    }
  }
}

runIfMain(module, startMediaWorker, logger, lifecycle);
