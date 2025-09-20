"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import NextImage from "next/image";
import { createPortal } from "react-dom";
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
  forceOptimize: boolean;
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

const PASS_THROUGH_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PASS_THROUGH_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);
function isPassThroughType(name: string, type: string): boolean {
  const t = (type || "").toLowerCase();
  if (PASS_THROUGH_MIMES.has(t)) return true;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return PASS_THROUGH_EXTS.has(ext);
}

function isSvg(name: string, type: string) {
  const t = (type || "").toLowerCase();
  if (t === "image/svg+xml") return true;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return ext === "svg";
}

function isTiff(name: string, type: string) {
  const t = (type || "").toLowerCase();
  if (t === "image/tiff" || t === "image/tif") return true;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return ext === "tif" || ext === "tiff";
}

function parseSvgSize(svg: string): { w: number; h: number } | null {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") return null;
    const parseLen = (v?: string | null) => {
      if (!v) return NaN;
      const m = String(v)
        .trim()
        .match(/^([0-9.]+)(px|pt|pc|cm|mm|in|%)?$/i);
      if (!m) return NaN;
      const n = parseFloat(m[1]);
      return Number.isFinite(n) ? n : NaN;
    };
    let w = parseLen(svgEl.getAttribute("width"));
    let h = parseLen(svgEl.getAttribute("height"));
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      const vb = (svgEl.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      if (vb.length === 4 && vb.every((x) => Number.isFinite(x))) {
        const vbW = Math.max(1, Math.round(vb[2]));
        const vbH = Math.max(1, Math.round(vb[3]));
        w = Number.isFinite(w) ? w : vbW;
        h = Number.isFinite(h) ? h : vbH;
      }
    }
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    return { w: Math.round(w), h: Math.round(h) };
  } catch {
    return null;
  }
}

function normalizeSvg(svg: string, targetW: number, targetH: number): string {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") return svg;
    svgEl.setAttribute("width", String(targetW));
    svgEl.setAttribute("height", String(targetH));
    if (!svgEl.getAttribute("viewBox")) {
      svgEl.setAttribute("viewBox", `0 0 ${targetW} ${targetH}`);
    }
    const ser = new XMLSerializer();
    return ser.serializeToString(svgEl);
  } catch {
    return svg;
  }
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

async function decodeViaImg(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const ok = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!ok || !img.naturalWidth || !img.naturalHeight) {
      throw new Error("image decode failed");
    }
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function rasterizeSvgToWebp(
  file: File,
  quality = 0.8,
): Promise<{ blob: Blob; width: number; height: number }> {
  const svgText = await file.text();
  let size = parseSvgSize(svgText);
  if (!size) {
    const fallback = Math.max(1, Number(Config.IMAGE_OPTIMIZE_TARGET_LONGSIDE) || 1200);
    size = { w: fallback, h: fallback };
  }
  const normalizedSvg = normalizeSvg(svgText, size.w, size.h);
  const svgBlob = new Blob([normalizedSvg], { type: "image/svg+xml" });
  let w = size.w;
  let h = size.h;
  let source: CanvasImageSource | null = null;
  try {
    const bmp = await createImageBitmap(svgBlob);
    source = bmp;
    w = bmp.width || w;
    h = bmp.height || h;
  } catch {
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = document.createElement("img");
      img.decoding = "async";
      const ok = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
      });
      if (!ok) throw new Error("svg decode via <img> failed");
      source = img;
      w = img.naturalWidth || w;
      h = img.naturalHeight || h;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
  const scale = computeScale(w, h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  let blob: Blob | null = null;
  const OSC = getOffscreenCanvasCtor();
  if (OSC) {
    const osc = new OSC(dw, dh);
    const ctx = osc.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(source as CanvasImageSource, 0, 0, dw, dh);
    if ("convertToBlob" in osc) {
      type EncodeOpts = { type?: string; quality?: number };
      const conv = (osc as OffscreenCanvas & { convertToBlob(options?: EncodeOpts): Promise<Blob> })
        .convertToBlob;
      blob = await conv.call(osc, { type: "image/webp", quality });
    }
  }
  if (!blob) {
    const cv = document.createElement("canvas");
    cv.width = dw;
    cv.height = dh;
    const ctx2d = cv.getContext("2d");
    if (!ctx2d) throw new Error("2D context unavailable");
    ctx2d.drawImage(source as CanvasImageSource, 0, 0, dw, dh);
    blob = await new Promise<Blob>((resolve, reject) =>
      cv.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/webp",
        quality,
      ),
    );
  }
  if (!blob || !blob.size || !dw || !dh) {
    throw new Error("invalid optimized output");
  }
  (source as ImageBitmap)?.close?.();
  return { blob, width: dw, height: dh };
}

async function tiffToWebp(
  file: File,
  quality = 0.8,
): Promise<{ blob: Blob; width: number; height: number }> {
  const UTIF: typeof import("utif") = await import("utif");
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds || ifds.length === 0) throw new Error("TIFF decode failed: no IFD");
  UTIF.decodeImage(buf, ifds[0]);
  type TiffIFDSize = { width: number; height: number };
  const { width, height } = ifds[0] as TiffIFDSize;
  if (!width || !height) throw new Error("TIFF decode failed: invalid size");
  const rgba = UTIF.toRGBA8(ifds[0]);
  const scale = computeScale(width, height);
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  const sctx = src.getContext("2d");
  if (!sctx) throw new Error("2D context unavailable");
  const id = new ImageData(new Uint8ClampedArray(rgba), width, height);
  sctx.putImageData(id, 0, 0);
  const dst = document.createElement("canvas");
  dst.width = dw;
  dst.height = dh;
  const dctx = dst.getContext("2d");
  if (!dctx) throw new Error("2D context unavailable");
  dctx.drawImage(src, 0, 0, dw, dh);
  const blob: Blob = await new Promise((resolve, reject) =>
    dst.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/webp", quality),
  );
  return { blob, width: dw, height: dh };
}

async function rasterToWebp(
  file: File,
  srcW: number,
  srcH: number,
  quality = 0.8,
  name?: string,
  type?: string,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (isTiff(name || "", type || "")) {
    return tiffToWebp(file, quality);
  }
  if (isSvg(name || "", type || "")) {
    return rasterizeSvgToWebp(file, quality);
  }
  let source: CanvasImageSource | null = null;
  let w = srcW;
  let h = srcH;
  try {
    const bmp = await createImageBitmap(file);
    source = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    const img = await decodeViaImg(file);
    source = img;
    w = img.naturalWidth;
    h = img.naturalHeight;
  }
  const scale = computeScale(w, h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  let blob: Blob | null = null;
  const OSC = getOffscreenCanvasCtor();
  if (OSC) {
    const osc = new OSC(dw, dh);
    const ctx = osc.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.drawImage(source as CanvasImageSource, 0, 0, dw, dh);
    if ("convertToBlob" in osc) {
      type EncodeOpts = { type?: string; quality?: number };
      const conv = (osc as OffscreenCanvas & { convertToBlob(options?: EncodeOpts): Promise<Blob> })
        .convertToBlob;
      blob = await conv.call(osc, { type: "image/webp", quality });
    }
  }
  if (!blob) {
    const cv = document.createElement("canvas");
    cv.width = dw;
    cv.height = dh;
    const ctx2d = cv.getContext("2d");
    if (!ctx2d) throw new Error("2D context unavailable");
    ctx2d.drawImage(source as CanvasImageSource, 0, 0, dw, dh);
    blob = await new Promise<Blob>((resolve, reject) =>
      cv.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/webp",
        quality,
      ),
    );
  }
  if (!blob || !blob.size || !dw || !dh) {
    throw new Error("invalid optimized output");
  }
  (source as ImageBitmap)?.close?.();
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

  const SINGLE_LIMIT = Number(Config.MEDIA_IMAGE_BYTE_LIMIT || 0) || null;

  const [items, setItems] = useState<SelectedItem[]>(
    files.slice(0, maxCount).map((f) => {
      const pass = isPassThroughType(f.name, f.type);
      const overLimit = SINGLE_LIMIT ? f.size > SINGLE_LIMIT : false;
      const force = !pass || overLimit;
      return {
        id: f.id,
        file: f.file,
        name: f.name,
        type: f.type,
        size: f.size,
        decodable: true,
        optimize: force ? true : false,
        needsAutoOptimize: force,
        forceOptimize: force,
        status: "pending",
      };
    }),
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
      for (const f of files.slice(0, maxCount)) {
        const meta = await readMeta(f.file);
        if (cancelled) return;

        if (meta.previewUrl) revokeQueue.current.push(meta.previewUrl);

        const pass = isPassThroughType(f.name, f.type);
        const overLimit = SINGLE_LIMIT ? f.size > SINGLE_LIMIT : false;
        const force = !pass || overLimit;

        const needByThreshold = shouldAutoOptimize({
          width: meta.width,
          height: meta.height,
          size: f.size,
        });

        setItems((prev) =>
          prev.map((x) =>
            x.id === f.id
              ? {
                  ...x,
                  previewUrl: meta.previewUrl,
                  decodable: meta.decodable,
                  width: meta.width,
                  height: meta.height,
                  needsAutoOptimize: force ? true : needByThreshold,
                  forceOptimize: force,
                  status: "optimizing",
                  error: undefined,
                }
              : x,
          ),
        );

        try {
          const out = await rasterToWebp(
            f.file,
            meta.width ?? 0,
            meta.height ?? 0,
            0.8,
            f.name,
            f.type,
          );

          if (cancelled) return;

          const optimizedPreviewUrl = URL.createObjectURL(out.blob);
          revokeQueue.current.push(optimizedPreviewUrl);

          setItems((prev) =>
            prev.map((x) => {
              if (x.id !== f.id) return x;
              const isHalfOrLess = out.blob.size * 2 <= f.size;
              const auto = x.forceOptimize ? true : x.needsAutoOptimize || isHalfOrLess;
              return {
                ...x,
                previewUrl: x.previewUrl && x.decodable ? x.previewUrl : optimizedPreviewUrl,
                decodable: true,
                optimized: {
                  blob: out.blob,
                  size: out.blob.size,
                  width: out.width,
                  height: out.height,
                },
                needsAutoOptimize: auto,
                optimize: x.forceOptimize ? true : auto,
                status: "ready",
                error: undefined,
              };
            }),
          );
        } catch {
          setItems((prev) =>
            prev.map((x) =>
              x.id === f.id
                ? x.forceOptimize
                  ? {
                      ...x,
                      status: "error",
                      optimized: undefined,
                      error:
                        "This format requires optimization, but a WebP could not be produced. Please convert to JPEG/PNG/WebP and try again.",
                    }
                  : {
                      ...x,
                      status: "ready",
                      optimized: undefined,
                      optimize: false,
                    }
                : x,
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files, maxCount, SINGLE_LIMIT]);

  useEffect(() => {
    return () => {
      for (const url of revokeQueue.current) URL.revokeObjectURL(url);
      revokeQueue.current = [];
    };
  }, []);

  const effectiveUploadSize = useCallback((it: SelectedItem) => {
    return it.optimize && it.optimized ? it.optimized.size : it.size;
  }, []);

  const projectedUploadBytes = useMemo(() => {
    return items.reduce((a, it) => a + effectiveUploadSize(it), 0);
  }, [items, effectiveUploadSize]);

  const allOptimizingDone = useMemo(
    () => items.every((it) => it.status !== "optimizing" && it.status !== "pending"),
    [items],
  );

  const oversizedItems = useMemo(() => {
    if (!SINGLE_LIMIT) return [];
    if (!allOptimizingDone) return [];
    return items.filter((it) => effectiveUploadSize(it) > SINGLE_LIMIT);
  }, [items, SINGLE_LIMIT, effectiveUploadSize, allOptimizingDone]);

  const quotaExceeded = useMemo(() => {
    if (!allOptimizingDone) return false;
    if (!bytesMonthlyLimit || bytesMonthlyUsed == null) return false;
    return bytesMonthlyUsed + projectedUploadBytes > bytesMonthlyLimit;
  }, [bytesMonthlyLimit, bytesMonthlyUsed, projectedUploadBytes, allOptimizingDone]);

  const canUpload = useMemo(() => {
    if (busy || quotaExceeded) return false;
    if (oversizedItems.length > 0) return false;
    const anyOptim = items.some((it) => it.status === "optimizing");
    const anyReady = items.some((it) => it.status === "ready");
    return !anyOptim && anyReady;
  }, [busy, items, quotaExceeded, oversizedItems.length]);

  const onUpload = useCallback(async () => {
    setBusy(true);
    setError(null);
    const results: UploadResult[] = [];
    const next = [...items];

    for (let idx = 0; idx < next.length; idx++) {
      const it = next[idx];

      if (it.status === "error" || it.status === "optimizing") {
        results.push({ ok: false, error: it.error || "unavailable", name: it.name });
        continue;
      }

      if (SINGLE_LIMIT && effectiveUploadSize(it) > SINGLE_LIMIT) {
        const msg = `File exceeds the single-file limit (${formatBytes(SINGLE_LIMIT)}).`;
        next[idx] = { ...it, status: "error", error: msg };
        setItems([...next]);
        results.push({ ok: false, error: msg, name: it.name });
        continue;
      }

      let useOptimized = false;
      if (it.forceOptimize) {
        if (!it.optimized) {
          next[idx] = {
            ...it,
            status: "error",
            error:
              "This format requires optimization, but a converted image is not available. Please convert to JPEG/PNG/WebP and try again.",
          };
          setItems([...next]);
          results.push({ ok: false, error: next[idx].error!, name: it.name });
          continue;
        }
        useOptimized = true;
      } else {
        useOptimized = !!(it.optimize && it.optimized);
      }

      next[idx] = { ...it, status: "uploading" };
      setItems([...next]);

      try {
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
  }, [items, onComplete, userId, SINGLE_LIMIT, effectiveUploadSize]);

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
          {SINGLE_LIMIT && allOptimizingDone && oversizedItems.length > 0 && (
            <div className="text-red-600">
              {oversizedItems.length} file(s) exceed the single-file limit (
              {formatBytes(SINGLE_LIMIT)}).
            </div>
          )}
        </div>

        <div className="mt-3 overflow-auto max-h-[60vh]">
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {items.map((it) => {
              const effSize = effectiveUploadSize(it);
              const isOver = SINGLE_LIMIT ? effSize > SINGLE_LIMIT : false;
              const showOver = isOver && allOptimizingDone;
              return (
                <li key={it.id} className="rounded border bg-white overflow-hidden">
                  <div className="relative w-[70vw] sm:w-[44vw] md:w-[28vw] lg:w-[24vw] xl:w-[22vw] aspect-video bg-gray-50">
                    {it.previewUrl && it.decodable ? (
                      <NextImage
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

                    <div className="text-[12px] text-gray-700 space-y-1">
                      <div>
                        <span className="text-gray-500">Original:</span>{" "}
                        <span className="font-mono">{it.type || "image/*"}</span> •{" "}
                        <span className="font-mono">{formatBytes(it.size)}</span>
                        {" • "}
                        {it.width && it.height ? `${it.width}×${it.height}` : "—"}
                      </div>
                      {it.type?.toLowerCase() === "image/gif" && (
                        <div className="text-[11px] text-gray-500">
                          * Animated GIF will be uploaded as a still image (first frame).
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-blue-600"
                          checked={it.optimize}
                          onChange={() =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.id === it.id
                                  ? { ...x, optimize: x.forceOptimize ? true : !x.optimize }
                                  : x,
                              ),
                            )
                          }
                          disabled={
                            it.forceOptimize ||
                            it.status === "optimizing" ||
                            it.status === "uploading"
                          }
                        />
                        <span className="text-[13px]">
                          Optimize for Web{" "}
                          {it.forceOptimize && <span className="text-gray-500">(required)</span>}
                        </span>
                      </label>
                    </div>

                    <div
                      className={`text-[12px] ${it.optimize ? "text-gray-800" : "text-gray-400"}`}
                    >
                      <div>
                        <span className="text-gray-500">Optimized:</span>{" "}
                        <span className="font-mono">
                          {it.optimized ? "image/webp" : it.type || "image/*"}
                        </span>{" "}
                        •{" "}
                        <span
                          className={`font-mono ${showOver ? "text-red-600 font-semibold" : ""}`}
                        >
                          {formatBytes(effSize)}
                        </span>
                        {" • "}
                        {it.optimized
                          ? `${it.optimized.width}×${it.optimized.height}`
                          : it.width && it.height
                            ? `${it.width}×${it.height}`
                            : "—"}
                        {showOver && SINGLE_LIMIT && (
                          <div className="text-[11px] text-red-600 mt-0.5">
                            Exceeds single-file limit ({formatBytes(SINGLE_LIMIT)}).
                          </div>
                        )}
                      </div>
                    </div>

                    {it.status === "error" && it.error && (
                      <div className="text-[11px] text-red-600">{it.error}</div>
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
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
