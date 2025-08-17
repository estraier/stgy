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
  static readonly STORAGE_S3_FORCE_PATH_STYLE = envStr(
    "FAKEBOOK_STORAGE_S3_FORCE_PATH_STYLE",
    "true",
  );
  static readonly STORAGE_S3_PUBLIC_BASE_URL = envStr(
    "FAKEBOOK_STORAGE_S3_PUBLIC_BASE_URL",
    "http://localhost:9000",
  );
  static readonly STORAGE_S3_BUCKET_PREFIX = envStr(
    "FAKEBOOK_STORAGE_S3_BUCKET_PREFIX",
    "fakebook",
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
}

export function envStr(name: string, def?: string, treatEmptyAsUndefined = true): string {
  const v = process.env[name];
  if (v === undefined || (treatEmptyAsUndefined && v === "")) {
    if (def !== undefined) return def;
    throw new Error(`Env var ${name} not set`);
  }
  return v;
}

export function envNum(name: string, def?: number, treatEmptyAsUndefined = true): number {
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

export function envBool(name: string, def?: boolean, treatEmptyAsUndefined = true): boolean {
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

export function envStrCsv(name: string, def?: string[], treatEmptyAsUndefined = true): string[] {
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
