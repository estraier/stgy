import { apiFetch, extractError } from "./client";
import type {
  FinalizedTrack,
  PresignedPostResult,
  TrackObject,
  TrackStorageMonthlyQuota,
} from "./models";

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function presignTrackUpload(
  userId: string,
  filename: string,
  sizeBytes: number,
): Promise<PresignedPostResult> {
  const res = await apiFetch(`/media/${encodeURIComponent(userId)}/tracks/presigned`, {
    method: "POST",
    body: JSON.stringify({ filename, sizeBytes }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function finalizeTrack(userId: string, objectKey: string): Promise<FinalizedTrack> {
  const res = await apiFetch(`/media/${encodeURIComponent(userId)}/tracks/finalize`, {
    method: "POST",
    body: JSON.stringify({ key: objectKey }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function listTracks(
  userId: string,
  options: { offset?: number; limit?: number } = {},
): Promise<TrackObject[]> {
  const params = new URLSearchParams();
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/tracks${query ? `?${query}` : ""}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function getTracksMonthlyQuota(
  userId: string,
  yyyymm?: string,
): Promise<TrackStorageMonthlyQuota> {
  const params = new URLSearchParams();
  if (yyyymm) params.set("yyyymm", yyyymm);
  const query = params.toString();
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/tracks/quota${query ? `?${query}` : ""}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function deleteTrack(userId: string, restPath: string): Promise<{ result: string }> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/tracks/${encodePath(restPath)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function fetchTrackBinary(userId: string, restPath: string): Promise<Blob> {
  const res = await apiFetch(
    `/media/${encodeURIComponent(userId)}/tracks/${encodePath(restPath)}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.blob();
}
