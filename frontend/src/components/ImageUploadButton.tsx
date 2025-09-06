"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { formatBytes } from "@/utils/format";
import { presignImageUpload, uploadToPresigned, finalizeImage } from "@/api/media";
import { Config } from "@/config";

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

type Meta = {
  mime: string;
  size: number;
  w: number;
  h: number;
};

type SelectedItem = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;

  url?: string;
  original?: Meta;

  optimized?: Meta & { blob: Blob };

  processing: boolean;
  error?: string | null;
  optimizeChecked: boolean;
  status: "pending" | "optimizing" | "ready" | "uploading" | "done" | "error";
};

type Props = {
  userId: string;
  files: DialogFileItem[];
  maxCount: number;
  onClose: () => void;
  onComplete: (result: UploadResult[]) => void;
};

function shouldSuggestOptimize(m: Meta): boolean {
  return (
    m.size > Config.IMAGE_OPTIMIZE_TRIGGER_BYTES ||
    Math.max(m.w, m.h) > Config.IMAGE_OPTIMIZE_TRIGGER_LONGSIDE ||
    m.w * m.h > Config.IMAGE_OPTIMIZE_TRIGGER_PIXELS
  );
}

function computeResize(w: number, h: number) {
  const maxSideScale = Config.IMAGE_OPTIMIZE_TARGET_LONGSIDE / Math.max(w, h);
  const pixelScale = Math.sqrt(Config.IMAGE_OPTIMIZE_TARGET_PIXELS / (w * h));
  const scale = Math.min(1, maxSideScale, pixelScale);
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  return { outW, outH };
}

function mimeToExt(mime: string) {
  switch (mime.toLowerCase()) {
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

function changeExt(name: string, nextMime: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}${mimeToExt(nextMime)}`;
}

async function readMetaFromFile(file: File): Promise<Meta & { url: string }> {
  const url = URL.createObjectURL(file);
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
  return {
    url,
    mime: file.type || "image/*",
    size: file.size,
    w: img.naturalWidth,
    h: img.naturalHeight,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality),
  );
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

    let blob: Blob;
    try {
      blob = await canvasToBlob(canvas, "image/webp", 0.82);
      return { mime: "image/webp", size: blob.size, w: outW, h: outH, blob };
    } catch {
      blob = await canvasToBlob(canvas, "image/jpeg", 0.86);
      return { mime: "image/jpeg", size: blob.size, w: outW, h: outH, blob };
    }
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

export default function ImageUploadDialog({ userId, files, maxCount, onClose, onComplete }: Props) {
  const revokeRef = useRef<string[]>([]);
  const seed = useMemo(() => files.slice(0, maxCount), [files, maxCount]);

  const [items, setItems] = useState<SelectedItem[]>(
    seed.map((f) => ({
      id: f.id,
      file: f.file,
      name: f.name,
      type: f.type,
      size: f.size,
      processing: true,
      optimizeChecked: false,
      status: "pending",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const next: SelectedItem[] = [];
      for (const it of seed) {
        const meta = await readMetaFromFile(it.file).catch(() => null);
        if (cancelled) return;
        if (!meta) {
          next.push({
            id: it.id,
            file: it.file,
            name: it.name,
            type: it.type,
            size: it.size,
            processing: false,
            error: "Failed to read image",
            optimizeChecked: false,
            status: "ready",
          });
          continue;
        }
        revokeRef.current.push(meta.url);
        const original: Meta = { mime: meta.mime, size: meta.size, w: meta.w, h: meta.h };
        const suggestOn = shouldSuggestOptimize(original);

        const base: SelectedItem = {
          id: it.id,
          file: it.file,
          name: it.name,
          type: it.type,
          size: it.size,
          url: meta.url,
          original,
          processing: true,
          optimizeChecked: suggestOn,
          status: suggestOn ? "optimizing" : "ready",
        };
        next.push(base);
      }
      setItems(next);

      const updated: SelectedItem[] = [...next];
      await Promise.all(
        updated.map(async (it, idx) => {
          if (!it.original) return;
          if (!it.optimizeChecked) {
            updated[idx] = { ...it, processing: false, status: "ready" };
            return;
          }
          try {
            const out = await optimizeToWebFriendly(it.file, it.original);
            updated[idx] = {
              ...it,
              optimized: out,
              processing: false,
              status: "ready",
            };
          } catch {
            updated[idx] = { ...it, processing: false, status: "ready" };
          }
        }),
      );
      if (!cancelled) setItems(updated);
    })();

    return () => {
      cancelled = true;
    };
  }, [seed]);

  useEffect(() => {
    return () => {
      for (const url of revokeRef.current) URL.revokeObjectURL(url);
      revokeRef.current = [];
    };
  }, []);

  const toggleOptimize = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, optimizeChecked: !x.optimizeChecked } : x)),
    );
  }, []);

  const canUpload = useMemo(() => {
    if (busy) return false;
    if (items.length === 0) return false;
    return items.every((it) => it.status !== "optimizing" && !it.processing && !it.error);
  }, [items, busy]);

  const totalUploadBytes = useMemo(() => {
    let total = 0;
    for (const it of items) {
      const size =
        it.optimizeChecked && it.optimized ? it.optimized.size : (it.original?.size ?? it.size);
      total += size;
    }
    return total;
  }, [items]);

  const onUpload = useCallback(async () => {
    if (!canUpload) return;
    setBusy(true);
    setGlobalError(null);

    const results: UploadResult[] = [];
    try {
      const next = [...items];

      for (let i = 0; i < next.length; i++) {
        const it = next[i];
        next[i] = { ...it, status: "uploading" };
        setItems([...next]);

        try {
          const useOptimized = it.optimizeChecked && it.optimized;
          const blob = useOptimized ? it.optimized!.blob : it.file;
          const mime = useOptimized
            ? it.optimized!.mime
            : it.original?.mime || it.type || "application/octet-stream";
          const name = useOptimized
            ? changeExt(it.name, useOptimized ? it.optimized!.mime : mime)
            : it.name;

          const presigned = await presignImageUpload(userId, name, blob.size);
          const upBlob = blob instanceof File ? blob : new File([blob], name, { type: mime });
          await uploadToPresigned(presigned, upBlob, name, mime);
          const obj = await finalizeImage(userId, presigned.objectKey);

          next[i] = { ...next[i], status: "done" };
          setItems([...next]);
          results.push({ ok: true, objectKey: obj.key });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Upload failed";
          next[i] = { ...next[i], status: "error", error: msg };
          setItems([...next]);
          results.push({ ok: false, error: msg, name: it.name });
        }
      }

      onComplete(results);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [canUpload, items, onComplete, userId]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full max-w-5xl max-h-[90vh] rounded shadow flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Upload images</div>
          <button
            onClick={onClose}
            className="px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100"
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 text-sm text-gray-700 flex items-center gap-3 border-b">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="opacity-80">
              <path
                fill="currentColor"
                d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14C0 17.31 2.69 20 6 20H19C21.76 20 24 17.76 24 15C24 12.36 21.95 10.22 19.35 10.04M19 18H6C4.34 18 3 16.66 3 15C3 13.34 4.34 12 6 12H6.71C7.37 9.72 9.48 8 12 8C14.76 8 17 10.24 17 13H19C20.66 13 22 14.34 22 16C22 17.66 20.66 19 19 19V18Z"
              />
            </svg>
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
            {items.map((it) => {
              const original = it.original;
              return (
                <li
                  key={it.id}
                  className="rounded border bg-white overflow-hidden hover:shadow-sm transition"
                >
                  <div className="relative w-full aspect-video bg-gray-50">
                    {it.url ? (
                      <Image
                        src={it.url}
                        alt=""
                        fill
                        unoptimized
                        className="object-contain"
                        sizes="(max-width: 768px) 50vw, 33vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
                        No preview
                      </div>
                    )}
                    {(it.status === "optimizing" || it.processing) && (
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

                  <div className="p-3 text-sm text-gray-800 space-y-2">
                    <div className="font-medium break-all">{it.name}</div>

                    <div className="text-[12px] text-gray-700">
                      {original ? (
                        <MetaLine meta={original} label="Original" />
                      ) : (
                        <div className="text-gray-500">—</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-blue-600"
                          checked={it.optimizeChecked}
                          onChange={() => toggleOptimize(it.id)}
                          disabled={it.processing || it.status === "uploading"}
                        />
                        <span className="text-[13px]">Optimize for Web</span>
                      </label>
                      {it.error && (
                        <span className="text-[12px] text-red-600 break-all">{it.error}</span>
                      )}
                    </div>

                    <div
                      className={`text-[12px] ${
                        it.optimizeChecked ? "text-gray-800" : "text-gray-400"
                      }`}
                    >
                      <MetaLine
                        meta={
                          it.optimized ??
                          original ?? {
                            mime: it.type || "image/*",
                            size: it.size,
                            w: 0,
                            h: 0,
                          }
                        }
                        label="Optimized"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
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
    </div>
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
