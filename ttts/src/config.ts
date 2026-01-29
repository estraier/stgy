import { SearchConfig } from "./services/search";
import { InputQueueConfig } from "./services/inputQueue";
import path from "path";

export type ResourceConfig = {
  search: SearchConfig;
  inputQueue: InputQueueConfig;
};

const DEFAULT_INDEX_DIR = path.join(process.cwd(), "ttts-index");
const COMMON_INDEX_DIR = envStr("STGY_TTTS_INDEX_DIR", DEFAULT_INDEX_DIR);

export class Config {
  static readonly resources: ResourceConfig[] = [
    {
      search: {
        baseDir: COMMON_INDEX_DIR,
        namePrefix: "posts",
        bucketDurationSeconds: 1000000,
        autoCommitUpdateCount: 10000,
        autoCommitAfterLastUpdateSeconds: 300,
        autoCommitAfterLastCommitSeconds: 1800,
        initialDocumentId: 2097151,
        recordPositions: false,
        recordContents: true,
        readConnectionCount: 3,
        maxDocumentTokenCount: 10000,
        maxQueryTokenCount: 5,
      },
      inputQueue: {
        baseDir: COMMON_INDEX_DIR,
        namePrefix: "posts",
      },
    },
    {
      search: {
        baseDir: COMMON_INDEX_DIR,
        namePrefix: "users",
        bucketDurationSeconds: 10000000,
        autoCommitUpdateCount: 10000,
        autoCommitAfterLastUpdateSeconds: 300,
        autoCommitAfterLastCommitSeconds: 1800,
        initialDocumentId: 2097151,
        recordPositions: false,
        recordContents: true,
        readConnectionCount: 3,
        maxDocumentTokenCount: 10000,
        maxQueryTokenCount: 5,
      },
      inputQueue: {
        baseDir: COMMON_INDEX_DIR,
        namePrefix: "users",
      },
    },
  ];
  static readonly INPUT_BODY_LIMIT = envNum("STGY_TTTS_INPUT_BODY_LIMIT", 2 * 1024 * 1024);
  static readonly TTTS_PORT = envNum("STGY_TTTS_PORT", 3200);
  static readonly LOG_FORMAT = envStr("STGY_TTTS_LOG_FORMAT", "");
  static readonly ENABLE_KUROMOJI = envBool("STGY_TTTS_ENABLE_KUROMOJI", false);
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
