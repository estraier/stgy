import { SearchConfig } from "./services/search";
import path from "path";

const DEFAULT_INDEX_DIR = path.join(process.cwd(), "search-index");
const COMMON_INDEX_DIR = envStr("STGY_SEARCH_INDEX_DIR", DEFAULT_INDEX_DIR);

export class Config {
  static readonly resources: SearchConfig[] = [
    {
      baseDir: COMMON_INDEX_DIR,
      namePrefix: "posts",
      bucketDurationSeconds: 3000000,
      autoCommitUpdateCount: 10000,
      autoCommitDurationSeconds: 60,
      commitCheckIntervalSeconds: 300,
      updateWorkerBusySleepSeconds: 0.1,
      updateWorkerIdleSleepSeconds: 2.0,
      initialDocumentId: 2097151,
      recordPositions: false,
      recordContents: true,
      readConnectionCounts: [2, 2, 1, 1, 0],
      mmapSizes: [268435456, 268435456, 0],
      cacheSizes: [25165824, 25165824, 409600],
      automergeLevels: [8, 2],
      maxDocumentTokenCount: 10000,
      maxQueryTokenCount: 5,
    },
    {
      baseDir: COMMON_INDEX_DIR,
      namePrefix: "users",
      bucketDurationSeconds: 30000000,
      autoCommitUpdateCount: 10000,
      autoCommitDurationSeconds: 60,
      commitCheckIntervalSeconds: 300,
      updateWorkerBusySleepSeconds: 0.1,
      updateWorkerIdleSleepSeconds: 2.0,
      initialDocumentId: 2097151,
      recordPositions: false,
      recordContents: true,
      readConnectionCounts: [2, 2, 1, 1, 0],
      mmapSizes: [268435456, 268435456, 0],
      cacheSizes: [25165824, 25165824, 409600],
      automergeLevels: [8, 2],
      maxDocumentTokenCount: 10000,
      maxQueryTokenCount: 5,
    },
  ];
  static readonly INPUT_BODY_LIMIT = envNum("STGY_SEARCH_INPUT_BODY_LIMIT", 2 * 1024 * 1024);
  static readonly SERVER_PORT = envNum("STGY_SEARCH_PORT", 3200);
  static readonly LOG_FORMAT = envStr("STGY_SEARCH_LOG_FORMAT", "");
  static readonly ENABLE_KUROMOJI = envBool("STGY_SEARCH_ENABLE_KUROMOJI", false);
}

export function envStr(name: string, def?: string, treatEmptyAsUndefined = false): string {
  const v = process.env[name];
  if (v === undefined || (treatEmptyAsUndefined && v === "")) {
    if (def !== undefined) return def;
    throw new Error(`Env var ${name} not set`);
  }
  return v;
}

export function envNum(name: string, def?: number, treatEmptyAsUndefined = false): number {
  const v = process.env[name];
  if (v === undefined || (treatEmptyAsUndefined && v === "")) {
    if (def !== undefined) return def;
    throw new Error(`Env var ${name} not set`);
  }
  const n = Number(v);
  if (isNaN(n)) {
    if (def !== undefined) return def;
    throw new Error(`Env var ${name} is not a valid number: ${v}`);
  }
  return n;
}

export function envBool(name: string, def?: boolean, treatEmptyAsUndefined = false): boolean {
  const v = process.env[name];
  if (v === undefined || (treatEmptyAsUndefined && v === "")) {
    if (def !== undefined) return def;
    throw new Error(`Env var ${name} not set`);
  }
  const vv = v.toLowerCase();
  if (["1", "true", "yes", "on"].includes(vv)) return true;
  if (["0", "false", "no", "off"].includes(vv)) return false;
  if (def !== undefined) return def;
  throw new Error(`Env var ${name} is not a valid boolean: ${v}`);
}

export function envStrCsv(name: string, def?: string[], treatEmptyAsUndefined = false): string[] {
  const v = process.env[name];
  if (v === undefined || (treatEmptyAsUndefined && v === "")) {
    if (def !== undefined) return def;
    throw new Error(`Env var ${name} not set`);
  }
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
