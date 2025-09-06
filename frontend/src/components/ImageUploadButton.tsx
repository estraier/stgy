"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import Image from "next/image";
import { FiUploadCloud, FiX, FiAlertTriangle } from "react-icons/fi";
import { formatBytes } from "@/utils/format";
import { presignImageUpload, uploadToPresigned, finalizeImage } from "@/api/media";

type Props = {
  userId: string;
  maxCount: number;
  buttonLabel?: string;
  className?: string;
  onComplete?: () => Promise<void> | void;
  onCancel?: () => void;
};

type Meta = {
  mime: string;
  size: number;
  w: number;
  h: number;
};

type SelectedItem = {
  id: string;
  file: File;
  url: string;
  original: Meta;
  optimized?: Meta & { blob: Blob };
  processing: boolean;
  error?: string | null;
  optimizeChecked: boolean;
};

const TRIGGER_BYTES = 3_000_000;
const TRIGGER_LONGSIDE = 3000;
const TRIGGER_PIXELS = 8_000_000;
const TARGET_LONGSIDE = 2600;
const TARGET_PIXELS = 5_000_000;

export default function ImageUploadButton({
  userId,
  maxCount,
  buttonLabel = "Upload images",
  className = "",
  onComplete,
  onCancel,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => URL.revokeObjectURL(i.url));
      return [];
    });
    setGlobalError(null);
    setBusy(false);
    setOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      items.forEach((i) => URL.revokeObjectURL(i.url));
    };
  }, [items]);

  const pickFiles = useCallback(() => {
    setGlobalError(null);
    fileInputRef.current?.click();
  }, []);

  const handleFilesChosen = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list).slice(0, maxCount);
      const prepared: SelectedItem[] = [];

      for (const file of files) {
        const url = URL.createObjectURL(file);
        try {
          const original = await readMetaFromUrl(url, file.type || "");
          const suggestOn =
            original.size > TRIGGER_BYTES ||
            Math.max(original.w, original.h) > TRIGGER_LONGSIDE ||
            original.w * original.h > TRIGGER_PIXELS;

          prepared.push({
            id: cryptoRandomId(),
            file,
            url,
            original,
            processing: true,
            optimizeChecked: suggestOn,
          });
        } catch (e) {
          prepared.push({
            id: cryptoRandomId(),
            file,
            url,
            original: { mime: file.type || "image/*", size: file.size, w: 0, h: 0 },
            processing: false,
            error: (e as Error)?.message || "Failed to read image",
            optimizeChecked: false,
          });
        }
      }

      setItems(prepared);
      setOpen(true);

      void Promise.all(
        prepared.map(async (it) => {
          try {
            const out = await optimizeToWebFriendly(it.file, it.original);
            setItems((prev) =>
              prev.map((x) =>
                x.id === it.id ? { ...x, optimized: out, processing: false, error: null } : x,
              ),
            );
          } catch (e) {
            setItems((prev) =>
              prev.map((x) =>
                x.id === it.id
                  ? {
                      ...x,
                      processing: false,
                      error: (e as Error)?.message || "Optimization failed",
                    }
                  : x,
              ),
            );
          }
        }),
      );
    },
    [maxCount],
  );

  const toggleOptimize = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, optimizeChecked: !x.optimizeChecked } : x)),
    );
  }, []);

  const canUpload = useMemo(() => {
    if (busy) return false;
    if (items.length === 0) return false;
    return items.every((it) => !it.processing && !it.error);
  }, [items, busy]);

  const totalUploadBytes = useMemo(() => {
    let total = 0;
    for (const it of items) {
      total += it.optimizeChecked && it.optimized ? it.optimized.size : it.original.size;
    }
    return total;
  }, [items]);

  const onUpload = useCallback(async () => {
    if (!canUpload) return;
    setBusy(true);
    setGlobalError(null);
    try {
      for (const it of items) {
        const useOptimized = it.optimizeChecked && !!it.optimized;
        const blob = useOptimized ? it.optimized!.blob : it.file;
        const mime = useOptimized
          ? it.optimized!.mime
          : it.original.mime || it.file.type || "image/jpeg";
        const fileName = deriveUploadName(
          it.file.name,
          useOptimized ? it.optimized!.mime : it.original.mime,
        );

        const presigned = await presignImageUpload(userId, fileName, blob.size);
        const uploadBlob = blob instanceof File ? blob : new File([blob], fileName, { type: mime });
        await uploadToPresigned(presigned, uploadBlob, fileName, mime);
        await finalizeImage(userId, presigned.objectKey);
      }
      await onComplete?.();
      reset();
    } catch (e) {
      setGlobalError((e as Error)?.message || "Upload failed");
      setBusy(false);
    }
  }, [canUpload, items, onComplete, reset, userId]);

  const onCancelAll = useCallback(() => {
    if (busy) return;
    reset();
    onCancel?.();
  }, [busy, onCancel, reset]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFilesChosen(e.target.files)}
      />
      <button
        type="button"
        onClick={pickFiles}
        className={className || "px-3 py-1 rounded border bg-gray-300 text-gray-900"}
      >
        {buttonLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div
            className="bg-white w-full max-w-5xl max-h-[90vh] rounded shadow flex flex-col"
            role="dialog"
            aria-modal="true"
          >
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-semibold">Upload images</div>
              <button
                onClick={onCancelAll}
                className="p-2 rounded hover:bg-gray-100"
                aria-label="Close"
                disabled={busy}
              >
                <FiX />
              </button>
            </div>

            <div className="px-4 py-3 text-sm text-gray-700 flex items-center gap-3 border-b">
              <div className="flex items-center gap-2">
                <FiUploadCloud />
                <span>
                  {items.length} file{items.length === 1 ? "" : "s"} selected
                </span>
              </div>
              <span className="text-gray-400">•</span>
              <span>Total to upload: {formatBytes(totalUploadBytes)}</span>
              {!canUpload && (
                <span className="ml-auto text-[12px] text-gray-500">preparing images…</span>
              )}
            </div>

            {globalError && (
              <div className="px-4 py-2 text-sm text-red-600 border-b">{globalError}</div>
            )}

            <div className="p-4 overflow-auto">
              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="rounded border bg-white overflow-hidden hover:shadow-sm transition"
                  >
                    <div className="relative w-full aspect-video bg-gray-50">
                      <Image
                        src={it.url}
                        alt=""
                        fill
                        unoptimized
                        className="object-contain"
                        sizes="(max-width: 768px) 50vw, 33vw"
                      />
                    </div>

                    <div className="p-3 text-sm text-gray-800 space-y-2">
                      <div className="font-medium break-all">{it.file.name}</div>

                      <div className="text-[12px] text-gray-700">
                        <MetaLine meta={it.original} label="Original" />
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-blue-600"
                            checked={it.optimizeChecked}
                            onChange={() => toggleOptimize(it.id)}
                            disabled={it.processing}
                          />
                          <span className="text-[13px]">Optimize for Web</span>
                        </label>
                        {it.processing && (
                          <span className="text-[12px] text-gray-500">processing…</span>
                        )}
                        {it.error && (
                          <span className="text-[12px] text-red-600 flex items-center gap-1">
                            <FiAlertTriangle /> {it.error}
                          </span>
                        )}
                      </div>

                      <div
                        className={`text-[12px] ${it.optimizeChecked ? "text-gray-800" : "text-gray-400"}`}
                      >
                        <MetaLine
                          meta={
                            it.optimized ?? {
                              mime: "image/webp",
                              size: it.original.size,
                              w: it.original.w,
                              h: it.original.h,
                            }
                          }
                          label="Optimized"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
              <button
                className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50"
                onClick={onCancelAll}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 rounded border border-blue-700 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={onUpload}
                disabled={!canUpload}
              >
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MetaLine({ meta, label }: { meta: Meta; label: string }) {
  const geom = meta.w > 0 && meta.h > 0 ? ` • ${meta.w}×${meta.h}` : "";
  return (
    <div>
      <span className="text-gray-500">{label}:</span>{" "}
      <span className="font-mono">{meta.mime || "image/*"}</span> •{" "}
      <span className="font-mono">{formatBytes(meta.size)}</span>
      {geom}
    </div>
  );
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

async function readMetaFromUrl(url: string, mimeHint: string): Promise<Meta> {
  const img = document.createElement("img");
  img.decoding = "async";
  img.src = url;
  await img.decode().catch(
    () =>
      new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("decode failed"));
      }),
  );
  const resp = await fetch(url);
  const blob = await resp.blob();
  return {
    mime: blob.type || mimeHint || "image/*",
    size: blob.size,
    w: img.naturalWidth,
    h: img.naturalHeight,
  };
}

function computeResize(w: number, h: number) {
  const maxSideScale = TARGET_LONGSIDE / Math.max(w, h);
  const pixelScale = Math.sqrt(TARGET_PIXELS / (w * h));
  const scale = Math.min(1, maxSideScale, pixelScale);
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  return { outW, outH };
}

async function optimizeToWebFriendly(file: File, original: Meta): Promise<Meta & { blob: Blob }> {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    img.decoding = "async";
    img.src = srcUrl;
    await img.decode().catch(
      () =>
        new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("decode failed"));
        }),
    );

    const { outW, outH } = computeResize(original.w, original.h);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(img, 0, 0, outW, outH);

    let blob: Blob | null = await canvasToBlob(canvas, "image/webp", 0.82);
    let mime = "image/webp";
    if (!blob) {
      blob = await canvasToBlob(canvas, "image/jpeg", 0.86);
      mime = "image/jpeg";
      if (!blob) throw new Error("encoding failed");
    }

    return { mime, size: blob.size, w: outW, h: outH, blob };
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

function deriveUploadName(originalName: string, mime: string | undefined) {
  const base = originalName.replace(/\.[^.]+$/, "");
  const ext = mimeToExt(mime || "");
  return `${base}${ext}`;
}

function mimeToExt(mime: string) {
  switch ((mime || "").toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/heic":
      return ".heic";
    default:
      return ".img";
  }
}
