export class Config {
  static readonly BACKEND_API_BASE_URL = envStr("NEXT_PUBLIC_BACKEND_API_BASE_URL", "http://localhost:3001");
  static readonly STORAGE_S3_PUBLIC_BASE_URL = envStr(
    "NEXT_PUBLIC_S3_PUBLIC_BASE_URL",
    "http://localhost:9000",
  );
  static readonly STORAGE_S3_BUCKET_PREFIX = envStr(
    "NEXT_PUBLIC_S3_BUCKET_PREFIX",
    "fakebook",
  );
  static readonly MEDIA_BUCKET_IMAGES = Config.STORAGE_S3_BUCKET_PREFIX + "-images";
  static readonly MEDIA_BUCKET_PROFILES = Config.STORAGE_S3_BUCKET_PREFIX + "-profiles";
  static readonly MEDIA_IMAGE_BYTE_LIMIT = envNum(
    "NEXT_PUBLIC_MEDIA_IMAGE_BYTE_LIMIT",
    10 * 1024 * 1024,
  );
  static readonly MEDIA_AVATAR_BYTE_LIMIT = envNum(
    "NEXT_PUBLIC_MEDIA_AVATAR_BYTE_LIMIT",
    1 * 1024 * 1024,
  );
  static readonly POSTS_PAGE_SIZE = envNum("NEXT_PUBLIC_POSTS_PAGE_SIZE", 20);
  static readonly USERS_PAGE_SIZE = envNum("NEXT_PUBLIC_USERS_PAGE_SIZE", 20);
  static readonly IMAGES_PAGE_SIZE = envNum("NEXT_PUBLIC_IMAGES_PAGE_SIZE", 30);
};

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
