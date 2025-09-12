export class Config {
  static readonly FRONTEND_ORIGIN = envStrCsv("FAKEBOOK_FRONTEND_ORIGIN", [
    "http://localhost:3000",
  ]);
  static readonly BACKEND_HOST = envStr("FAKEBOOK_BACKEND_HOST", "localhost");
  static readonly BACKEND_PORT = envNum("FAKEBOOK_BACKEND_PORT", 3001);
  static readonly DATABASE_HOST = envStr("FAKEBOOK_DATABASE_HOST", "localhost");
  static readonly DATABASE_PORT = envNum("FAKEBOOK_DATABASE_PORT", 5432);
  static readonly DATABASE_USER = envStr("FAKEBOOK_DATABASE_USER", "fakebook");
  static readonly DATABASE_PASSWORD = envStr("FAKEBOOK_DATABASE_PASSWORD", "db_password");
  static readonly DATABASE_NAME = envStr("FAKEBOOK_DATABASE_NAME", "fakebook");
  static readonly STORAGE_DRIVER = envStr("FAKEBOOK_STORAGE_DRIVER", "s3");
  static readonly STORAGE_S3_ENDPOINT = envStr(
    "FAKEBOOK_STORAGE_S3_ENDPOINT",
    "http://localhost:9000",
  );
  static readonly STORAGE_S3_REGION = envStr("FAKEBOOK_STORAGE_S3_REGION", "us-east-1");
  static readonly STORAGE_S3_ACCESS_KEY_ID = envStr(
    "FAKEBOOK_STORAGE_S3_ACCESS_KEY_ID",
    "fakebook",
  );
  static readonly STORAGE_S3_SECRET_ACCESS_KEY = envStr(
    "FAKEBOOK_STORAGE_S3_SECRET_ACCESS_KEY",
    "minio_password",
  );
  static readonly STORAGE_S3_FORCE_PATH_STYLE = envBool(
    "FAKEBOOK_STORAGE_S3_FORCE_PATH_STYLE",
    true,
  );
  static readonly STORAGE_S3_BUCKET_PREFIX = envStr(
    "FAKEBOOK_STORAGE_S3_BUCKET_PREFIX",
    "fakebook",
  );
  static readonly STORAGE_S3_PUBLIC_URL_PREFIX = envStr(
    "FAKEBOOK_STORAGE_S3_PUBLIC_URL_PREFIX",
    "http://localhost:9000/{bucket}/",
  );
  static readonly REDIS_HOST = envStr("FAKEBOOK_REDIS_HOST", "localhost");
  static readonly REDIS_PORT = envNum("FAKEBOOK_REDIS_PORT", 6379);
  static readonly REDIS_PASSWORD = envStr("FAKEBOOK_REDIS_PASSWORD", "redis_password");
  static readonly SMTP_HOST = envStr("FAKEBOOK_SMTP_HOST", "localhost");
  static readonly SMTP_PORT = envNum("FAKEBOOK_SMTP_PORT", 587);
  static readonly MAIL_SENDER_ADDRESS = envStr("FAKEBOOK_MAIL_SENDER_ADDRESS", "noreply@dbmx.net");
  static readonly MAIL_ADDRESS_LIMIT_PER_MIN = envNum("FAKEBOOK_MAIL_ADDRESS_LIMIT_PER_MIN", 2);
  static readonly MAIL_DOMAIN_LIMIT_PER_MIN = envNum("FAKEBOOK_MAIL_DOMAIN_LIMIT_PER_MIN", 10);
  static readonly MAIL_GLOBAL_LIMIT_PER_MIN = envNum("FAKEBOOK_MAIL_GLOBAL_LIMIT_PER_MIN", 100);
  static readonly SESSION_TTL = envNum("FAKEBOOK_SESSION_TTL", 60 * 60 * 24 * 7);
  static readonly TRUST_PROXY_HOPS = envNum("FAKEBOOK_TRUST_PROXY_HOPS", 1);
  static readonly TEST_SIGNUP_CODE = envStr("FAKEBOOK_TEST_SIGNUP_CODE", "");
  static readonly ID_ISSUE_WORKER_ID = envNum("FAKEBOOK_ID_ISSUE_WORKER_ID", 0);
  static readonly MEDIA_BUCKET_IMAGES = Config.STORAGE_S3_BUCKET_PREFIX + "-images";
  static readonly MEDIA_BUCKET_PROFILES = Config.STORAGE_S3_BUCKET_PREFIX + "-profiles";
  static readonly MEDIA_IMAGE_BYTE_LIMIT = envNum(
    "FAKEBOOK_MEDIA_IMAGE_BYTE_LIMIT",
    10 * 1024 * 1024,
  );
  static readonly MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH = envNum(
    "FAKEBOOK_MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH",
    100 * 1024 * 1024,
  );
  static readonly MEDIA_AVATAR_BYTE_LIMIT = envNum(
    "FAKEBOOK_MEDIA_AVATAR_BYTE_LIMIT",
    1 * 1024 * 1024,
  );
  static readonly INTRODUCTION_LENGTH_LIMIT = envNum("FAKEBOOK_INTRODUCTION_LENGTH_LIMIT", 2500);
  static readonly AI_PERSONALITY_LENGTH_LIMIT = envNum(
    "FAKEBOOK_AI_PERSONALITY_LENGTH_LIMIT",
    2500,
  );
  static readonly CONTENT_LENGTH_LIMIT = envNum("FAKEBOOK_CONTENT_LENGTH_LIMIT", 10000);
  static readonly TAGS_NUMBER_LIMIT = envNum("FAKEBOOK_TAGS_NUMBER_LIMIT", 5);
  static readonly SNIPPET_MAX_LENGTH = envNum("FAKEBOOK_SNIPPET_MAX_LENGTH", 200);
  static readonly SNIPPET_MAX_HEIGHT = envNum("FAKEBOOK_SNIPPET_MAX_HEIGHT", 10);
  static readonly HOURLY_SIGNUP_LIMIT = envNum("FAKEBOOK_HOURLY_SIGNUP_LIMIT", 100);
  static readonly HOURLY_POSTS_LIMIT = envNum("FAKEBOOK_HOURLY_POSTS_LIMIT", 100);
  static readonly HOURLY_LIKES_LIMIT = envNum("FAKEBOOK_HOURLY_LIKES_LIMIT", 100);
  static readonly HOURLY_IMAGE_POSTS_LIMIT = envNum("FAKEBOOK_HOURLY_IMAGE_POSTS_LIMIT", 100);
  static readonly MEDIA_WORKER_CONCURRENCY = envNum("FAKEBOOK_MEDIA_WORKER_CONCURRENCY", 2);
  static readonly MEDIA_INPUT_MAX_PIXELS = envNum("FAKEBOOK_MEDIA_INPUT_MAX_PIXELS", 50000000);
  static readonly MEDIA_INPUT_MAX_DIMENTION = envNum("FAKEBOOK_MEDIA_INPUT_MAX_DIMENSION", 10000);
  static readonly MEDIA_THUMB_MAX_PIXELS_IMAGE = envNum(
    "FAKEBOOK_MEDIA_THUMB_MAX_PIXELS_IMAGE",
    512 * 512,
  );
  static readonly MEDIA_THUMB_MAX_PIXELS_ICON = envNum(
    "FAKEBOOK_MEDIA_THUMB_MAX_PIXELS_ICON",
    128 * 128,
  );
  static readonly EVENT_LOG_PARTITIONS = envNum("FAKEBOOK_EVENT_LOG_PARTITIONS", 256);
  static readonly EVENT_LOG_RETENTION_DAYS = envNum("FAKEBOOK_EVENT_LOG_RETENTION_DAYS", 31);
  static readonly NOTIFICATION_WORKERS = envNum("FAKEBOOK_NOTIFICATION_WORKERS", 2);
  static readonly NOTIFICATION_BATCH_SIZE = envNum("FAKEBOOK_NOTIFICATION_BATCH_SIZE", 100);
  static readonly NOTIFICATION_IDLE_SLEEP_MS = envNum("FAKEBOOK_NOTIFICATION_IDLE_SLEEP_MS", 500);
  static readonly NOTIFICATION_PAYLOAD_RECORDS = envNum(
    "FAKEBOOK_NOTIFICATION_PAYLOAD_RECORDS",
    10,
  );
  static readonly NOTIFICATION_RETENTION_DAYS = envNum("FAKEBOOK_NOTIFICATION_RETENTION_DAYS", 31);
  static readonly NOTIFICATION_SHOWN_RECORDS = envNum("FAKEBOOK_NOTIFICATION_SHOWN_RECORDS", 50);
  static readonly SYSTEM_TIMEZONE = envStr("FAKEBOOK_SYSTEM_TIMEZONE", "Asia/Tokyo");
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
