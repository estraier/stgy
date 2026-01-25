import { SearchConfig } from "./services/search";
import { InputQueueConfig } from "./services/inputQueue";
import path from "path";

export type ResourceConfig = {
  search: SearchConfig;
  inputQueue: InputQueueConfig;
};

// ベースとなるデータディレクトリ（環境変数などから取得できるようにすると運用しやすいです）
const DEFAULT_BASE_DIR = path.join(process.cwd(), "search-index");

export class Config {
  static readonly resources: ResourceConfig[] = [
    {
      // "posts" リソースの設定
      search: {
        baseDir: envStr("TTTS_BASE_DIR", DEFAULT_BASE_DIR),
        namePrefix: "posts",
        bucketDurationSeconds: 1000000, // 約11.5日ごとにファイルを分割
        autoCommitUpdateCount: 3000, // 3000件ごとにコミット
        autoCommitAfterLastUpdateSeconds: 300, // 最終更新から5分でコミット
        autoCommitAfterLastCommitSeconds: 1800, // 最終コミットから30分で強制コミット
        recordPositions: false, // detail=none で軽量化
        readConnectionCount: 3, // 最新インデックスに3つの読み取り専用接続
        maxDocumentTokenCount: 10000, // 1文書あたり最大1万トークン
        maxQueryTokenCount: 4, // 検索クエリは最大4トークンまで
      },
      inputQueue: {
        baseDir: envStr("TTTS_BASE_DIR", DEFAULT_BASE_DIR),
        namePrefix: "posts",
      },
    },
    // 必要に応じて "users" など他のリソースも同様に追加可能
  ];

  static readonly LOG_FORMAT = envStr("TTTS_LOG_FORMAT", "");
  static readonly ENABLE_KUROMOJI = envBool("TTTS_ENABLE_KUROMOJI", false);
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
