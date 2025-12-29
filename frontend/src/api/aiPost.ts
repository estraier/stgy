import type {
  AiPostSummary,
  AiPostSummaryPacket,
  SearchSeed,
  SearchSeedPacket,
  RecommendPostsInput,
  RecommendPostsInputPacket,
  Post,
} from "./models";
import { apiFetch, extractError } from "./client";

function decodeBase64ToUint8(b64: string): Uint8Array {
  const Buf = (globalThis as any).Buffer as any | undefined;
  if (Buf) return Uint8Array.from(Buf.from(b64, "base64"));

  const atobFn = (globalThis as any).atob as ((s: string) => string) | undefined;
  if (!atobFn) throw new Error("atob is not available");

  const bin = atobFn(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function encodeUint8ToBase64(u8: Uint8Array): string {
  const Buf = (globalThis as any).Buffer as any | undefined;
  if (Buf) return Buf.from(u8).toString("base64");

  const btoaFn = (globalThis as any).btoa as ((s: string) => string) | undefined;
  if (!btoaFn) throw new Error("btoa is not available");

  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    const sub = u8.subarray(i, i + CHUNK);
    let part = "";
    for (let j = 0; j < sub.length; j++) part += String.fromCharCode(sub[j]);
    bin += part;
  }
  return btoaFn(bin);
}

function base64ToInt8(b64: string): Int8Array {
  const u8 = decodeBase64ToUint8(b64);
  const i8 = new Int8Array(u8.length);
  for (let i = 0; i < u8.length; i++) i8[i] = u8[i] >= 128 ? u8[i] - 256 : u8[i];
  return i8;
}

function int8ToBase64(i8: Int8Array): string {
  const u8 = new Uint8Array(i8.length);
  for (let i = 0; i < i8.length; i++) u8[i] = (i8[i] + 256) & 0xff;
  return encodeUint8ToBase64(u8);
}

function toAiPostSummary(pkt: AiPostSummaryPacket): AiPostSummary {
  return {
    postId: pkt.postId,
    updatedAt: pkt.updatedAt,
    summary: pkt.summary,
    features: pkt.features ? base64ToInt8(pkt.features) : null,
    tags: pkt.tags,
  };
}

function toSearchSeed(pkt: SearchSeedPacket): SearchSeed {
  return {
    tags: pkt.tags,
    features: base64ToInt8(pkt.features),
    weight: pkt.weight,
  };
}

function toRecommendPostsPacket(
  input: RecommendPostsInput & { features?: Int8Array | null },
): RecommendPostsInputPacket {
  return {
    ...input,
    features:
      input.features === undefined
        ? undefined
        : input.features === null
          ? null
          : int8ToBase64(input.features),
  };
}

export async function getAiPostSummary(postId: string): Promise<AiPostSummary> {
  const res = await apiFetch(`/ai-posts/${postId}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  const pkt: AiPostSummaryPacket = await res.json();
  return toAiPostSummary(pkt);
}

export async function BuildSearchSeedForUser(params: {
  userId?: string;
  numClusters?: number;
} = {}): Promise<SearchSeed[]> {
  const search = new URLSearchParams();
  if (params.userId) search.append("userId", params.userId);
  if (params.numClusters !== undefined) search.append("numClusters", String(params.numClusters));

  const q = search.toString();
  const res = await apiFetch(`/ai-posts/search-seed${q ? `?${q}` : ""}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  const pkts: SearchSeedPacket[] = await res.json();
  return pkts.map(toSearchSeed);
}

export async function RecommendPostIds(
  input: RecommendPostsInput & { features?: Int8Array | null },
): Promise<string[]> {
  const body = toRecommendPostsPacket(input);
  const res = await apiFetch("/ai-posts/recommendations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function RecommendPosts(
  input: RecommendPostsInput & { features?: Int8Array | null },
): Promise<Post[]> {
  const body = toRecommendPostsPacket(input);
  const res = await apiFetch("/ai-posts/recommendations/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
