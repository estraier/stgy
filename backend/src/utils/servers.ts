import { Client } from "pg";
import Redis from "ioredis";
import type { RedisOptions } from "ioredis";
import { Config } from "../config";

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

export async function connectPgWithRetry(timeoutMs = 60_000): Promise<Client> {
  const deadline = Date.now() + timeoutMs;
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
          `pg connect failed for ${timeoutMs}ms: ${(e as Error)?.message ?? String(e)}`
        );
      }
      console.log(`[servers] pg connect failed (attempt ${attempt})`);
      await sleep(1000);
    }
  }
}

export function makeRedis(overrides?: Partial<RedisOptions>): Redis {
  return new Redis({
    host: Config.REDIS_HOST,
    port: Config.REDIS_PORT,
    password: Config.REDIS_PASSWORD,
    ...(overrides ?? {}),
  });
}
