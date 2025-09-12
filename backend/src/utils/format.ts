import { Config } from "../config";
import { Buffer } from "buffer";
import crypto, { randomBytes } from "crypto";
import * as scrypt from "scrypt-js";

export async function generatePasswordHash(text: string): Promise<Uint8Array> {
  const [name, ...params] = Config.PASSWORD_CONFIG.split(":");
  if (name === "md5" || name === "sha256") {
    if (params.length !== 1) {
      throw new Error(`${name}: bad params: ${params}`);
    }
    const saltLen = parseInt(params[0]);
    const saltBytes = Buffer.from(randomBytes(saltLen));
    const combined = Buffer.concat([Buffer.from(text, "utf8"), saltBytes]);
    const hash = crypto.createHash(name);
    hash.update(combined);
    const hashBytes = hash.digest();
    return Buffer.concat([hashBytes, saltBytes]);
  }
  if (name === "scrypt") {
    if (params.length != 5) throw new Error(`${name}: bad params: ${params}`);
    const saltLen = parseInt(params[0]);
    const coreLen = parseInt(params[1]);
    const cost = parseInt(params[2]);
    const round = parseInt(params[3]);
    const parallelism = parseInt(params[4]);
    const passwordBytes = Buffer.from(text, "utf8");
    const saltBytes = Buffer.from(randomBytes(saltLen));
    const hashBytes = await scrypt.scrypt(
      passwordBytes,
      saltBytes,
      cost,
      round,
      parallelism,
      coreLen,
    );
    return Buffer.concat([hashBytes, saltBytes]);
  }
  throw new Error(`unknown algorithm: ${name}`);
}

export async function checkPasswordHash(text: string, hash: Uint8Array): Promise<boolean> {
  const hashBuffer = Buffer.from(hash);
  const [name, ...params] = Config.PASSWORD_CONFIG.split(":");
  if (name === "md5" || name === "sha256") {
    if (params.length !== 1) {
      throw new Error(`${name}: bad params: ${params}`);
    }
    const hashLen = name === "md5" ? 16 : 32;
    const storedHashBytes = hashBuffer.subarray(0, hashLen);
    const storedSaltBytes = hashBuffer.subarray(hashLen);
    const combined = Buffer.concat([Buffer.from(text, "utf8"), storedSaltBytes]);
    const derivedHashBytes = crypto.createHash(name).update(combined).digest();
    return storedHashBytes.equals(derivedHashBytes);
  }
  if (name === "scrypt") {
    if (params.length !== 5) {
      throw new Error(`${name}: bad params: ${params}`);
    }
    const coreLen = parseInt(params[1], 10);
    const cost = parseInt(params[2], 10);
    const round = parseInt(params[3], 10);
    const parallelism = parseInt(params[4], 10);
    const hashLen = coreLen;
    const storedHashBytes = hashBuffer.subarray(0, hashLen);
    const storedSaltBytes = hashBuffer.subarray(hashLen);
    const passwordBytes = Buffer.from(text, "utf8");
    const derivedHashBytes = await scrypt.scrypt(
      passwordBytes,
      storedSaltBytes,
      cost,
      round,
      parallelism,
      coreLen,
    );
    return Buffer.from(derivedHashBytes).equals(storedHashBytes);
  }
  throw new Error(`unknown algorithm: ${name}`);
}

export function bytesToHex(ary: Uint8Array): string {
  return Buffer.from(ary).toString("hex");
}

export function hexToBytes(str: string): Uint8Array | null {
  const normalizedStr = str.replace(/[^0-9a-fA-F]/g, "");
  if (normalizedStr.length % 2 !== 0) {
    return null;
  }
  try {
    const buffer = Buffer.from(normalizedStr, "hex");
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

export function hexToDec(hex: string): string {
  const s = String(hex).trim();
  if (!/^(?:0x)?[0-9a-fA-F]{1,16}$/.test(s)) {
    throw new Error("invalid hex string");
  }
  const normalized = s.replace(/^0x/i, "");
  return BigInt("0x" + normalized).toString();
}

export function hexArrayToDec(arr: string[]): string[] {
  return arr.map(hexToDec);
}

export function decToHex(dec: unknown): string {
  if (dec === null || dec === undefined) throw new Error("invalid decimal value");
  const n = BigInt(String(dec));
  if (n < 0) throw new Error("negative id is not allowed");
  const hex = n.toString(16).toUpperCase();
  if (hex.length > 16) throw new Error("value exceeds 64-bit range");
  return hex.padStart(16, "0");
}

export function generateVerificationCode(): string {
  if (Config.TEST_SIGNUP_CODE.length > 0) {
    return Config.TEST_SIGNUP_CODE;
  }
  return Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
}

export function validateEmail(email: string): boolean {
  return /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
    email,
  );
}

export function normalizeEmail(input: string): string {
  let s = input.toLowerCase().trim();
  return s;
}

export function normalizeText(input: string | undefined | null): string | undefined | null {
  if (!input) return input;
  let s = input.normalize("NFC");
  return s;
}

export function normalizeOneLiner(input: string | undefined | null): string | undefined | null {
  if (!input) return input;
  let s = input.normalize("NFC");
  s = s.replace(/\s+/g, " ");
  s = s.trim();
  return s;
}

export function normalizeMultiLines(input: string | undefined | null): string | undefined | null {
  if (!input) return input;
  let s = input.normalize("NFC");
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/ +\n/g, "\n");
  s = s.replace(/\n+$/, "");
  return s;
}

export function parseBoolean(input: string | undefined | null, defaultValue = false): boolean {
  if (!input) return defaultValue;
  const s = input.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return defaultValue;
}

export function maskEmailByHash(email: string): string {
  const hash = crypto.createHash("sha256").update(email).digest();
  const hashInt = BigInt("0x" + hash.toString("hex"));
  const base36 = hashInt.toString(36);
  const alpha = base36
    .replace(/[^a-z]/g, "")
    .padEnd(2, "z")
    .slice(0, 2);
  const num = base36
    .replace(/[^0-9]/g, "")
    .padEnd(8, "0")
    .slice(0, 8);
  const domains = [".com", ".net", ".org", ".gov", ".mil", ".int", ".info", ".biz", ".pro", ".jp"];
  const domain = domains[Number(hashInt % BigInt(domains.length))];
  return `${alpha}${num}@example${domain}`;
}

export function snakeToCamel<T = Record<string, unknown>>(obj: unknown): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => snakeToCamel(item)) as unknown as T;
  }
  if (typeof Buffer !== "undefined" && obj instanceof Buffer) {
    return obj as T;
  }
  if (obj instanceof Date) {
    return obj as T;
  }
  if (obj && typeof obj === "object") {
    const n: Record<string, unknown> = {};
    for (const k of Object.keys(obj as object)) {
      const key = k.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      n[key] = snakeToCamel((obj as Record<string, unknown>)[k]);
    }
    return n as T;
  }
  return obj as T;
}

export function escapeForLike(input: string) {
  return input.replace(/[\\%_]/g, "\\$&");
}
