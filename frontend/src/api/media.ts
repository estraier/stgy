import { Config } from "@/config";
import { apiFetch, extractError } from "./client";
import type { MediaObject, PresignedPostResult, StorageMonthlyQuota } from "./models";

function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export async function presignImageUpload(
  userId: string,
  filename: string,
  sizeBytes: number,
): Promise<PresignedPostResult> {
  const res = await apiFetch(`/media/${encodeURIComponent(userId)}/images/presigned`, {
    method: "POST",
    body: JSON.stringify({ filename, sizeBytes }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function finalizeImage(userId: string, objectKey: string): Promise<MediaObject> {
  const res = await apiFetch(`/media/${encodeURIComponent(userId)}/images/finalize`, {
    method: "POST",
    body: JSON.stringify({ key: objectKey }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listImages(
  userId: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<MediaObject[]> {
  const sp = new URLSearchParams();
  if (opts.offset !== undefined) sp.set("offset", String(opts.offset));
  if (opts.limit !== undefined) sp.set("limit", String(opts.limit));
  const q = sp.toString();
  const res = await apiFetch(`/media/${encodeURIComponent(userId)}/images${q ? `?${q}` : ""}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export function getImageUrl(userId: string, restPath: string): string {
  return `${Config.BACKEND_API_BASE_URL}/media/${encodeURIComponent(userId)}/images/${encodePath(restPath)}`;
}

export async function deleteImage(userId: string, restPath: string): Promise<{ result: string }> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/images/${encodePath(restPath)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function fetchImageBinary(userId: string, restPath: string): Promise<Blob> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/images/${encodePath(restPath)}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.blob();
}

export { uploadToPresigned } from "./storage";

export async function presignProfileUpload(
  userId: string,
  slot: "avatar",
  filename: string,
  sizeBytes: number,
): Promise<PresignedPostResult> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/profiles/${encodeURIComponent(slot)}/presigned`,
    {
      method: "POST",
      body: JSON.stringify({ filename, sizeBytes }),
    },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function finalizeProfile(
  userId: string,
  slot: "avatar",
  objectKey: string,
): Promise<MediaObject> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/profiles/${encodeURIComponent(slot)}/finalize`,
    {
      method: "POST",
      body: JSON.stringify({ key: objectKey }),
    },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export function getProfileUrl(userId: string, slot: "avatar"): string {
  return `${Config.BACKEND_API_BASE_URL}/media/${encodeURIComponent(userId)}/profiles/${encodeURIComponent(slot)}`;
}

export async function deleteProfile(userId: string, slot: "avatar"): Promise<{ result: string }> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/profiles/${encodeURIComponent(slot)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function fetchProfileBinary(userId: string, slot: "avatar"): Promise<Blob> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/profiles/${encodeURIComponent(slot)}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.blob();
}

export async function getImagesMonthlyQuota(
  userId: string,
  yyyymm?: string,
): Promise<StorageMonthlyQuota> {
  const sp = new URLSearchParams();
  if (yyyymm) sp.set("yyyymm", yyyymm);
  const q = sp.toString();
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/images/quota${q ? `?${q}` : ""}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function checkImageExistenceDirectly(
  userId: string,
  restPath: string,
): Promise<boolean> {
  const imagesPrefix = Config.STORAGE_S3_PUBLIC_URL_PREFIX.replace(
    /\{bucket\}/g,
    Config.MEDIA_BUCKET_IMAGES,
  );
  const url = `${imagesPrefix}${encodeURIComponent(userId)}/${restPath}`;
  const res = await fetch(url, { method: "HEAD" });
  return res.ok;
}
