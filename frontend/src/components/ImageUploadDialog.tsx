"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { formatBytes } from "@/utils/format";
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
  defaultOptimize?: boolean;
  onClose: () => void;
  onComplete: (result: UploadResult[]) => void;
};

const LONGSIDE_TRIGGER = 3000;
const PIXELS_TRIGGER = 5_000_000;
const BYTES_TRIGGER = 1_000_000;

const LONGSIDE_TARGET = 2600;
const PIXELS_TARGET = 5_000_000;

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
  const s1 = LONGSIDE_TARGET / longSide;
  const s2 = Math.sqrt(PIXELS_TARGET / (w * h));
  return Math.min(1, s1, s2);
}

type OffscreenCanvasCtor = new (width: number, height: number) => OffscreenCanvas;
type OffscreenCanvasWithConvert = OffscreenCanvas & {
  convertToBlob: (options: { type: string; quality?: number }) => Promise<Blob>;
};

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

  let blob: Blob;
  const OffscreenCanvasImpl = (globalThis as unknown as { OffscreenCanvas?: OffscreenCanvasCtor })
    .OffscreenCanvas;

  if (OffscreenCanvasImpl) {
    const osc = new OffscreenCanvasImpl(dw, dh) as OffscreenCanvasWithConvert;
    const ctx = osc.getContext("2d");
    if (!ctx) {
      bmp.close?.();
      throw new Error("no 2d context");
    }
    ctx.drawImage(bmp, 0, 0, dw, dh);
    blob = await osc.convertToBlob({ type: "image/webp", quality });
  } else {
    const cv = document.createElement("canvas");
    cv.width = dw;
    cv.height = dh;
    const ctx = cv.getContext("2d");
    if (!ctx) {
      bmp.close?.();
      throw new Error("no 2d context");
    }
    ctx.drawImage(bmp, 0, 0, dw, dh);
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
  return longSide > LONGSIDE_TRIGGER || pixelCount > PIXELS_TRIGGER || size > BYTES_TRIGGER;
}

export default function ImageUploadDialog({
  userId,
  files,
  maxCount,
  defaultOptimize = true,
  onClose,
  onComplete,
}: Props) {
  const [items, setItems] = useState<SelectedItem[]>(
    files.slice(0, maxCount).map((f) => ({
      id: f.id,
      file: f.file,
      name: f.name,
      type: f.type,
      size: f.size,
      decodable: true,
      optimize: defaultOptimize,
      needsAutoOptimize: false,
      status: "pending",
    })),
  );
  const [globalOptimize, setGlobalOptimize] = useState<boolean | "mixed">("mixed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bytesMonthlyUsed, setBytesMonthlyUsed] = useState<number | null>(null);
  const [bytesMonthlyLimit, setBytesMonthlyLimit] = useState<number | null>(null);

  const revokeQueue = useRef<string[]>([]);

  useEffect(() => {
    let mounted = true;
    getImagesMonthlyQuota(userId)
      .then((q) => {
        if (!mounted) return;
        setBytesMonthlyUsed(q.bytesTotal ?? 0);
        setBytesMonthlyLimit(q.limitMonthlyBytes ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setBytesMonthlyUsed(null);
        setBytesMonthlyLimit(null);
      });
    return () => {
      mounted = false;
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
          optimize: needs || it.optimize,
          status: (needs || it.optimize) && meta.decodable ? "optimizing" : "ready",
        };
        setItems([...next]);

        if ((needs || it.optimize) && meta.decodable) {
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

      const all = next.every((x) => x.optimize);
      const none = next.every((x) => !x.optimize);
      setGlobalOptimize(all ? true : none ? false : "mixed");
    })();

    return () => {
      cancelled = true;
    };
  }, [items]);

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

  const toggleGlobalOptimize = useCallback(() => {
    const target = globalOptimize === true ? false : globalOptimize === false ? true : true;
    const next = items.map((it) => ({ ...it, optimize: target }));
    setItems(next);
    setGlobalOptimize(target);
  }, [items, globalOptimize]);

  const toggleItemOptimize = useCallback(
    (id: string) => {
      const next = items.map((it) => (it.id === id ? { ...it, optimize: !it.optimize } : it));
      setItems(next);
      const all = next.every((x) => x.optimize);
      const none = next.every((x) => !x.optimize);
      setGlobalOptimize(all ? true : none ? false : "mixed");
    },
    [items],
  );

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

    const queue = next.map((_, i) => i);
    let inFlight = 0;
    const MAX = 3;

    async function runOne(idx: number) {
      const it = next[idx];
      if (!it) return;

      next[idx] = { ...it, status: "uploading" };
      setItems([...next]);

      try {
        const useOptimized = it.optimize && it.optimized;
        const blob = useOptimized ? it.optimized!.blob : it.file;
        const name = useOptimized ? changeExtToWebp(it.name) : it.name;
        const type = useOptimized ? "image/webp" : it.type || "application/octet-stream";

        const presigned = await presignImageUpload(userId, name, blob.size);
        await uploadToPresigned(presigned, blob, name, type);
        await finalizeImage(userId, presigned.objectKey);

        next[idx] = { ...next[idx], status: "done" };
        setItems([...next]);
        results.push({ ok: true, objectKey: presigned.objectKey });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        next[idx] = { ...next[idx], status: "error", error: msg };
        setItems([...next]);
        results.push({ ok: false, error: msg, name: it.name });
      }
    }

    async function pump() {
      while (queue.length > 0) {
        if (inFlight >= MAX) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        const idx = queue.shift()!;
        inFlight++;
        runOne(idx).finally(() => {
          inFlight--;
        });
      }
      while (inFlight > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    try {
      await pump();
      onComplete(results);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg ?? "Upload failed.");
    } finally {
      setBusy(false);
    }
  }, [items, onComplete, userId]);

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow-xl max-w-[1000px] w-full max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Upload images</h2>
          <button
            className="px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="p-3 space-y-3 overflow-auto max-h-[70vh]">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-sm text-gray-700">
              Selected: <b>{items.length}</b> / {maxCount}
            </div>
            <div className="text-sm text-gray-700">
              Projected upload: <b>{formatBytes(projectedUploadBytes)}</b>
            </div>
            {bytesMonthlyLimit && (
              <div className="text-sm text-gray-700">
                Monthly:{" "}
                <b>
                  {formatBytes(bytesMonthlyUsed ?? 0)} / {formatBytes(bytesMonthlyLimit)}
                </b>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <label className="text-sm text-gray-800 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={globalOptimize === true}
                  ref={(el) => {
                    if (el) el.indeterminate = globalOptimize === "mixed";
                  }}
                  onChange={toggleGlobalOptimize}
                />
                Optimize all
              </label>
            </div>
          </div>

          {quotaExceeded && (
            <div className="text-sm text-red-600">Projected total exceeds your monthly quota.</div>
          )}

          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((it) => (
              <li key={it.id} className="border rounded overflow-hidden">
                <div className="relative w-full aspect-square bg-gray-50">
                  {it.previewUrl && it.decodable ? (
                    <Image
                      src={it.previewUrl}
                      alt=""
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="(max-width: 1024px) 50vw, 25vw"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
                      No preview
                    </div>
                  )}
                  {it.status === "optimizing" && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs">
                      Optimizing…
                    </div>
                  )}
                  {it.status === "uploading" && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs">
                      Uploading…
                    </div>
                  )}
                </div>
                <div className="p-2 text-[12px] text-gray-800 space-y-1">
                  <div className="truncate" title={it.name}>
                    {it.name}
                  </div>
                  <div className="text-gray-600">
                    {(it.optimize && it.optimized ? "image/webp" : it.type || "unknown") +
                      " • " +
                      formatBytes(it.optimize && it.optimized ? it.optimized.size : it.size) +
                      (it.optimize && it.optimized ? ` (→ ${formatBytes(it.size)})` : "")}
                    {" • "}
                    {it.width && it.height ? `${it.width}×${it.height}` : "—"}
                  </div>

                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={it.optimize}
                      disabled={
                        !it.decodable || it.status === "optimizing" || it.status === "uploading"
                      }
                      onChange={() => toggleItemOptimize(it.id)}
                    />
                    <span>Optimize for Web</span>
                    {it.needsAutoOptimize && (
                      <span className="ml-1 text-[10px] text-blue-600 border border-blue-300 px-1 rounded">
                        suggested
                      </span>
                    )}
                  </label>

                  {it.status === "error" && it.error && (
                    <div className="text-[11px] text-red-600 break-all">{it.error}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
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
                ? "border-gray-700 bg-blue-600 text-white hover:bg-blue-700"
                : "border-gray-300 bg-gray-200 text-gray-500 cursor-not-allowed"
            }`}
            onClick={onUpload}
            disabled={!canUpload}
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
