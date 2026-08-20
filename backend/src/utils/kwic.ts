import { countPseudoTokens, type KwicOptions } from "stgy-markdown";
import { decToHex, hexToDec } from "./format";

export const KWIC_OPTIONS: KwicOptions = {
  maxSegments: 4,
  contextSize: 30,
};

export const KWIC_MAX_IDS = 100;
export const KWIC_MAX_KEYWORDS = 32;
export const KWIC_MAX_KEYWORD_PSEUDO_TOKENS = 256;

function queryStrings(value: unknown, name: string): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as string[];
  }
  if (value === undefined) return [];
  throw new Error(`${name} must be a string`);
}

export function parseKwicQuery(query: Record<string, unknown>): {
  ids: string[];
  keywords: string[];
} {
  const rawIds = queryStrings(query.id, "id");
  const rawKeywords = queryStrings(query.keyword, "keyword");

  if (rawIds.length === 0) throw new Error("id is required");
  if (rawIds.length > KWIC_MAX_IDS) throw new Error("too many ids");
  if (rawKeywords.length === 0) throw new Error("keyword is required");
  if (rawKeywords.length > KWIC_MAX_KEYWORDS) throw new Error("too many keywords");

  const ids: string[] = [];
  const seenIds = new Set<string>();
  for (const rawId of rawIds) {
    let id: string;
    try {
      id = decToHex(hexToDec(rawId.trim()));
    } catch {
      throw new Error("invalid id");
    }
    if (!seenIds.has(id)) {
      seenIds.add(id);
      ids.push(id);
    }
  }

  const keywords = rawKeywords.map((keyword) => keyword.trim());
  if (keywords.some((keyword) => keyword.length === 0)) {
    throw new Error("invalid keyword");
  }
  if (keywords.some((keyword) => countPseudoTokens(keyword) > KWIC_MAX_KEYWORD_PSEUDO_TOKENS)) {
    throw new Error("keyword is too long");
  }

  return { ids, keywords };
}
