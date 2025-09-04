import { Client } from "pg";
import Redis from "ioredis";
import { Config } from "../config";
import { createLogger } from "./logger";

const logger = createLogger({ file: "servers" });

export function makePg(): Client {
  return new Client({
    host: Config.DATABASE_HOST,
    port: Config.DATABASE_PORT,
    user: Config.DATABASE_USER,
    password: Config.DATABASE_PASSWORD,
    database: Config.DATABASE_NAME,
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function connectPgWithRetry(timeout = 60): Promise<Client> {
  logger.info(`pg connect: ${Config.DATABASE_HOST}:${Config.DATABASE_PORT}`);
  const deadline = Date.now() + timeout * 1000;
  let attempt = 0;
  for (;;) {
    const pg = makePg();
    try {
      await pg.connect();
      return pg;
    } catch (e) {
      try {
        await pg.end();
      } catch {}
      attempt++;
      if (Date.now() >= deadline) {
        throw new Error(
          `pg connect failed for ${timeout} sec: ${(e as Error)?.message ?? String(e)}`,
        );
      }
      logger.warn(`[servers] pg connect failed (attempt ${attempt})`);
      await sleep(1000);
    }
  }
}

export function makeRedis(): Redis {
  return new Redis({
    host: Config.REDIS_HOST,
    port: Config.REDIS_PORT,
    password: Config.REDIS_PASSWORD,
    lazyConnect: true,
  });
}

export async function connectRedisWithRetry(timeout = 60): Promise<Redis> {
  logger.info(`redis connect: ${Config.REDIS_HOST}:${Config.REDIS_PORT}`);
  const deadline = Date.now() + timeout * 1000;
  let attempt = 0;
  for (;;) {
    const redis = makeRedis();
    try {
      await redis.connect();
      if (redis.status !== "ready") {
        await new Promise<void>((resolve, reject) => {
          const onReady = () => {
            cleanup();
            resolve();
          };
          const onError = (err: unknown) => {
            cleanup();
            reject(err as Error);
          };
          const cleanup = () => {
            redis.off("ready", onReady);
            redis.off("error", onError);
          };
          redis.once("ready", onReady);
          redis.once("error", onError);
        });
      }
      return redis;
    } catch (e) {
      try {
        redis.disconnect();
      } catch {}
      attempt++;
      if (Date.now() >= deadline) {
        throw new Error(
          `redis connect failed for ${timeout} sec: ${(e as Error)?.message ?? String(e)}`,
        );
      }
      logger.warn(`[servers] redis connect failed (attempt ${attempt})`);
      await sleep(1000);
    }
  }
}
