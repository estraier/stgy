import { Config } from "../config";
import crypto from "crypto";

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
