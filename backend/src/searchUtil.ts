import { Config } from "./config";
import { makeTextFromMarkdown } from "./utils/snippet";
import { decToHex, hexToDec, validateLocale } from "./utils/format";
import type { Pool } from "pg";

const rawArgs = process.argv.slice(2);
const printLogs = rawArgs.includes("--print-logs");
const modeAdjust = rawArgs.includes("--mode-adjust");
const stopOnError = rawArgs.includes("--stop-on-error");

const args = rawArgs.filter((arg) =>
  arg !== "--print-logs" &&
  arg !== "--mode-adjust" &&
  arg !== "--stop-on-error"
);

const logger = {
  info: (msg: any) => {
    if (printLogs) console.error(`[INFO] ${msg}`);
  },
  error: (msg: any) => {
    console.error(`[ERROR] ${msg}`);
  },
};

function getArgValue(key: string): string | undefined {
  const index = args.indexOf(key);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

function getBatchSize(defaultSize: number): number {
  const val = getArgValue("--batch-size");
  return val ? parseInt(val, 10) : defaultSize;
}

function getBatchSleep(): number {
  const val = getArgValue("--batch-sleep");
  return val ? parseFloat(val) : 0.1;
}

function sleep(sec: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

function timestampToMinId(ts: number): string {
  return (BigInt(ts) * 1000n << 22n).toString();
}

function idToTimestamp(idDec: string): number {
  return Math.floor(Number((BigInt(idDec) >> 22n) / 1000n));
}

async function fetchJson(resource: "users" | "posts", method: string, path: string, body?: any) {
  const baseUrl = process.env.STGY_SEARCH_API_BASE_URL || Config.SEARCH_API_BASE_URL || "http://localhost:3200";
  const url = `${baseUrl}/${resource}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API Error ${res.status} ${res.statusText}: ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function ensureMaintenanceMode<T>(resource: "users" | "posts", action: () => Promise<T>): Promise<T> {
  if (!modeAdjust) {
    return await action();
  }

  logger.info(`Checking maintenance mode status for ${resource}...`);
  const status = await fetchJson(resource, "GET", "/maintenance");
  const wasEnabled = status.enabled;

  if (!wasEnabled) {
    logger.info(`Enabling maintenance mode for ${resource} temporarily...`);
    await fetchJson(resource, "POST", "/maintenance");
  } else {
    logger.info("Maintenance mode is already enabled.");
  }

  try {
    return await action();
  } finally {
    if (!wasEnabled) {
      logger.info(`Restoring maintenance mode for ${resource} (Disabling)...`);
      await fetchJson(resource, "DELETE", "/maintenance");
    } else {
      logger.info("Leaving maintenance mode enabled (as it was before).");
    }
  }
}

async function main() {
  if (args.length < 1) {
    console.log(`Usage:
  ts-node src/searchUtil.ts user-list-shards
  ts-node src/searchUtil.ts user-drop-shards
  ts-node src/searchUtil.ts user-flush
  ts-node src/searchUtil.ts user-start-maintenance
  ts-node src/searchUtil.ts user-end-maintenance
  ts-node src/searchUtil.ts user-reserve --start <ts> --end <ts> [--mode-adjust] [--stop-on-error]
  ts-node src/searchUtil.ts user-add --start <ts> --end <ts> [--stop-on-error]
  ts-node src/searchUtil.ts user-remove --start <ts> --end <ts> [--stop-on-error]
  ts-node src/searchUtil.ts user-search --query <q> [--offset 0] [--limit 100]
  ts-node src/searchUtil.ts post-list-shards
  ts-node src/searchUtil.ts post-drop-shards
  ts-node src/searchUtil.ts post-flush
  ts-node src/searchUtil.ts post-start-maintenance
  ts-node src/searchUtil.ts post-end-maintenance
  ts-node src/searchUtil.ts post-reserve --start <ts> --end <ts> [--mode-adjust] [--stop-on-error]
  ts-node src/searchUtil.ts post-add --start <ts> --end <ts> [--stop-on-error]
  ts-node src/searchUtil.ts post-remove --start <ts> --end <ts> [--stop-on-error]
  ts-node src/searchUtil.ts post-search --query <q> [--offset 0] [--limit 100]

Other options:
  --print-logs        Output info logs to stderr
  --mode-adjust       Automatically enable maintenance mode if needed, and restore afterwards
  --stop-on-error     Stop processing if an error occurs (default: continue on error)
  --batch-size <num>  Number of items per batch (default: reserve=1000, add/remove=1)
  --batch-sleep <sec> Sleep time between batches in seconds (default: 0.1)
`);
    process.exit(1);
  }

  if (!printLogs) {
    process.env.LOG_LEVEL = "error";
    process.env.PINO_LOG_LEVEL = "error";
  }

  const { connectPgWithRetry } = await import("./utils/servers");
  const { pgQuery } = await import("./utils/servers");

  const command = args[0];
  const startTsStr = getArgValue("--start");
  const endTsStr = getArgValue("--end");
  const batchSleepSec = getBatchSleep();

  const startIdDec = startTsStr ? timestampToMinId(parseInt(startTsStr)) : "0";
  const endIdDec = endTsStr ? timestampToMinId(parseInt(endTsStr)) : "9223372036854775807";

  switch (command) {
    case "user-list-shards": {
      const shards = await fetchJson("users", "GET", "/shards?detailed=true");
      console.log(JSON.stringify(shards, null, 2));
      break;
    }

    case "user-drop-shards": {
      logger.info("Fetching user shards...");
      const shards = await fetchJson("users", "GET", "/shards") as any[];
      if (!Array.isArray(shards)) throw new Error("Invalid response format");

      for (const shard of shards) {
        logger.info(`Dropping shard: ${shard.startTimestamp} (${shard.path})...`);
        try {
          await fetchJson("users", "DELETE", `/shards/${shard.startTimestamp}?wait=10`);
        } catch (e) {
          if (!stopOnError) logger.error(e);
          else throw e;
        }
      }
      logger.info("All user shards dropped.");
      break;
    }

    case "user-flush": {
      logger.info("Flushing user index...");
      const res = await fetchJson("users", "POST", "/flush?wait=10");
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case "user-start-maintenance": {
      const res = await fetchJson("users", "POST", "/maintenance");
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case "user-end-maintenance": {
      const res = await fetchJson("users", "DELETE", "/maintenance");
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case "user-reserve": {
      await ensureMaintenanceMode("users", async () => {
        const pgPool = await connectPgWithRetry();
        try {
          logger.info(`Reserving User IDs from ${startTsStr || "BEGIN"} to ${endTsStr || "END"} (ASC)...`);

          let lastIdDec = startIdDec;
          const batchSize = getBatchSize(1000);
          let totalCount = 0;

          while (true) {
            const sql = `
              SELECT id
              FROM users
              WHERE id >= $1 AND id < $2
              ORDER BY id ASC
              LIMIT $3
            `;
            const currentMin = totalCount === 0 ? lastIdDec : (BigInt(lastIdDec) + 1n).toString();

            const res = await pgQuery(pgPool, sql, [currentMin, endIdDec, batchSize]);
            if (res.rows.length === 0) break;

            const documents = res.rows.map((row: any) => ({
              id: decToHex(row.id),
              timestamp: idToTimestamp(row.id),
            }));

            logger.info(`Sending batch of ${documents.length} users...`);

            try {
              await fetchJson("users", "POST", "/reserve?wait=60", { documents });
            } catch (e) {
              if (!stopOnError) {
                logger.error(`Failed to reserve batch starting at ${documents[0].id}: ${e}`);
              } else {
                throw e;
              }
            }

            totalCount += documents.length;
            lastIdDec = res.rows[res.rows.length - 1].id;

            if (batchSleepSec > 0) await sleep(batchSleepSec);
            if (res.rows.length < batchSize) break;
          }

          console.log(JSON.stringify({ result: "done", count: totalCount }));
        } finally {
          await pgPool.end();
        }
      });
      break;
    }

    case "user-add": {
      const pgPool = await connectPgWithRetry();
      try {
        logger.info(`Adding User documents from ${startTsStr || "BEGIN"} to ${endTsStr || "END"} (DESC)...`);

        let lastIdDec = endIdDec;
        const batchSize = getBatchSize(1);
        let totalCount = 0;

        while (true) {
          const sql = `
            SELECT u.id, u.nickname, u.locale, d.introduction
            FROM users u
            LEFT JOIN user_details d ON u.id = d.user_id
            WHERE u.id <= $1 AND u.id > $2
            ORDER BY u.id DESC
            LIMIT $3
          `;
          const currentMax = totalCount === 0 ? lastIdDec : (BigInt(lastIdDec) - 1n).toString();

          const res = await pgQuery(pgPool, sql, [currentMax, startIdDec, batchSize]);
          if (res.rows.length === 0) break;

          const promises = res.rows.map(async (row: any) => {
            const hexId = decToHex(row.id);
            try {
              const timestamp = idToTimestamp(row.id);
              const bodyText = (row.nickname || "") + "\n" + makeTextFromMarkdown(row.introduction || "");
              const locale = row.locale || Config.DEFAULT_LOCALE || "en";

              await fetchJson("users", "PUT", `/${hexId}`, {
                text: bodyText,
                timestamp,
                locale,
              });
            } catch (e) {
              if (!stopOnError) {
                logger.error(`Failed to add user ${hexId}: ${e}`);
              } else {
                throw e;
              }
            }
          });

          await Promise.all(promises);

          totalCount += res.rows.length;
          lastIdDec = res.rows[res.rows.length - 1].id;
          logger.info(`Processed ${totalCount} users...`);

          if (batchSleepSec > 0) await sleep(batchSleepSec);
          if (res.rows.length < batchSize) break;
        }

        console.log(JSON.stringify({ result: "done", count: totalCount }));
      } finally {
        await pgPool.end();
      }
      break;
    }

    case "user-remove": {
      const pgPool = await connectPgWithRetry();
      try {
        logger.info(`Removing User documents from ${startTsStr || "BEGIN"} to ${endTsStr || "END"} (ASC)...`);

        let lastIdDec = startIdDec;
        const batchSize = getBatchSize(1);
        let totalCount = 0;

        while (true) {
          const sql = `
            SELECT id FROM users
            WHERE id >= $1 AND id < $2
            ORDER BY id ASC
            LIMIT $3
          `;
          const currentMin = totalCount === 0 ? lastIdDec : (BigInt(lastIdDec) + 1n).toString();

          const res = await pgQuery(pgPool, sql, [currentMin, endIdDec, batchSize]);
          if (res.rows.length === 0) break;

          const promises = res.rows.map(async (row: any) => {
            const hexId = decToHex(row.id);
            try {
              const timestamp = idToTimestamp(row.id);
              await fetchJson("users", "DELETE", `/${hexId}`, { timestamp });
            } catch (e) {
              if (!stopOnError) {
                logger.error(`Failed to remove user ${hexId}: ${e}`);
              } else {
                throw e;
              }
            }
          });

          await Promise.all(promises);

          totalCount += res.rows.length;
          lastIdDec = res.rows[res.rows.length - 1].id;
          logger.info(`Removed ${totalCount} users...`);

          if (batchSleepSec > 0) await sleep(batchSleepSec);
          if (res.rows.length < batchSize) break;
        }

        console.log(JSON.stringify({ result: "done", count: totalCount }));
      } finally {
        await pgPool.end();
      }
      break;
    }

    case "user-search": {
      const offset = getArgValue("--offset") || "0";
      const limit = getArgValue("--limit") || "100";
      const query = getArgValue("--query");

      if (!query) throw new Error("--query is required");

      const results = await fetchJson(
        "users",
        "GET",
        `/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`
      );

      console.log(JSON.stringify(results, null, 2));
      break;
    }

    case "post-list-shards": {
      const shards = await fetchJson("posts", "GET", "/shards?detailed=true");
      console.log(JSON.stringify(shards, null, 2));
      break;
    }

    case "post-drop-shards": {
      logger.info("Fetching post shards...");
      const shards = await fetchJson("posts", "GET", "/shards") as any[];
      if (!Array.isArray(shards)) throw new Error("Invalid response format");

      for (const shard of shards) {
        logger.info(`Dropping shard: ${shard.startTimestamp} (${shard.path})...`);
        try {
          await fetchJson("posts", "DELETE", `/shards/${shard.startTimestamp}?wait=10`);
        } catch (e) {
          if (!stopOnError) logger.error(e);
          else throw e;
        }
      }
      logger.info("All post shards dropped.");
      break;
    }

    case "post-flush": {
      logger.info("Flushing post index...");
      const res = await fetchJson("posts", "POST", "/flush?wait=10");
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case "post-start-maintenance": {
      const res = await fetchJson("posts", "POST", "/maintenance");
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case "post-end-maintenance": {
      const res = await fetchJson("posts", "DELETE", "/maintenance");
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case "post-reserve": {
      await ensureMaintenanceMode("posts", async () => {
        const pgPool = await connectPgWithRetry();
        try {
          logger.info(`Reserving Post IDs from ${startTsStr || "BEGIN"} to ${endTsStr || "END"} (ASC)...`);

          let lastIdDec = startIdDec;
          const batchSize = getBatchSize(1000);
          let totalCount = 0;

          while (true) {
            const sql = `
              SELECT id
              FROM posts
              WHERE id >= $1 AND id < $2
              ORDER BY id ASC
              LIMIT $3
            `;
            const currentMin = totalCount === 0 ? lastIdDec : (BigInt(lastIdDec) + 1n).toString();

            const res = await pgQuery(pgPool, sql, [currentMin, endIdDec, batchSize]);
            if (res.rows.length === 0) break;

            const documents = res.rows.map((row: any) => ({
              id: decToHex(row.id),
              timestamp: idToTimestamp(row.id),
            }));

            logger.info(`Sending batch of ${documents.length} posts...`);

            try {
              await fetchJson("posts", "POST", "/reserve?wait=60", { documents });
            } catch (e) {
              if (!stopOnError) {
                logger.error(`Failed to reserve batch starting at ${documents[0].id}: ${e}`);
              } else {
                throw e;
              }
            }

            totalCount += documents.length;
            lastIdDec = res.rows[res.rows.length - 1].id;

            if (batchSleepSec > 0) await sleep(batchSleepSec);
            if (res.rows.length < batchSize) break;
          }

          console.log(JSON.stringify({ result: "done", count: totalCount }));
        } finally {
          await pgPool.end();
        }
      });
      break;
    }

    case "post-add": {
      const pgPool = await connectPgWithRetry();
      try {
        logger.info(`Adding Post documents from ${startTsStr || "BEGIN"} to ${endTsStr || "END"} (DESC)...`);

        let lastIdDec = endIdDec;
        const batchSize = getBatchSize(1);
        let totalCount = 0;

        while (true) {
          const sql = `
            SELECT p.id, p.locale, pd.content
            FROM posts p
            LEFT JOIN post_details pd ON p.id = pd.post_id
            WHERE p.id <= $1 AND p.id > $2
            ORDER BY p.id DESC
            LIMIT $3
          `;
          const currentMax = totalCount === 0 ? lastIdDec : (BigInt(lastIdDec) - 1n).toString();

          const res = await pgQuery(pgPool, sql, [currentMax, startIdDec, batchSize]);
          if (res.rows.length === 0) break;

          const promises = res.rows.map(async (row: any) => {
            const hexId = decToHex(row.id);
            try {
              const timestamp = idToTimestamp(row.id);
              const bodyText = makeTextFromMarkdown(row.content || "");

              if (!bodyText || bodyText.trim().length === 0) {
                return;
              }

              const locale = row.locale || Config.DEFAULT_LOCALE || "en";

              await fetchJson("posts", "PUT", `/${hexId}`, {
                text: bodyText,
                timestamp,
                locale,
              });
            } catch (e) {
              if (!stopOnError) {
                logger.error(`Failed to add post ${hexId}: ${e}`);
              } else {
                throw e;
              }
            }
          });

          await Promise.all(promises);

          totalCount += res.rows.length;
          lastIdDec = res.rows[res.rows.length - 1].id;
          logger.info(`Processed ${totalCount} posts...`);

          if (batchSleepSec > 0) await sleep(batchSleepSec);
          if (res.rows.length < batchSize) break;
        }

        console.log(JSON.stringify({ result: "done", count: totalCount }));
      } finally {
        await pgPool.end();
      }
      break;
    }

    case "post-remove": {
      const pgPool = await connectPgWithRetry();
      try {
        logger.info(`Removing Post documents from ${startTsStr || "BEGIN"} to ${endTsStr || "END"} (ASC)...`);

        let lastIdDec = startIdDec;
        const batchSize = getBatchSize(1);
        let totalCount = 0;

        while (true) {
          const sql = `
            SELECT id FROM posts
            WHERE id >= $1 AND id < $2
            ORDER BY id ASC
            LIMIT $3
          `;
          const currentMin = totalCount === 0 ? lastIdDec : (BigInt(lastIdDec) + 1n).toString();

          const res = await pgQuery(pgPool, sql, [currentMin, endIdDec, batchSize]);
          if (res.rows.length === 0) break;

          const promises = res.rows.map(async (row: any) => {
            const hexId = decToHex(row.id);
            try {
              const timestamp = idToTimestamp(row.id);
              await fetchJson("posts", "DELETE", `/${hexId}`, { timestamp });
            } catch (e) {
              if (!stopOnError) {
                logger.error(`Failed to remove post ${hexId}: ${e}`);
              } else {
                throw e;
              }
            }
          });

          await Promise.all(promises);

          totalCount += res.rows.length;
          lastIdDec = res.rows[res.rows.length - 1].id;
          logger.info(`Removed ${totalCount} posts...`);

          if (batchSleepSec > 0) await sleep(batchSleepSec);
          if (res.rows.length < batchSize) break;
        }

        console.log(JSON.stringify({ result: "done", count: totalCount }));
      } finally {
        await pgPool.end();
      }
      break;
    }

    case "post-search": {
      const offset = getArgValue("--offset") || "0";
      const limit = getArgValue("--limit") || "100";
      const query = getArgValue("--query");

      if (!query) throw new Error("--query is required");

      const results = await fetchJson(
        "posts",
        "GET",
        `/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`
      );

      console.log(JSON.stringify(results, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
