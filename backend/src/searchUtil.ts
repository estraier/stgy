import { Config } from "./config";
import { makeTextFromMarkdown } from "./utils/snippet";
import { decToHex } from "./utils/format";
import type { Pool } from "pg";

const rawArgs = process.argv.slice(2);
const printLogs = rawArgs.includes("--print-logs");
const modeAdjust = rawArgs.includes("--mode-adjust");
const stopOnError = rawArgs.includes("--stop-on-error");
const brokenOnly = rawArgs.includes("--broken-only");

const args = rawArgs.filter(
  (arg) =>
    arg !== "--print-logs" &&
    arg !== "--mode-adjust" &&
    arg !== "--stop-on-error" &&
    arg !== "--broken-only",
);

const logger = {
  info: (msg: unknown) => {
    if (printLogs) console.error(`[INFO] ${msg}`);
  },
  error: (msg: unknown) => {
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
  return ((BigInt(ts) * 1000n) << 22n).toString();
}

function idToTimestamp(idDec: string): number {
  return Math.floor(Number((BigInt(idDec) >> 22n) / 1000n));
}

async function fetchJson(
  resource: "users" | "posts",
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const baseUrl =
    process.env.STGY_SEARCH_API_BASE_URL || Config.SEARCH_API_BASE_URL || "http://localhost:3200";
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

// 型定義
interface ShardInfo {
  startTimestamp: number;
  nextTimestamp?: number;
  isHealthy: boolean;
  path: string;
}

interface IdRow {
  id: string; // BIGINT as string
}

interface UserRow {
  id: string;
  nickname: string | null;
  locale: string | null;
  introduction: string | null;
}

interface PostRow {
  id: string;
  locale: string | null;
  content: string | null;
}

interface MaintenanceStatus {
  enabled: boolean;
}

async function ensureMaintenanceMode<T>(
  resource: "users" | "posts",
  action: () => Promise<T>,
): Promise<T> {
  if (!modeAdjust) {
    return await action();
  }

  logger.info(`Checking maintenance mode status for ${resource}...`);
  const status = (await fetchJson(resource, "GET", "/maintenance")) as MaintenanceStatus;
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

async function runReserve(
  pgPool: Pool,
  resource: "users" | "posts",
  startIdDec: string,
  endIdDec: string,
) {
  logger.info(`Reserving ${resource} IDs from ${startIdDec} to ${endIdDec} (ASC)...`);

  let lastIdDec = startIdDec;
  const batchSize = getBatchSize(1000);
  const batchSleepSec = getBatchSleep();
  let totalCount = 0;

  const table = resource;

  while (true) {
    const sql = `
      SELECT id
      FROM ${table}
      WHERE id >= $1 AND id < $2
      ORDER BY id ASC
      LIMIT $3
    `;
    const currentMin = totalCount === 0 ? lastIdDec : (BigInt(lastIdDec) + 1n).toString();

    const { pgQuery } = await import("./utils/servers");
    const res = await pgQuery<IdRow>(pgPool, sql, [currentMin, endIdDec, batchSize]);
    if (res.rows.length === 0) break;

    const documents = res.rows.map((row) => ({
      id: decToHex(row.id),
      timestamp: idToTimestamp(row.id),
    }));

    logger.info(`Sending batch of ${documents.length} ${resource}...`);

    try {
      await fetchJson(resource, "POST", "/reserve?wait=60", { documents });
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
  return totalCount;
}

async function runAddUsers(pgPool: Pool, startIdDec: string, endIdDec: string) {
  logger.info(`Adding User documents from ${startIdDec} to ${endIdDec} (DESC)...`);

  let lastIdDec = endIdDec;
  const batchSize = getBatchSize(1);
  const batchSleepSec = getBatchSleep();
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

    const { pgQuery } = await import("./utils/servers");
    const res = await pgQuery<UserRow>(pgPool, sql, [currentMax, startIdDec, batchSize]);
    if (res.rows.length === 0) break;

    const promises = res.rows.map(async (row) => {
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
  return totalCount;
}

async function runAddPosts(pgPool: Pool, startIdDec: string, endIdDec: string) {
  logger.info(`Adding Post documents from ${startIdDec} to ${endIdDec} (DESC)...`);

  let lastIdDec = endIdDec;
  const batchSize = getBatchSize(1);
  const batchSleepSec = getBatchSleep();
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

    const { pgQuery } = await import("./utils/servers");
    const res = await pgQuery<PostRow>(pgPool, sql, [currentMax, startIdDec, batchSize]);
    if (res.rows.length === 0) break;

    const promises = res.rows.map(async (row) => {
      const hexId = decToHex(row.id);
      try {
        const timestamp = idToTimestamp(row.id);
        const bodyText = makeTextFromMarkdown(row.content || "");

        if (!bodyText || bodyText.trim().length === 0) return;

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
  return totalCount;
}

async function runRemove(
  pgPool: Pool,
  resource: "users" | "posts",
  startIdDec: string,
  endIdDec: string,
) {
  logger.info(`Removing ${resource} documents from ${startIdDec} to ${endIdDec} (ASC)...`);

  let lastIdDec = startIdDec;
  const batchSize = getBatchSize(1);
  const batchSleepSec = getBatchSleep();
  let totalCount = 0;

  const table = resource;

  while (true) {
    const sql = `
      SELECT id FROM ${table}
      WHERE id >= $1 AND id < $2
      ORDER BY id ASC
      LIMIT $3
    `;
    const currentMin = totalCount === 0 ? lastIdDec : (BigInt(lastIdDec) + 1n).toString();

    const { pgQuery } = await import("./utils/servers");
    const res = await pgQuery<IdRow>(pgPool, sql, [currentMin, endIdDec, batchSize]);
    if (res.rows.length === 0) break;

    const promises = res.rows.map(async (row) => {
      const hexId = decToHex(row.id);
      try {
        const timestamp = idToTimestamp(row.id);
        await fetchJson(resource, "DELETE", `/${hexId}`, { timestamp });
      } catch (e) {
        if (!stopOnError) {
          logger.error(`Failed to remove ${resource} ${hexId}: ${e}`);
        } else {
          throw e;
        }
      }
    });

    await Promise.all(promises);
    totalCount += res.rows.length;
    lastIdDec = res.rows[res.rows.length - 1].id;
    logger.info(`Removed ${totalCount} ${resource}...`);

    if (batchSleepSec > 0) await sleep(batchSleepSec);
    if (res.rows.length < batchSize) break;
  }
  return totalCount;
}

async function resetResource(pgPool: Pool, resource: "users" | "posts") {
  logger.info(`Starting RESET sequence for ${resource}...`);

  type TargetRange = { start: string; end: string; dropStartTs?: number };
  let targets: TargetRange[] = [];

  if (brokenOnly) {
    logger.info("Checking for broken shards...");
    const shards = (await fetchJson(resource, "GET", "/shards?detailed=true")) as ShardInfo[];
    if (!Array.isArray(shards)) throw new Error("Invalid shards response");

    const broken = shards.filter((s) => !s.isHealthy);
    if (broken.length === 0) {
      logger.info("No broken shards found. Exiting.");
      return;
    }

    logger.info(`Found ${broken.length} broken shards.`);
    targets = broken.map((s) => ({
      start: timestampToMinId(s.startTimestamp),
      end: s.nextTimestamp ? timestampToMinId(s.nextTimestamp) : "9223372036854775807",
      dropStartTs: s.startTimestamp,
    }));
  } else {
    logger.info("Targeting ALL data (Full Reset).");
    targets = [
      {
        start: "0",
        end: "9223372036854775807",
        dropStartTs: undefined,
      },
    ];
  }

  logger.info("Enabling maintenance mode...");
  await fetchJson(resource, "POST", "/maintenance");

  try {
    logger.info("Waiting 5s for queue drain...");
    await sleep(5);

    logger.info("Clearing task queue...");
    await fetchJson(resource, "DELETE", "/queue");

    if (brokenOnly) {
      for (const t of targets) {
        if (t.dropStartTs !== undefined) {
          logger.info(`Dropping shard: ${t.dropStartTs}...`);
          try {
            await fetchJson(resource, "DELETE", `/shards/${t.dropStartTs}?wait=10`);
          } catch (e) {
            if (!stopOnError) logger.error(e);
            else throw e;
          }
        }
      }
    } else {
      logger.info("Dropping ALL shards...");
      const shards = (await fetchJson(resource, "GET", "/shards")) as ShardInfo[];
      for (const s of shards) {
        logger.info(`Dropping shard: ${s.startTimestamp}...`);
        try {
          await fetchJson(resource, "DELETE", `/shards/${s.startTimestamp}?wait=10`);
        } catch (e) {
          if (!stopOnError) logger.error(e);
          else throw e;
        }
      }
    }

    for (const t of targets) {
      await runReserve(pgPool, resource, t.start, t.end);
    }
  } finally {
    logger.info("Disabling maintenance mode (Restore access)...");
    await fetchJson(resource, "DELETE", "/maintenance");
  }

  for (const t of targets) {
    if (resource === "users") {
      await runAddUsers(pgPool, t.start, t.end);
    } else {
      await runAddPosts(pgPool, t.start, t.end);
    }
  }

  logger.info("Flushing index...");
  await fetchJson(resource, "POST", "/flush?wait=10");

  logger.info(`RESET sequence for ${resource} COMPLETED.`);
}

async function main() {
  if (args.length < 1) {
    console.log(`Usage:
  # Reset (Full Sequence)
  ts-node src/searchUtil.ts user-reset [--broken-only] [--stop-on-error]
  ts-node src/searchUtil.ts post-reset [--broken-only] [--stop-on-error]

  # Utility
  ts-node src/searchUtil.ts wait <seconds>

  # Users (Manual)
  ts-node src/searchUtil.ts user-list-shards
  ts-node src/searchUtil.ts user-drop-shards
  ts-node src/searchUtil.ts user-clear-queue
  ts-node src/searchUtil.ts user-flush
  ts-node src/searchUtil.ts user-start-maintenance
  ts-node src/searchUtil.ts user-end-maintenance
  ts-node src/searchUtil.ts user-reserve --start <ts> --end <ts> [--mode-adjust]
  ts-node src/searchUtil.ts user-add --start <ts> --end <ts>
  ts-node src/searchUtil.ts user-remove --start <ts> --end <ts>
  ts-node src/searchUtil.ts user-search --query <q>

  # Posts (Manual)
  ts-node src/searchUtil.ts post-list-shards
  ts-node src/searchUtil.ts post-drop-shards
  ts-node src/searchUtil.ts post-clear-queue
  ts-node src/searchUtil.ts post-flush
  ts-node src/searchUtil.ts post-start-maintenance
  ts-node src/searchUtil.ts post-end-maintenance
  ts-node src/searchUtil.ts post-reserve --start <ts> --end <ts> [--mode-adjust]
  ts-node src/searchUtil.ts post-add --start <ts> --end <ts>
  ts-node src/searchUtil.ts post-remove --start <ts> --end <ts>
  ts-node src/searchUtil.ts post-search --query <q>

  Options:
    --print-logs        Output info logs to stderr
    --broken-only       (reset only) Only drop/rebuild unhealthy shards
    --stop-on-error     Stop processing if an error occurs (default: continue on error)
    --batch-size <num>  Number of items per batch
    --batch-sleep <sec> Sleep time between batches in seconds
`);
    process.exit(1);
  }

  if (!printLogs) {
    process.env.LOG_LEVEL = "error";
    process.env.PINO_LOG_LEVEL = "error";
  }

  if (args[0] === "wait") {
    const sec = parseFloat(args[1]);
    logger.info(`Waiting for ${sec} seconds...`);
    await sleep(sec);
    return;
  }

  const { connectPgWithRetry } = await import("./utils/servers");
  const pgPool = await connectPgWithRetry();

  try {
    const command = args[0];
    const startTsStr = getArgValue("--start");
    const endTsStr = getArgValue("--end");

    const startIdDec = startTsStr ? timestampToMinId(parseInt(startTsStr)) : "0";
    const endIdDec = endTsStr ? timestampToMinId(parseInt(endTsStr)) : "9223372036854775807";

    switch (command) {
      case "user-reset":
        await resetResource(pgPool, "users");
        break;
      case "post-reset":
        await resetResource(pgPool, "posts");
        break;

      case "user-list-shards": {
        const shards = await fetchJson("users", "GET", "/shards?detailed=true");
        console.log(JSON.stringify(shards, null, 2));
        break;
      }
      case "user-drop-shards": {
        logger.info("Fetching user shards...");
        const shards = (await fetchJson("users", "GET", "/shards")) as ShardInfo[];
        for (const shard of shards) {
          logger.info(`Dropping shard: ${shard.startTimestamp}...`);
          try {
            await fetchJson("users", "DELETE", `/shards/${shard.startTimestamp}?wait=10`);
          } catch (e) {
            if (!stopOnError) logger.error(e);
            else throw e;
          }
        }
        break;
      }
      case "user-clear-queue":
        await fetchJson("users", "DELETE", "/queue");
        break;
      case "user-flush":
        await fetchJson("users", "POST", "/flush?wait=10");
        break;
      case "user-start-maintenance":
        await fetchJson("users", "POST", "/maintenance");
        break;
      case "user-end-maintenance":
        await fetchJson("users", "DELETE", "/maintenance");
        break;
      case "user-reserve":
        await ensureMaintenanceMode("users", () =>
          runReserve(pgPool, "users", startIdDec, endIdDec),
        );
        break;
      case "user-add":
        await runAddUsers(pgPool, startIdDec, endIdDec);
        break;
      case "user-remove":
        await runRemove(pgPool, "users", startIdDec, endIdDec);
        break;
      case "user-search": {
        const q = getArgValue("--query");
        const off = getArgValue("--offset") || "0";
        const lim = getArgValue("--limit") || "100";
        if (!q) throw new Error("--query required");
        const res = await fetchJson(
          "users",
          "GET",
          `/search?query=${encodeURIComponent(q)}&offset=${off}&limit=${lim}`,
        );
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case "post-list-shards": {
        const shards = await fetchJson("posts", "GET", "/shards?detailed=true");
        console.log(JSON.stringify(shards, null, 2));
        break;
      }
      case "post-drop-shards": {
        logger.info("Fetching post shards...");
        const shards = (await fetchJson("posts", "GET", "/shards")) as ShardInfo[];
        for (const shard of shards) {
          logger.info(`Dropping shard: ${shard.startTimestamp}...`);
          try {
            await fetchJson("posts", "DELETE", `/shards/${shard.startTimestamp}?wait=10`);
          } catch (e) {
            if (!stopOnError) logger.error(e);
            else throw e;
          }
        }
        break;
      }
      case "post-clear-queue":
        await fetchJson("posts", "DELETE", "/queue");
        break;
      case "post-flush":
        await fetchJson("posts", "POST", "/flush?wait=10");
        break;
      case "post-start-maintenance":
        await fetchJson("posts", "POST", "/maintenance");
        break;
      case "post-end-maintenance":
        await fetchJson("posts", "DELETE", "/maintenance");
        break;
      case "post-reserve":
        await ensureMaintenanceMode("posts", () =>
          runReserve(pgPool, "posts", startIdDec, endIdDec),
        );
        break;
      case "post-add":
        await runAddPosts(pgPool, startIdDec, endIdDec);
        break;
      case "post-remove":
        await runRemove(pgPool, "posts", startIdDec, endIdDec);
        break;
      case "post-search": {
        const q = getArgValue("--query");
        const off = getArgValue("--offset") || "0";
        const lim = getArgValue("--limit") || "100";
        if (!q) throw new Error("--query required");
        const res = await fetchJson(
          "posts",
          "GET",
          `/search?query=${encodeURIComponent(q)}&offset=${off}&limit=${lim}`,
        );
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } finally {
    await pgPool.end();
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
