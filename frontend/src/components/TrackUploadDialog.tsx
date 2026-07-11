"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { finalizeTrack, getTracksMonthlyQuota, presignTrackUpload } from "@/api/tracks";
import { uploadToPresigned } from "@/api/storage";
import type { TrackStorageMonthlyQuota } from "@/api/models";
import { Config } from "@/config";
import { formatBytes } from "@/utils/format";
import {
  TRACK_UPLOAD_PREVIEW_MAX_POINTS,
  formatTrackPreviewDistance,
  formatTrackPreviewElapsedTime,
  formatTrackPreviewStartTime,
  makeTrackUploadPreview,
  type TrackUploadPreviewMetadata,
} from "@/utils/trackPreview";
import {
  getTrackFileKind,
  getTrackUploadContentType,
  getTrackUploadDialogGridClass,
} from "@/utils/tracks";
import TrackPreviewMap from "@/components/TrackPreviewMap";

export type TrackDialogFileItem = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
};

export type TrackUploadResult =
  | { ok: true; objectKey: string }
  | { ok: false; error: string; name: string };

type UploadStatus = "pending" | "uploading" | "finalizing" | "done" | "error";
type PreviewStatus = "loading" | "ready" | "error";

type SelectedItem = TrackDialogFileItem & {
  status: UploadStatus;
  error?: string;
  previewStatus: PreviewStatus;
  previewUrl?: string;
  previewError?: string;
  previewMetadata?: TrackUploadPreviewMetadata;
};

type SelectedItemPatch = Partial<
  Pick<
    SelectedItem,
    | "status"
    | "error"
    | "previewStatus"
    | "previewUrl"
    | "previewError"
    | "previewMetadata"
  >
>;

type Props = {
  userId: string;
  files: TrackDialogFileItem[];
  maxCount: number;
  onClose: () => void;
  onComplete: (results: TrackUploadResult[]) => void;
};

function createSelectedItem(file: TrackDialogFileItem): SelectedItem {
  const supported = Boolean(getTrackFileKind(file.name));
  return {
    ...file,
    status: "pending",
    previewStatus: supported ? "loading" : "error",
    previewError: supported ? undefined : "Only FIT and TRJGZ files are supported.",
  };
}

function TrackPreviewMetadata({ metadata }: { metadata: TrackUploadPreviewMetadata }) {
  const startTime = formatTrackPreviewStartTime(metadata);
  const distance = formatTrackPreviewDistance(metadata);
  const elapsedTime = formatTrackPreviewElapsedTime(metadata);

  if (!startTime && !distance && !elapsedTime) return null;

  return (
    <div className="overflow-x-auto whitespace-nowrap text-[15px] leading-5 text-gray-600">
      {startTime && <span>Start: {startTime}</span>}
      {distance && <span>{startTime ? " " : ""}Distance: {distance}</span>}
      {elapsedTime && <span>{startTime || distance ? " " : ""}Elapsed: {elapsedTime}</span>}
    </div>
  );
}

export default function TrackUploadDialog({ userId, files, maxCount, onClose, onComplete }: Props) {
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<SelectedItem[]>(files.map(createSelectedItem));
  const [quota, setQuota] = useState<TrackStorageMonthlyQuota | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => setMounted(true), []);

  const setItemState = useCallback((id: string, patch: SelectedItemPatch) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const previewUrls = previewUrlsRef.current;

    files.forEach((file) => {
      if (!getTrackFileKind(file.name)) return;

      void makeTrackUploadPreview(file.file)
        .then((preview) => {
          const url = URL.createObjectURL(
            new Blob([preview.json], {
              type: "application/json",
            }),
          );
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          previewUrls.add(url);
          setItemState(file.id, {
            previewStatus: "ready",
            previewUrl: url,
            previewError: undefined,
            previewMetadata: preview.metadata,
          });
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          const message = caught instanceof Error ? caught.message : String(caught);
          setItemState(file.id, {
            previewStatus: "error",
            previewError: message,
          });
        });
    });

    return () => {
      cancelled = true;
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.clear();
    };
  }, [files, setItemState]);

  useEffect(() => {
    let cancelled = false;
    void getTracksMonthlyQuota(userId)
      .then((value) => {
        if (!cancelled) setQuota(value);
      })
      .catch(() => {
        if (!cancelled) setQuota(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const selectedBytes = useMemo(() => items.reduce((sum, item) => sum + item.size, 0), [items]);
  const singleLimit = quota ? quota.limitSingleBytes : Config.MEDIA_TRACK_BYTE_LIMIT;
  const monthlyLimit = quota ? quota.limitMonthlyBytes : Config.MEDIA_TRACK_BYTE_LIMIT_PER_MONTH;
  const knownQuotaExceeded = Boolean(
    monthlyLimit && quota && quota.bytesTotal + selectedBytes > monthlyLimit,
  );
  const previewsLoading = items.some((item) => item.previewStatus === "loading");
  const invalidItems = useMemo(
    () =>
      items.filter(
        (item) =>
          !getTrackFileKind(item.name) ||
          Boolean(singleLimit && item.size > singleLimit) ||
          item.previewStatus === "error",
      ),
    [items, singleLimit],
  );
  const canUpload = !busy && !previewsLoading && invalidItems.length === 0 && !knownQuotaExceeded;
  const gridClass = useMemo(
    () => getTrackUploadDialogGridClass(items.length),
    [items.length],
  );

  const onUpload = useCallback(async () => {
    if (!canUpload) return;
    setBusy(true);
    setError(null);
    const results: TrackUploadResult[] = [];

    for (const item of items) {
      const kind = getTrackFileKind(item.name);
      if (!kind) {
        const message = "Only FIT and TRJGZ files can be uploaded.";
        setItemState(item.id, { status: "error", error: message });
        results.push({ ok: false, error: message, name: item.name });
        continue;
      }
      if (singleLimit && item.size > singleLimit) {
        const message = `File exceeds the single-file limit (${formatBytes(singleLimit)}).`;
        setItemState(item.id, { status: "error", error: message });
        results.push({ ok: false, error: message, name: item.name });
        continue;
      }

      try {
        setItemState(item.id, { status: "uploading", error: undefined });
        const contentType = getTrackUploadContentType(item.name);
        const presigned = await presignTrackUpload(userId, item.name, item.size);
        await uploadToPresigned(
          presigned,
          item.file,
          item.name,
          presigned.fields["Content-Type"] || contentType,
        );

        setItemState(item.id, { status: "finalizing" });
        const finalized = await finalizeTrack(userId, presigned.objectKey);
        setItemState(item.id, { status: "done" });
        results.push({ ok: true, objectKey: finalized.master.key });
      } catch (caught: unknown) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setItemState(item.id, { status: "error", error: message });
        results.push({ ok: false, error: message, name: item.name });
      }
    }

    setBusy(false);
    onComplete(results);
  }, [canUpload, items, onComplete, setItemState, singleLimit, userId]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow max-w-[90vw] max-h-[90vh] p-3 w-full sm:w-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-3">
          <h2 className="text-base font-semibold break-all">Upload tracks</h2>
          <button
            className="px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="mt-2 text-sm text-gray-700 flex items-center gap-3 flex-wrap">
          <div>
            Selected: <b>{items.length}</b> / {maxCount}
          </div>
          <div>
            Selected size: <b>{formatBytes(selectedBytes)}</b>
          </div>
          <div className="text-xs text-gray-500">
            Preview: up to {TRACK_UPLOAD_PREVIEW_MAX_POINTS.toLocaleString()} points
          </div>
          {quota && monthlyLimit && (
            <div>
              Monthly:{" "}
              <b>
                {formatBytes(quota.bytesTotal)} / {formatBytes(monthlyLimit)}
              </b>
            </div>
          )}
          {knownQuotaExceeded && (
            <div className="text-red-600">Selected files exceed the remaining monthly quota.</div>
          )}
          {invalidItems.length > 0 && (
            <div className="text-red-600">
              Some files are unsupported, too large, or could not be previewed.
            </div>
          )}
        </div>

        <div className="mt-3 overflow-auto max-h-[60vh]">
          <ul className={`grid ${gridClass} gap-3 justify-center`}>
            {items.map((item) => {
              const kind = getTrackFileKind(item.name);
              const oversized = Boolean(singleLimit && item.size > singleLimit);
              const statusText =
                item.status === "uploading"
                  ? "Uploading…"
                  : item.status === "finalizing"
                    ? "Validating and finalizing…"
                    : item.status === "done"
                      ? "Done"
                      : item.status === "error"
                        ? "Error"
                        : item.previewStatus === "loading"
                          ? "Preparing preview…"
                          : item.previewStatus === "error"
                            ? "Preview error"
                            : "Ready";
              return (
                <li key={item.id} className="rounded border bg-white overflow-hidden mx-auto">
                  <div className="relative w-[70vw] sm:w-[44vw] md:w-[28vw] lg:w-[24vw] xl:w-[22vw] aspect-video bg-gray-50 flex items-center justify-center">
                    {item.previewUrl ? (
                      <TrackPreviewMap key={item.previewUrl} src={item.previewUrl} />
                    ) : (
                      <div className="text-center px-3">
                        <div className="text-2xl font-semibold text-gray-500">{kind || "?"}</div>
                        <div
                          className={`mt-1 text-xs ${
                            item.previewStatus === "error" ? "text-red-600" : "text-gray-500"
                          }`}
                        >
                          {statusText}
                        </div>
                      </div>
                    )}
                    {(item.status === "uploading" || item.status === "finalizing") && (
                      <div className="absolute inset-0 z-[700] bg-white/70 flex items-center justify-center text-xs">
                        {statusText}
                      </div>
                    )}
                  </div>

                  <div className="p-3 text-sm text-gray-800 space-y-2 min-w-[260px]">
                    <div className="font-medium truncate max-w-60" title={item.name}>
                      {item.name}
                    </div>
                    {item.previewMetadata && (
                      <TrackPreviewMetadata metadata={item.previewMetadata} />
                    )}
                    <div className="text-[12px] text-gray-700">
                      <span className="font-mono">{kind || "Unsupported"}</span> •{" "}
                      <span
                        className={`font-mono ${oversized ? "text-red-600 font-semibold" : ""}`}
                      >
                        {formatBytes(item.size)}
                      </span>
                      <span className="ml-2 text-gray-500">{statusText}</span>
                    </div>
                    {oversized && singleLimit && (
                      <div className="text-[11px] text-red-600">
                        Exceeds single-file limit ({formatBytes(singleLimit)}).
                      </div>
                    )}
                    {!kind && (
                      <div className="text-[11px] text-red-600">
                        Only FIT and TRJGZ files are supported.
                      </div>
                    )}
                    {item.previewStatus === "error" && item.previewError && (
                      <div className="text-[11px] text-red-600">{item.previewError}</div>
                    )}
                    {item.status === "error" && item.error && (
                      <div className="text-[11px] text-red-600">{item.error}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 justify-end items-center">
          {error && <div className="text-sm text-red-600 mr-auto">{error}</div>}
          <button
            className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className={`px-3 py-1 rounded border ${
              canUpload
                ? "border-blue-700 bg-blue-600 text-white hover:bg-blue-700"
                : "border-gray-300 bg-gray-200 text-gray-500 cursor-not-allowed"
            }`}
            onClick={onUpload}
            disabled={!canUpload}
          >
            {busy ? "Uploading…" : previewsLoading ? "Preparing previews…" : "Upload"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
