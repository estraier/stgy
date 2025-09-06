"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import type { MediaObject, StorageMonthlyQuota } from "@/api/models";
import { listImages, deleteImage, getImagesMonthlyQuota } from "@/api/media";
import { formatDateTime, formatBytes } from "@/utils/format";
import { Config } from "@/config";
import ImageUploadButton from "@/components/ImageUploadButton";

const PAGE_SIZE = 30;

function parseIsoToDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
function restPathFromKey(key: string, uid: string): string {
  const needle = `${uid}/`;
  const i = key.indexOf(needle);
  return i >= 0 ? key.slice(i + needle.length) : key;
}

export default function PageBody() {
  const status = useRequireLogin();
  const [items, setItems] = useState<MediaObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [previewObj, setPreviewObj] = useState<MediaObject | null>(null);
  const [quota, setQuota] = useState<StorageMonthlyQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const userId = status.state === "authenticated" ? status.session.userId : undefined;
  const offset = useMemo(() => (page - 1) * PAGE_SIZE, [page]);

  const copyMarkdownFor = useCallback(async (key: string) => {
    const imageUrl = "/images/" + key;
    try {
      await navigator.clipboard.writeText(`![](${imageUrl})`);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {
      alert("Failed to copy to clipboard.");
    }
  }, []);

  const loadList = useCallback(async () => {
    if (status.state !== "authenticated" || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listImages(userId, { offset, limit: PAGE_SIZE + 1 });
      setHasNext(data.length > PAGE_SIZE);
      setItems(data.slice(0, PAGE_SIZE));
    } catch (e: unknown) {
      setItems([]);
      setHasNext(false);
      setError(e instanceof Error ? e.message : "Failed to load images.");
    } finally {
      setLoading(false);
    }
  }, [status.state, userId, offset]);

  const loadQuota = useCallback(async () => {
    if (status.state !== "authenticated" || !userId) return;
    setQuotaLoading(true);
    try {
      const q = await getImagesMonthlyQuota(userId);
      setQuota(q);
    } catch {
      setQuota(null);
    } finally {
      setQuotaLoading(false);
    }
  }, [status.state, userId]);

  useEffect(() => {
    loadList();
  }, [loadList]);
  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  async function actuallyDelete(obj: MediaObject) {
    if (status.state !== "authenticated" || !userId) return;
    setDeleting(true);
    try {
      const restPath = restPathFromKey(obj.key, userId);
      await deleteImage(userId, restPath);
      setItems((prev) => prev.filter((x) => !(x.bucket === obj.bucket && x.key === obj.key)));
      setPreviewObj(null);
      setConfirmingDelete(false);
      await loadQuota();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }

  if (status.state !== "authenticated") return null;

  const monthlyLimit = quota?.limitMonthlyBytes ?? null;
  const pct =
    monthlyLimit && monthlyLimit > 0
      ? Math.min(100, Math.round((quota!.bytesTotal / monthlyLimit) * 100))
      : null;

  return (
    <main className="max-w-5xl mx-auto mt-8 p-2 sm:p-4">
      <div className="mb-4 flex items-start gap-4 flex-wrap">
        <div className="min-w-[260px]">
          <h1 className="text-xl font-semibold">Images</h1>
          <div className="mt-2 text-sm text-gray-700">
            {quotaLoading && <span className="text-gray-400">Loading quota…</span>}
            {!quotaLoading && quota && (
              <div className="space-y-1">
                <div>
                  Month:{" "}
                  <span className="font-mono">
                    {quota.yyyymm.replace(/^(\d{4})(\d{2})$/, "$1-$2")}
                  </span>
                </div>
                <div>
                  Total: <b>{formatBytes(quota.bytesTotal)}</b>
                  <span className="pl-1 text-xs text-gray-500">
                    ({formatBytes(quota.bytesMasters)} + {formatBytes(quota.bytesThumbs)})
                  </span>
                  {monthlyLimit ? ` / ${formatBytes(monthlyLimit)}` : ""}
                </div>
                {monthlyLimit && (
                  <div className="mt-1 w-64 h-2 bg-gray-200 rounded overflow-hidden">
                    <div
                      className="h-2 bg-blue-400"
                      style={{ width: `${pct}%` }}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct ?? 0}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ImageUploadButton
            userId={userId!}
            maxCount={Config.MEDIA_IMAGE_COUNT_LIMIT_ONCE ?? 10}
            buttonLabel="Upload images"
            className="px-3 py-1 rounded border transition bg-gray-300 text-gray-900 border-gray-700 hover:bg-gray-400"
            onComplete={async () => {
              setPage(1);
              await loadList();
              await loadQuota();
            }}
            onCancel={() => {}}
          />
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {loading && <div className="text-gray-500">Loading…</div>}
      {!loading && items.length === 0 && <div className="text-gray-500">No images.</div>}

      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {items.map((obj) => {
          const lm = parseIsoToDate(obj.lastModified);
          return (
            <li key={`${obj.bucket}/${obj.key}`} className="group relative">
              <button
                className="relative block w-full aspect-square overflow-hidden rounded border border-gray-300 bg-gray-50"
                onClick={() => {
                  setPreviewObj(obj);
                  setConfirmingDelete(false);
                }}
                title="Open"
              >
                <Image
                  src={obj.publicUrl}
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                />
              </button>
              <div className="mt-1 flex items-center justify-between gap-2">
                <time className="text-[11px] text-gray-500">{lm ? formatDateTime(lm) : "—"}</time>
                <button
                  className="text-[11px] px-1 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100"
                  onClick={() => copyMarkdownFor(obj.key)}
                  title="Copy Markdown"
                >
                  {copiedKey === obj.key ? "OK" : "MD"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex justify-center gap-4">
        <button
          className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setPage((p) => Math.max(p - 1, 1))}
          disabled={page === 1}
        >
          Prev
        </button>
        <span className="text-gray-800">Page {page}</span>
        <button
          className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setPage((p) => (hasNext ? p + 1 : p))}
          disabled={!hasNext}
        >
          Next
        </button>
      </div>

      {previewObj && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setPreviewObj(null);
            setConfirmingDelete(false);
          }}
        >
          <div
            className="bg-white rounded shadow max-w-[90vw] max-h-[90vh] p-3 w-full sm:w-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3">
              <h2 className="text-base font-semibold break-all">Preview</h2>
              <button
                className="px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100"
                onClick={() => {
                  setPreviewObj(null);
                  setConfirmingDelete(false);
                }}
              >
                Close
              </button>
            </div>

            <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr,260px] gap-3">
              <div className="relative w-[85vw] h-[70vh] sm:w-[70vw]">
                <Image
                  src={previewObj.publicUrl}
                  alt=""
                  fill
                  unoptimized
                  className="object-contain"
                  sizes="(max-width: 1024px) 85vw, 70vw"
                />
              </div>
              <div className="text-sm text-gray-700 space-y-1">
                <div>
                  <span className="text-gray-500">Key:</span>{" "}
                  <span className="font-mono break-all">{previewObj.key}</span>
                </div>
                <div>
                  <span className="text-gray-500">Size:</span> {formatBytes(previewObj.size)}
                </div>
                <div>
                  <span className="text-gray-500">Type:</span> {previewObj.contentType || "unknown"}
                </div>
                <div>
                  <span className="text-gray-500">Last Modified:</span>{" "}
                  {(() => {
                    const d = parseIsoToDate(previewObj.lastModified);
                    return d ? formatDateTime(d) : "—";
                  })()}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 justify-end items-center">
              {!confirmingDelete ? (
                <>
                  <button
                    className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
                    onClick={() => copyMarkdownFor(previewObj.key)}
                    title="Copy Markdown (![](key))"
                  >
                    {copiedKey === previewObj.key ? "Copied!" : "Copy Markdown"}
                  </button>
                  <button
                    className="px-3 py-1 rounded border border-red-300 text-red-700 bg-white hover:bg-red-50"
                    onClick={() => setConfirmingDelete(true)}
                    title="Delete"
                  >
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <span className="text-sm text-red-700 mr-1">Really delete this image?</span>
                  <button
                    className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1 rounded border border-red-400 text-white bg-red-500 hover:bg-red-600 disabled:opacity-60"
                    onClick={() => actuallyDelete(previewObj)}
                    disabled={deleting}
                  >
                    {deleting ? "Deleting…" : "Delete permanently"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
