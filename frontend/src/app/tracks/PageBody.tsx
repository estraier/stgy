"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import type { TrackObject, TrackStorageMonthlyQuota } from "@/api/models";
import { deleteTrack, getTracksMonthlyQuota, listTracks } from "@/api/tracks";
import { Config } from "@/config";
import { formatBytes, formatDateTime } from "@/utils/format";
import { getTrackObjectKind, makeTrackMarkdown, restPathFromTrackKey } from "@/utils/tracks";
import TrackPreviewMap from "@/components/TrackPreviewMap";
import TrackUploadDialog, {
  TrackDialogFileItem,
  TrackUploadResult,
} from "@/components/TrackUploadDialog";

const PAGE_SIZE = Config.TRACKS_PAGE_SIZE || 30;

function parseIsoToDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function PageBody() {
  const status = useRequireLogin();
  const [items, setItems] = useState<TrackObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [previewObj, setPreviewObj] = useState<TrackObject | null>(null);
  const [quota, setQuota] = useState<TrackStorageMonthlyQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [dialogFiles, setDialogFiles] = useState<TrackDialogFileItem[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const userId = status.state === "authenticated" ? status.session.userId : undefined;
  const offset = useMemo(() => (page - 1) * PAGE_SIZE, [page]);

  const copyMarkdownFor = useCallback(async (track: TrackObject) => {
    try {
      await navigator.clipboard.writeText(makeTrackMarkdown(track));
      setCopiedKey(track.key);
      setTimeout(() => setCopiedKey((current) => (current === track.key ? null : current)), 1200);
    } catch {
      alert("Failed to copy to clipboard.");
    }
  }, []);

  const loadList = useCallback(async () => {
    if (status.state !== "authenticated" || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listTracks(userId, {
        offset,
        limit: PAGE_SIZE + 1,
      });
      setHasNext(data.length > PAGE_SIZE);
      setItems(data.slice(0, PAGE_SIZE));
    } catch (caught: unknown) {
      setItems([]);
      setHasNext(false);
      setError(caught instanceof Error ? caught.message : "Failed to load tracks.");
    } finally {
      setLoading(false);
    }
  }, [offset, status.state, userId]);

  const loadQuota = useCallback(async () => {
    if (status.state !== "authenticated" || !userId) return;
    setQuotaLoading(true);
    try {
      setQuota(await getTracksMonthlyQuota(userId));
    } catch {
      setQuota(null);
    } finally {
      setQuotaLoading(false);
    }
  }, [status.state, userId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  function openUploadPicker() {
    if (!userId) return;
    fileInputRef.current?.click();
  }

  function onFilesChosen(list: FileList | null) {
    if (!list || list.length === 0 || !userId) return;
    const maxCount = Config.MEDIA_TRACK_COUNT_LIMIT_ONCE || 12;
    const files = Array.from(list).slice(0, maxCount);
    const mapped = files.map((file) => ({
      id: cryptoRandomId(),
      file,
      name: file.name,
      type: file.type,
      size: file.size,
    }));
    setDialogFiles(mapped);
    setShowUpload(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function actuallyDelete(track: TrackObject) {
    if (status.state !== "authenticated" || !userId) return;
    setDeleting(true);
    try {
      const restPath = restPathFromTrackKey(track.key, userId);
      await deleteTrack(userId, restPath);
      setItems((current) =>
        current.filter((item) => !(item.bucket === track.bucket && item.key === track.key)),
      );
      setPreviewObj(null);
      setConfirmingDelete(false);
      await loadQuota();
    } catch (caught: unknown) {
      alert(caught instanceof Error ? caught.message : "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }

  if (status.state !== "authenticated") return null;

  const monthlyLimit = quota?.limitMonthlyBytes ?? null;
  const percentage =
    monthlyLimit && monthlyLimit > 0
      ? Math.min(100, Math.round(((quota?.bytesTotal ?? 0) / monthlyLimit) * 100))
      : null;

  return (
    <main className="max-w-5xl mx-auto mt-8 p-2 sm:p-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={Config.TRACK_ALLOWED_TYPES}
        multiple
        className="hidden"
        onChange={(event) => onFilesChosen(event.target.files)}
      />

      <div className="mb-4 flex items-start gap-4 flex-wrap">
        <div className="min-w-[260px]">
          <h1 className="text-xl font-semibold">Tracks</h1>
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
                    ({formatBytes(quota.bytesMasters)} + {formatBytes(quota.bytesPreviews)})
                  </span>
                  {monthlyLimit ? ` / ${formatBytes(monthlyLimit)}` : ""}
                </div>
                {monthlyLimit && (
                  <div className="mt-1 w-64 h-2 bg-gray-200 rounded overflow-hidden">
                    <div
                      className="h-2 bg-blue-400"
                      style={{ width: `${percentage}%` }}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percentage ?? 0}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={openUploadPicker}
            className="px-3 py-1 rounded border bg-gray-300 text-gray-900"
          >
            Upload tracks
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {loading && <div className="text-gray-500">Loading…</div>}
      {!loading && items.length === 0 && <div className="text-gray-500">No tracks.</div>}

      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {items.map((track) => {
          const lastModified = parseIsoToDate(track.lastModified);
          return (
            <li key={`${track.bucket}/${track.key}`} className="group relative">
              <div className="relative block w-full aspect-square overflow-hidden rounded border border-gray-300 bg-gray-50">
                <TrackPreviewMap
                  key={track.previewUrl}
                  src={track.previewUrl}
                  lazy
                  interactive={false}
                  controls={false}
                />
                <button
                  type="button"
                  className="absolute inset-0 z-[700] cursor-pointer"
                  onClick={() => {
                    setPreviewObj(track);
                    setConfirmingDelete(false);
                  }}
                  aria-label="Open track preview"
                  title="Open"
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <time className="text-[11px] text-gray-500">
                  {lastModified ? formatDateTime(lastModified) : "—"}
                </time>
                <button
                  className="text-[11px] px-1 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100"
                  onClick={() => copyMarkdownFor(track)}
                  title="Copy Markdown"
                >
                  {copiedKey === track.key ? "OK" : "MD"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex justify-center gap-4">
        <button
          className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setPage((current) => Math.max(current - 1, 1))}
          disabled={page === 1}
        >
          Prev
        </button>
        <span className="text-gray-800">Page {page}</span>
        <button
          className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setPage((current) => (hasNext ? current + 1 : current))}
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
            onClick={(event) => event.stopPropagation()}
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
                <TrackPreviewMap
                  key={`modal-${previewObj.previewUrl}`}
                  src={previewObj.previewUrl}
                />
              </div>
              <div className="text-sm text-gray-700 space-y-1">
                <div>
                  <span className="text-gray-500">Key:</span>{" "}
                  <span className="font-mono break-all">{previewObj.key}</span>
                </div>
                <div>
                  <span className="text-gray-500">Size:</span> {formatBytes(previewObj.size)}
                  <span className="ml-3 text-gray-500">Type:</span>{" "}
                  {getTrackObjectKind(previewObj) || previewObj.contentType || "unknown"}
                  <span className="ml-3 text-gray-500">Timestamp:</span>{" "}
                  {(() => {
                    const date = parseIsoToDate(previewObj.lastModified);
                    return date ? formatDateTime(date) : "—";
                  })()}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 justify-end items-center">
              {!confirmingDelete ? (
                <>
                  <button
                    className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
                    onClick={() => copyMarkdownFor(previewObj)}
                    title="Copy Markdown"
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
                  <span className="text-sm text-red-700 mr-1">Really delete this track?</span>
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

      {showUpload && dialogFiles && userId && (
        <TrackUploadDialog
          userId={userId}
          files={dialogFiles}
          maxCount={Config.MEDIA_TRACK_COUNT_LIMIT_ONCE || 12}
          onClose={() => {
            setShowUpload(false);
            setDialogFiles(null);
          }}
          onComplete={(results: TrackUploadResult[]) => {
            setShowUpload(false);
            setDialogFiles(null);
            if (results.some((result) => result.ok)) {
              setPage(1);
              void loadList();
              void loadQuota();
            }
          }}
        />
      )}
    </main>
  );
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
