export class Config {
  static readonly FRONTEND_ORIGIN = envStrCsv("STGY_FRONTEND_ORIGIN", ["http://localhost:3000"]);
  static readonly BACKEND_PORT = envNum("STGY_BACKEND_PORT", 3001);
  static readonly DATABASE_HOST = envStr("STGY_DATABASE_HOST", "localhost");
  static readonly DATABASE_PORT = envNum("STGY_DATABASE_PORT", 5432);
  static readonly DATABASE_USER = envStr("STGY_DATABASE_USER", "stgy");
  static readonly DATABASE_PASSWORD = envStr("STGY_DATABASE_PASSWORD", "*");
  static readonly DATABASE_NAME = envStr("STGY_DATABASE_NAME", "stgy");
  static readonly STORAGE_DRIVER = envStr("STGY_STORAGE_DRIVER", "s3");
  static readonly STORAGE_S3_ENDPOINT = envStr("STGY_STORAGE_S3_ENDPOINT", "http://localhost:9000");
  static readonly STORAGE_S3_REGION = envStr("STGY_STORAGE_S3_REGION", "us-east-1");
  static readonly STORAGE_S3_ACCESS_KEY_ID = envStr("STGY_STORAGE_S3_ACCESS_KEY_ID", "stgy");
  static readonly STORAGE_S3_SECRET_ACCESS_KEY = envStr("STGY_STORAGE_S3_SECRET_ACCESS_KEY", "*");
  static readonly STORAGE_S3_FORCE_PATH_STYLE = envBool("STGY_STORAGE_S3_FORCE_PATH_STYLE", true);
  static readonly STORAGE_S3_BUCKET_PREFIX = envStr("STGY_STORAGE_S3_BUCKET_PREFIX", "stgy");
  static readonly STORAGE_S3_PUBLIC_URL_PREFIX = envStr(
    "STGY_STORAGE_S3_PUBLIC_URL_PREFIX",
    "http://localhost:9000/{bucket}/",
  );
  static readonly REDIS_HOST = envStr("STGY_REDIS_HOST", "localhost");
  static readonly REDIS_PORT = envNum("STGY_REDIS_PORT", 6379);
  static readonly REDIS_PASSWORD = envStr("STGY_REDIS_PASSWORD", "*");
  static readonly SMTP_HOST = envStr("STGY_SMTP_HOST", "localhost");
  static readonly SMTP_PORT = envNum("STGY_SMTP_PORT", 587);
  static readonly MAIL_SENDER_ADDRESS = envStr("STGY_MAIL_SENDER_ADDRESS", "noreply@stgy.jp");
  static readonly MAIL_ADDRESS_LIMIT_PER_MIN = envNum("STGY_MAIL_ADDRESS_LIMIT_PER_MIN", 2);
  static readonly MAIL_DOMAIN_LIMIT_PER_MIN = envNum("STGY_MAIL_DOMAIN_LIMIT_PER_MIN", 10);
  static readonly MAIL_GLOBAL_LIMIT_PER_MIN = envNum("STGY_MAIL_GLOBAL_LIMIT_PER_MIN", 100);
  static readonly SESSION_TTL = envNum("STGY_SESSION_TTL", 60 * 60 * 24 * 7);
  static readonly TRUST_PROXY_HOPS = envNum("STGY_TRUST_PROXY_HOPS", 1);
  static readonly ID_ISSUE_WORKER_ID = envNum("STGY_ID_ISSUE_WORKER_ID", 0);
  static readonly TEST_SIGNUP_CODE = envStr("STGY_TEST_SIGNUP_CODE", "");
  static readonly MEDIA_BUCKET_IMAGES = Config.STORAGE_S3_BUCKET_PREFIX + "-images";
  static readonly MEDIA_BUCKET_PROFILES = Config.STORAGE_S3_BUCKET_PREFIX + "-profiles";
  static readonly MEDIA_IMAGE_BYTE_LIMIT = envNum("STGY_MEDIA_IMAGE_BYTE_LIMIT", 10 * 1024 * 1024);
  static readonly MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH = envNum(
    "STGY_MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH",
    100 * 1024 * 1024,
  );
  static readonly MEDIA_AVATAR_BYTE_LIMIT = envNum("STGY_MEDIA_AVATAR_BYTE_LIMIT", 1 * 1024 * 1024);
  static readonly INTRODUCTION_LENGTH_LIMIT = envNum("STGY_INTRODUCTION_LENGTH_LIMIT", 2500);
  static readonly AI_PERSONALITY_LENGTH_LIMIT = envNum("STGY_AI_PERSONALITY_LENGTH_LIMIT", 2500);
  static readonly CONTENT_LENGTH_LIMIT = envNum("STGY_CONTENT_LENGTH_LIMIT", 10000);
  static readonly TAGS_NUMBER_LIMIT = envNum("STGY_TAGS_NUMBER_LIMIT", 5);
  static readonly SNIPPET_MAX_LENGTH = envNum("STGY_SNIPPET_MAX_LENGTH", 200);
  static readonly SNIPPET_MAX_HEIGHT = envNum("STGY_SNIPPET_MAX_HEIGHT", 10);
  static readonly HOURLY_SIGNUP_LIMIT = envNum("STGY_HOURLY_SIGNUP_LIMIT", 100);
  static readonly HOURLY_POSTS_LIMIT = envNum("STGY_HOURLY_POSTS_LIMIT", 100);
  static readonly HOURLY_LIKES_LIMIT = envNum("STGY_HOURLY_LIKES_LIMIT", 100);
  static readonly HOURLY_IMAGE_POSTS_LIMIT = envNum("STGY_HOURLY_IMAGE_POSTS_LIMIT", 100);
  static readonly MEDIA_WORKER_CONCURRENCY = envNum("STGY_MEDIA_WORKER_CONCURRENCY", 2);
  static readonly MEDIA_INPUT_MAX_PIXELS = envNum("STGY_MEDIA_INPUT_MAX_PIXELS", 50000000);
  static readonly MEDIA_INPUT_MAX_DIMENTION = envNum("STGY_MEDIA_INPUT_MAX_DIMENSION", 10000);
  static readonly MEDIA_THUMB_MAX_PIXELS_IMAGE = envNum(
    "STGY_MEDIA_THUMB_MAX_PIXELS_IMAGE",
    512 * 512,
  );
  static readonly MEDIA_THUMB_MAX_PIXELS_ICON = envNum(
    "STGY_MEDIA_THUMB_MAX_PIXELS_ICON",
    128 * 128,
  );
  static readonly EVENT_LOG_PARTITIONS = envNum("STGY_EVENT_LOG_PARTITIONS", 256);
  static readonly EVENT_LOG_RETENTION_DAYS = envNum("STGY_EVENT_LOG_RETENTION_DAYS", 31);
  static readonly NOTIFICATION_WORKERS = envNum("STGY_NOTIFICATION_WORKERS", 2);
  static readonly NOTIFICATION_BATCH_SIZE = envNum("STGY_NOTIFICATION_BATCH_SIZE", 100);
  static readonly NOTIFICATION_IDLE_SLEEP_MS = envNum("STGY_NOTIFICATION_IDLE_SLEEP_MS", 500);
  static readonly NOTIFICATION_PAYLOAD_RECORDS = envNum("STGY_NOTIFICATION_PAYLOAD_RECORDS", 10);
  static readonly NOTIFICATION_RETENTION_DAYS = envNum("STGY_NOTIFICATION_RETENTION_DAYS", 31);
  static readonly NOTIFICATION_SHOWN_RECORDS = envNum("STGY_NOTIFICATION_SHOWN_RECORDS", 50);
  static readonly PASSWORD_CONFIG = envStr("STGY_PASSWORD_CONFIG", "scrypt:12:20:4096:8:1");
  static readonly SYSTEM_TIMEZONE = envStr("STGY_SYSTEM_TIMEZONE", "Asia/Tokyo");
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
