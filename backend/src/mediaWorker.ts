import { Config } from "./config";
import Redis from "ioredis";
import sharp from "sharp";
import { makeStorageService } from "./services/storageFactory";
import type { StorageService } from "./services/storage";

type ThumbQueueTask =
  | { type: "image"; bucket: string; originalKey: string }
  | { type: "icon"; bucket: string; originalKey: string };

const QUEUE = "media-thumb-queue";
const MAX_PIXELS_IMAGE = 512 * 512;
const MAX_PIXELS_ICON = 96 * 96;

const redis = new Redis({
  host: Config.REDIS_HOST,
  port: Config.REDIS_PORT,
  password: Config.REDIS_PASSWORD,
});

const storage: StorageService = makeStorageService(Config.STORAGE_DRIVER);

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

async function generateKind(bucket: string, originalKey: string, kind: "image" | "icon") {
  const outKey = deriveOutKey(originalKey, kind);
  const maxPixels = kind === "image" ? MAX_PIXELS_IMAGE : MAX_PIXELS_ICON;

  const head = await storage.headObject({ bucket, key: originalKey });
  if (!head || head.size <= 0) {
    console.log(`[mediaworker] not found or empty: ${bucket}/${originalKey}`);
    return;
  }

  const srcBytes = await storage.loadObject({ bucket, key: originalKey });

  const base = sharp(Buffer.from(srcBytes));
  const meta = await base.metadata();
  const { width: tw, height: th } = calcTargetSize(meta.width, meta.height, maxPixels);

  const outBuf = await base
    .resize({ width: tw, height: th, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  await storage.saveObject({ bucket, key: outKey }, new Uint8Array(outBuf), "image/webp");
  console.log(`[mediaworker] wrote ${bucket}/${outKey} (${outBuf.length} bytes)`);
}

async function handleTask(task: ThumbQueueTask) {
  if (task.type === "image" || task.type === "icon") {
    await generateKind(task.bucket, task.originalKey, task.type);
    return;
  }
  const _exhaustive: never = task as never;
  console.log("[mediaworker] unknown task type", _exhaustive);
}

let shuttingDown = false;
const inflight = new Set<Promise<void>>();

async function processQueue(queue: string) {
  while (!shuttingDown) {
    try {
      if (inflight.size >= Config.MEDIA_WORKER_CONCURRENCY) {
        await Promise.race(inflight);
        continue;
      }
      const res = await redis.brpop(queue, 5);
      if (!res) continue;
      const payload = res[1];
      const p = (async () => {
        try {
          let msg: unknown = JSON.parse(payload);
          if (typeof msg === "object" && msg !== null && "type" in msg) {
            await handleTask(msg as ThumbQueueTask);
          } else {
            console.log(`[mediaworker] invalid task object in ${queue}:`, payload);
          }
        } catch (e) {
          console.log(`[mediaworker] error processing task:`, e);
        }
      })();
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    } catch (e) {
      if (shuttingDown) break;
      console.log(`[mediaworker] error processing ${queue}:`, e);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    redis.disconnect();
  } catch {}
  try {
    await Promise.allSettled(Array.from(inflight));
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  console.log(
    `[mediaworker] Fakebook media thumbnail worker started (concurrency=${Config.MEDIA_WORKER_CONCURRENCY})`,
  );
  await processQueue(QUEUE);
}

main().catch((e) => {
  console.log("[mediaworker] Fatal error:", e);
  process.exit(1);
});
