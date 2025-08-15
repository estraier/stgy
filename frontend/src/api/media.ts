import { API_BASE_URL, apiFetch, extractError } from "./client";
import type { MediaObject, PresignedPostResult } from "./models";

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

export async function finalizeImage(
  userId: string,
  objectKey: string,
): Promise<MediaObject> {
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
  return `${API_BASE_URL}/media/${encodeURIComponent(userId)}/images/${encodePath(restPath)}`;
}

export async function deleteImage(userId: string, restPath: string): Promise<{ result: string }> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/images/${encodePath(restPath)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function fetchImageBinary(
  userId: string,
  restPath: string,
): Promise<Blob> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/images/${encodePath(restPath)}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.blob();
}

export async function uploadToPresigned(
  presigned: PresignedPostResult,
  file: Blob | ArrayBuffer | Uint8Array,
  filename?: string,
  contentType?: string,
): Promise<void> {
  const form = new FormData();
  Object.entries(presigned.fields).forEach(([k, v]) => form.append(k, v));
  const blob =
    file instanceof Blob
      ? file
      : new Blob(
          [
            file instanceof Uint8Array
              ? (file.buffer.slice(
                  file.byteOffset,
                  file.byteOffset + file.byteLength,
                ) as ArrayBuffer)
              : (file as ArrayBuffer),
          ],
          {
            type:
              contentType ||
              presigned.fields["Content-Type"] ||
              "application/octet-stream",
          },
        );
  form.append("file", blob, filename ?? "upload.bin");
  const res = await fetch(presigned.url, { method: "POST", body: form, credentials: "omit" });
  if (!(res.status === 200 || res.status === 201 || res.status === 204)) {
    const text = await res.text().catch(() => "");
    throw new Error(`upload failed: ${res.status} ${text}`);
  }
}

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
  return `${API_BASE_URL}/media/${encodeURIComponent(userId)}/profiles/${encodeURIComponent(slot)}`;
}

export async function deleteProfile(
  userId: string,
  slot: "avatar",
): Promise<{ result: string }> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/profiles/${encodeURIComponent(slot)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function fetchProfileBinary(
  userId: string,
  slot: "avatar",
): Promise<Blob> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/profiles/${encodeURIComponent(slot)}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.blob();
}
