import { Pool, QueryResult, QueryResultRow } from "pg";
import os from "os";
import Redis from "ioredis";
import { Config } from "../config";
import { createLogger } from "./logger";

const logger = createLogger({ file: "servers" });

export function getSampleAddr(): string {
  const ifs = os.networkInterfaces();
  for (const addrs of Object.values(ifs)) {
    for (const a of addrs ?? []) {
      if (!a.internal && a.family === "IPv4") {
        return a.address;
      }
    }
  }
  return "127.0.0.1";
}

export function makePgPool(): Pool {
  return new Pool({
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

export async function connectPgWithRetry(timeout = 60): Promise<Pool> {
  logger.info(`pg connect (pool): ${Config.DATABASE_HOST}:${Config.DATABASE_PORT}`);
  const deadline = Date.now() + timeout * 1000;
  let attempt = 0;
  for (;;) {
    const pool = makePgPool();
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (e) {
      try {
        await pool.end();
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

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  text: string,
  params: ReadonlyArray<unknown> = [],
  attempts = 3,
): Promise<QueryResult<T>> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await pool.query<T>(text, params as unknown[]);
    } catch (e) {
      lastErr = e;
      if (i === attempts) break;
      await sleep(200 * i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
