export class Config {
  static readonly BACKEND_API_BASE_URL = envStr(
    "NEXT_PUBLIC_BACKEND_API_BASE_URL",
    "http://localhost:3001",
  );
  static readonly STORAGE_S3_BUCKET_PREFIX = envStr("NEXT_PUBLIC_S3_BUCKET_PREFIX", "fakebook");
  static readonly STORAGE_S3_PUBLIC_URL_PREFIX = envStr(
    "NEXT_PUBLIC_STORAGE_S3_PUBLIC_URL_PREFIX",
    "http://localhost:9000/{bucket}/",
  );
  static readonly MEDIA_BUCKET_IMAGES = Config.STORAGE_S3_BUCKET_PREFIX + "-images";
  static readonly MEDIA_BUCKET_PROFILES = Config.STORAGE_S3_BUCKET_PREFIX + "-profiles";
  static readonly MEDIA_IMAGE_BYTE_LIMIT = envNum(
    "NEXT_PUBLIC_MEDIA_IMAGE_BYTE_LIMIT",
    10 * 1024 * 1024,
  );
  static readonly MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH = envNum(
    "NEXT_PUBLIC_MEDIA_IMAGE_BYTE_LIMIT_PER_MONTH",
    100 * 1024 * 1024,
  );
  static readonly MEDIA_IMAGE_COUNT_LIMIT_ONCE = envNum(
    "NEXT_PUBLIC_MEDIA_IMAGE_COUNT_LIMIT_ONCE",
    10,
  );
  static readonly MEDIA_AVATAR_BYTE_LIMIT = envNum(
    "NEXT_PUBLIC_MEDIA_AVATAR_BYTE_LIMIT",
    1 * 1024 * 1024,
  );
  static readonly POSTS_PAGE_SIZE = envNum("NEXT_PUBLIC_POSTS_PAGE_SIZE", 20);
  static readonly USERS_PAGE_SIZE = envNum("NEXT_PUBLIC_USERS_PAGE_SIZE", 20);
  static readonly LIKERS_LIST_FIRST_LIMIT = envNum("NEXT_PUBLIC_LIKERS_FIRST_LIMIT", 10);
  static readonly LIKERS_LIST_SECOND_LIMIT = envNum("NEXT_PUBLIC_LIKERS_SECOND_LIMIT", 100);
  static readonly IMAGES_PAGE_SIZE = envNum("NEXT_PUBLIC_IMAGES_PAGE_SIZE", 30);
  static readonly INTRODUCTION_LENGTH_LIMIT = envNum("NEXT_PUBLIC_INTRODUCTION_LENGTH_LIMIT", 2500);
  static readonly AI_PERSONALITY_LENGTH_LIMIT = envNum(
    "NEXT_PUBLIC_AI_PERSONALITY_LENGTH_LIMIT",
    2500,
  );
  static readonly CONTENT_LENGTH_LIMIT = envNum("NEXT_PUBLIC_CONTENT_LENGTH_LIMIT", 10000);
  static readonly TAGS_NUMBER_LIMIT = envNum("NEXT_PUBLIC_TAGS_NUMBER_LIMIT", 5);
  static readonly SNIPPET_MAX_LENGTH = envNum("NEXT_PUBLIC_SNIPPET_MAX_LENGTH", 200);
  static readonly SNIPPET_MAX_HEIGHT = envNum("NEXT_PUBLIC_SNIPPET_MAX_HEIGHT", 10);
  static readonly MAX_MEDIA_OBJECTS_PER_POST = envNum("NEXT_PUBLIC_MAX_MEDIA_OBJECTS_PER_POST", 30);
  static readonly IMAGE_OPTIMIZE_TRIGGER_BYTES = envNum(
    "NEXT_PUBLIC_IMAGE_OPTIMIZE_TRIGGER_BYTES",
    2.5 * 1024 * 1024,
  );
  static readonly IMAGE_OPTIMIZE_TRIGGER_LONGSIDE = envNum(
    "NEXT_PUBLIC_IMAGE_OPTIMIZE_TRIGGER_LONGSIDE",
    2800,
  );
  static readonly IMAGE_OPTIMIZE_TRIGGER_PIXELS = envNum(
    "NEXT_PUBLIC_IMAGE_OPTIMIZE_TRIGGER_PIXELS",
    6.0 * 1000 * 1000,
  );
  static readonly IMAGE_OPTIMIZE_TARGET_LONGSIDE = envNum(
    "NEXT_PUBLIC_IMAGE_OPTIMIZE_TARGET_LONGSIDE",
    2400,
  );
  static readonly IMAGE_OPTIMIZE_TARGET_PIXELS = envNum(
    "NEXT_PUBLIC_IMAGE_OPTIMIZE_TARGET_PIXELS",
    4.5 * 1000 * 1000,
  );
  static readonly IMAGE_ALLOWED_TYPES =
    "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
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
