"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { formatBytes } from "@/utils/format";
import { Config } from "@/config";
import {
  presignImageUpload,
  uploadToPresigned,
  finalizeImage,
  getImagesMonthlyQuota,
} from "@/api/media";

export type DialogFileItem = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
};

export type UploadResult =
  | { ok: true; objectKey: string }
  | { ok: false; error: string; name: string };

type SelectedItem = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
  decodable: boolean;
  width?: number;
  height?: number;
  optimize: boolean;
  needsAutoOptimize: boolean;
  optimized?: {
    blob: Blob;
    size: number;
    width: number;
    height: number;
  };
  status: "pending" | "optimizing" | "ready" | "uploading" | "done" | "error";
  error?: string;
};

type Props = {
  userId: string;
  files: DialogFileItem[];
  maxCount: number;
  onClose: () => void;
  onComplete: (result: UploadResult[]) => void;
};

function changeExtToWebp(name: string): string {
  return name.replace(/\.[^.]+$/, "") + ".webp";
}

async function readMeta(file: File): Promise<{
  decodable: boolean;
  width?: number;
  height?: number;
  previewUrl?: string;
}> {
  let objectUrl: string | undefined;
  try {
    objectUrl = URL.createObjectURL(file);
    if ("createImageBitmap" in window) {
      try {
        const bmp = await createImageBitmap(file);
        const out = {
          decodable: true,
          width: bmp.width,
          height: bmp.height,
          previewUrl: objectUrl,
        };
        bmp.close?.();
        return out;
      } catch {}
    }
    const img = document.createElement("img");
    img.decoding = "async";
    const meta = await new Promise<{ w?: number; h?: number; ok: boolean }>((resolve) => {
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, ok: true });
      img.onerror = () => resolve({ ok: false });
      img.src = objectUrl!;
    });
    if (meta.ok && meta.w && meta.h) {
      return { decodable: true, width: meta.w, height: meta.h, previewUrl: objectUrl };
    }
    return { decodable: false, previewUrl: objectUrl };
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return { decodable: false };
  }
}

function computeScale(w: number, h: number): number {
  const longSide = Math.max(w, h);
  const s1 = Config.IMAGE_OPTIMIZE_TARGET_LONGSIDE / longSide;
  const s2 = Math.sqrt(Config.IMAGE_OPTIMIZE_TARGET_PIXELS / (w * h));
  return Math.min(1, s1, s2);
}

type OffscreenCanvasCtor = new (width: number, height: number) => OffscreenCanvas;
function getOffscreenCanvasCtor(): OffscreenCanvasCtor | null {
  const g = globalThis as unknown as { OffscreenCanvas?: OffscreenCanvasCtor };
  return typeof g.OffscreenCanvas === "function" ? g.OffscreenCanvas : null;
}

async function rasterToWebp(
  file: File,
  srcW: number,
  srcH: number,
  quality = 0.8,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = computeScale(srcW, srcH);
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));

  let blob: Blob | null = null;
  const OSC = getOffscreenCanvasCtor();

  if (OSC) {
    const osc = new OSC(dw, dh);
    const ctx = osc.getContext("2d");
    if (ctx) {
      ctx.drawImage(bmp, 0, 0, dw, dh);
      if ("convertToBlob" in osc) {
        type EncodeOpts = { type?: string; quality?: number };
        const conv = (
          osc as OffscreenCanvas & {
            convertToBlob(options?: EncodeOpts): Promise<Blob>;
          }
        ).convertToBlob;
        blob = await conv.call(osc, { type: "image/webp", quality });
      }
    }
  }

  if (!blob) {
    const cv = document.createElement("canvas");
    cv.width = dw;
    cv.height = dh;
    const ctx2d = cv.getContext("2d");
    if (!ctx2d) throw new Error("canvas context not available");
    ctx2d.drawImage(bmp, 0, 0, dw, dh);
    blob = await new Promise<Blob>((resolve, reject) =>
      cv.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/webp",
        quality,
      ),
    );
  }

  bmp.close?.();
  return { blob, width: dw, height: dh };
}

function shouldAutoOptimize(meta: Pick<SelectedItem, "width" | "height" | "size">): boolean {
  const { width, height, size } = meta;
  const pixelCount = (width ?? 0) * (height ?? 0);
  const longSide = Math.max(width ?? 0, height ?? 0);
  return (
    longSide > Config.IMAGE_OPTIMIZE_TRIGGER_LONGSIDE ||
    pixelCount > Config.IMAGE_OPTIMIZE_TRIGGER_PIXELS ||
    size > Config.IMAGE_OPTIMIZE_TRIGGER_BYTES
  );
}

export default function ImageUploadDialog({ userId, files, maxCount, onClose, onComplete }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [items, setItems] = useState<SelectedItem[]>(
    files.slice(0, maxCount).map((f) => ({
      id: f.id,
      file: f.file,
      name: f.name,
      type: f.type,
      size: f.size,
      decodable: true,
      optimize: false,
      needsAutoOptimize: false,
      status: "pending",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bytesMonthlyUsed, setBytesMonthlyUsed] = useState<number | null>(null);
  const [bytesMonthlyLimit, setBytesMonthlyLimit] = useState<number | null>(null);

  const revokeQueue = useRef<string[]>([]);

  useEffect(() => {
    let mountedFlag = true;
    getImagesMonthlyQuota(userId)
      .then((q) => {
        if (!mountedFlag) return;
        setBytesMonthlyUsed(q.bytesTotal ?? 0);
        setBytesMonthlyLimit(q.limitMonthlyBytes ?? null);
      })
      .catch(() => {
        if (!mountedFlag) return;
        setBytesMonthlyUsed(null);
        setBytesMonthlyLimit(null);
      });
    return () => {
      mountedFlag = false;
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = [...items];
      for (let i = 0; i < next.length; i++) {
        const it = next[i];
        if (it.status !== "pending") continue;

        const meta = await readMeta(it.file);
        if (cancelled) return;

        if (meta.previewUrl) revokeQueue.current.push(meta.previewUrl);

        const needs = shouldAutoOptimize({
          width: meta.width,
          height: meta.height,
          size: it.size,
        });

        next[i] = {
          ...it,
          previewUrl: meta.previewUrl,
          decodable: meta.decodable,
          width: meta.width,
          height: meta.height,
          needsAutoOptimize: needs,
          optimize: needs,
          status: needs && meta.decodable ? "optimizing" : "ready",
        };
        setItems([...next]);

        if (needs && meta.decodable) {
          try {
            const out = await rasterToWebp(it.file, meta.width!, meta.height!);
            if (cancelled) return;
            next[i] = {
              ...next[i],
              optimized: {
                blob: out.blob,
                size: out.blob.size,
                width: out.width,
                height: out.height,
              },
              status: "ready",
            };
            setItems([...next]);
          } catch {
            next[i] = {
              ...next[i],
              status: "ready",
              optimized: undefined,
            };
            setItems([...next]);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      for (const url of revokeQueue.current) URL.revokeObjectURL(url);
      revokeQueue.current = [];
    };
  }, []);

  const projectedUploadBytes = useMemo(() => {
    return items.reduce((a, it) => {
      const size = it.optimize && it.optimized ? it.optimized.size : it.size;
      return a + size;
    }, 0);
  }, [items]);

  const quotaExceeded = useMemo(() => {
    if (!bytesMonthlyLimit || bytesMonthlyUsed == null) return false;
    return bytesMonthlyUsed + projectedUploadBytes > bytesMonthlyLimit;
  }, [bytesMonthlyLimit, bytesMonthlyUsed, projectedUploadBytes]);

  const canUpload = useMemo(() => {
    if (busy) return false;
    if (quotaExceeded) return false;
    return items.every((it) => it.status !== "optimizing");
  }, [busy, items, quotaExceeded]);

  const onUpload = useCallback(async () => {
    setBusy(true);
    setError(null);
    const results: UploadResult[] = [];
    const next = [...items];

    for (let idx = 0; idx < next.length; idx++) {
      const it = next[idx];
      next[idx] = { ...it, status: "uploading" };
      setItems([...next]);

      try {
        const useOptimized = it.optimize && it.optimized;
        const blob = useOptimized ? it.optimized!.blob : it.file;
        const name = useOptimized ? changeExtToWebp(it.name) : it.name;
        const type = useOptimized ? "image/webp" : it.type || "application/octet-stream";

        const presigned = await presignImageUpload(userId, name, blob.size);
        await uploadToPresigned(presigned, blob, name, type);
        const meta = await finalizeImage(userId, presigned.objectKey);

        next[idx] = { ...next[idx], status: "done" };
        setItems([...next]);
        results.push({ ok: true, objectKey: meta.key });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        next[idx] = { ...next[idx], status: "error", error: msg };
        setItems([...next]);
        results.push({ ok: false, error: msg, name: it.name });
      }
    }

    setBusy(false);
    onComplete(results);
  }, [items, onComplete, userId]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow max-w-[90vw] max-h-[90vh] p-3 w-full sm:w-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-3">
          <h2 className="text-base font-semibold break-all">Upload images</h2>
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
            Projected upload: <b>{formatBytes(projectedUploadBytes)}</b>
          </div>
          {bytesMonthlyLimit && (
            <div>
              Monthly:{" "}
              <b>
                {formatBytes(bytesMonthlyUsed ?? 0)} / {formatBytes(bytesMonthlyLimit)}
              </b>
            </div>
          )}
          {quotaExceeded && (
            <div className="text-red-600">Projected total exceeds your monthly quota.</div>
          )}
        </div>

        <div className="mt-3 overflow-auto max-h-[60vh]">
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {items.map((it) => (
              <li key={it.id} className="rounded border bg-white overflow-hidden">
                <div className="relative w-[70vw] sm:w-[44vw] md:w-[28vw] lg:w-[24vw] xl:w-[22vw] aspect-video bg-gray-50">
                  {it.previewUrl && it.decodable ? (
                    <Image
                      src={it.previewUrl}
                      alt=""
                      fill
                      unoptimized
                      className="object-contain"
                      sizes="(max-width: 640px) 70vw, (max-width: 1024px) 44vw, 28vw"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
                      No preview
                    </div>
                  )}
                  {(it.status === "optimizing" || it.status === "uploading") && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs">
                      {it.status === "optimizing" ? "Optimizing…" : "Uploading…"}
                    </div>
                  )}
                </div>

                <div className="p-3 text-sm text-gray-800 space-y-2 min-w-[260px]">
                  <div className="font-medium break-all">{it.name}</div>

                  <div className="text-[12px] text-gray-700">
                    <div>
                      <span className="text-gray-500">Original:</span>{" "}
                      <span className="font-mono">{it.type || "image/*"}</span> •{" "}
                      <span className="font-mono">{formatBytes(it.size)}</span>
                      {" • "}
                      {it.width && it.height ? `${it.width}×${it.height}` : "—"}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        checked={it.optimize}
                        onChange={() =>
                          setItems((prev) =>
                            prev.map((x) => (x.id === it.id ? { ...x, optimize: !x.optimize } : x)),
                          )
                        }
                        disabled={
                          !it.decodable || it.status === "optimizing" || it.status === "uploading"
                        }
                      />
                      <span className="text-[13px]">Optimize for Web</span>
                    </label>
                  </div>

                  <div className={`text-[12px] ${it.optimize ? "text-gray-800" : "text-gray-400"}`}>
                    <div>
                      <span className="text-gray-500">Optimized:</span>{" "}
                      <span className="font-mono">
                        {it.optimized ? "image/webp" : it.type || "image/*"}
                      </span>{" "}
                      •{" "}
                      <span className="font-mono">
                        {formatBytes(it.optimized ? it.optimized.size : it.size)}
                      </span>
                      {" • "}
                      {it.optimized
                        ? `${it.optimized.width}×${it.optimized.height}`
                        : it.width && it.height
                          ? `${it.width}×${it.height}`
                          : "—"}
                    </div>
                  </div>

                  {it.status === "error" && it.error && (
                    <div className="text-[11px] text-red-600 break-all">{it.error}</div>
                  )}
                </div>
              </li>
            ))}
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
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
