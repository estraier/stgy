"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

type Props = {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob, suggestedName: string) => void;
  title?: string;
  buttonLabel?: string;
};

type Rect = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Corner = "nw" | "ne" | "sw" | "se";

export default function AvatarCropDialog({
  file,
  onCancel,
  onCropped,
  title = "Crop avatar",
  buttonLabel = "Use this crop",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [imgUrl, setImgUrl] = useState<string>("");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 600, h: 600 });

  const [displayed, setDisplayed] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState<{ x: number; y: number; size: number }>({
    x: 0,
    y: 0,
    size: 100,
  });

  const dragState = useRef<
    | null
    | {
        mode: "move";
        startP: Point;
        startCrop: { x: number; y: number; size: number };
      }
    | {
        mode: "resize";
        corner: Corner;
        fixed: Point;
        startP: Point;
        startCrop: { x: number; y: number; size: number };
      }
  >(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const img = new window.Image();
    img.decoding = "async";
    img.src = url;
    const onLoad = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    const onError = () => setNatural(null);
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    return () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        setContainerSize({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const fitImage = useCallback((nat: { w: number; h: number }, cw: number, ch: number): Rect => {
    if (nat.w <= 0 || nat.h <= 0 || cw <= 0 || ch <= 0) return { x: 0, y: 0, w: 0, h: 0 };
    const arImg = nat.w / nat.h;
    const arBox = cw / ch;
    if (arImg >= arBox) {
      const w = cw;
      const h = Math.round(cw / arImg);
      return { x: 0, y: Math.round((ch - h) / 2), w: Math.round(w), h };
    } else {
      const h = ch;
      const w = Math.round(ch * arImg);
      return { x: Math.round((cw - w) / 2), y: 0, w, h: Math.round(h) };
    }
  }, []);

  useEffect(() => {
    if (!natural) return;
    const d = fitImage(natural, containerSize.w, containerSize.h);
    setDisplayed(d);
    const s = Math.floor(Math.min(d.w, d.h) * 0.8);
    const x = Math.floor(d.x + (d.w - s) / 2);
    const y = Math.floor(d.y + (d.h - s) / 2);
    setCrop({ x, y, size: s });
  }, [natural, containerSize.w, containerSize.h, fitImage]);

  const clampCrop = useCallback(
    (nx: number, ny: number, ns: number) => {
      const maxSize = Math.min(displayed.w, displayed.h);
      const size = Math.max(40, Math.min(ns, maxSize));
      const minX = displayed.x;
      const minY = displayed.y;
      const maxX = displayed.x + displayed.w - size;
      const maxY = displayed.y + displayed.h - size;
      return {
        x: Math.min(Math.max(Math.round(nx), minX), maxX),
        y: Math.min(Math.max(Math.round(ny), minY), maxY),
        size: Math.round(size),
      };
    },
    [displayed.x, displayed.y, displayed.w, displayed.h],
  );

  const toLocal = useCallback((e: React.PointerEvent): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onCropPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      dragState.current = { mode: "move", startP: toLocal(e), startCrop: crop };
      e.preventDefault();
    },
    [crop, toLocal],
  );

  const onHandlePointerDown = useCallback(
    (corner: Corner) => (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      const start = crop;
      let fixed: Point;
      if (corner === "se") fixed = { x: start.x, y: start.y };
      else if (corner === "nw") fixed = { x: start.x + start.size, y: start.y + start.size };
      else if (corner === "ne") fixed = { x: start.x, y: start.y + start.size };
      else fixed = { x: start.x + start.size, y: start.y };
      dragState.current = {
        mode: "resize",
        corner,
        fixed,
        startP: toLocal(e),
        startCrop: start,
      };
      e.preventDefault();
      e.stopPropagation();
    },
    [crop, toLocal],
  );

  const clampToQuadrant = (corner: Corner, fixed: Point, p: Point): Point => {
    if (corner === "se") return { x: Math.max(p.x, fixed.x), y: Math.max(p.y, fixed.y) };
    if (corner === "nw") return { x: Math.min(p.x, fixed.x), y: Math.min(p.y, fixed.y) };
    if (corner === "ne") return { x: Math.max(p.x, fixed.x), y: Math.min(p.y, fixed.y) };
    return { x: Math.min(p.x, fixed.x), y: Math.max(p.y, fixed.y) };
  };

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      if (dragState.current.mode === "move") {
        const p = toLocal(e);
        const dx = p.x - dragState.current.startP.x;
        const dy = p.y - dragState.current.startP.y;
        const nx = dragState.current.startCrop.x + dx;
        const ny = dragState.current.startCrop.y + dy;
        setCrop((prev) => clampCrop(nx, ny, prev.size));
      } else {
        const p = toLocal(e);
        const fixed = dragState.current.fixed;
        const c = dragState.current.corner;
        const q = clampToQuadrant(c, fixed, p);
        const s = Math.max(Math.abs(q.x - fixed.x), Math.abs(q.y - fixed.y));
        let nx: number;
        let ny: number;
        if (c === "se") {
          nx = fixed.x;
          ny = fixed.y;
        } else if (c === "nw") {
          nx = fixed.x - s;
          ny = fixed.y - s;
        } else if (c === "ne") {
          nx = fixed.x;
          ny = fixed.y - s;
        } else {
          nx = fixed.x - s;
          ny = fixed.y;
        }
        const clamped = clampCrop(nx, ny, s);
        setCrop(clamped);
      }
    },
    [clampCrop, toLocal],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    dragState.current = null;
  }, []);

  const overlayPath = useMemo(() => {
    const c = crop;
    return {
      outer: `M0,0 H${containerSize.w} V${containerSize.h} H0 Z`,
      inner: `M${c.x},${c.y} H${c.x + c.size} V${c.y + c.size} H${c.x} Z`,
    };
  }, [crop, containerSize.w, containerSize.h]);

  const toWebpBlob = async (canvas: HTMLCanvasElement, q = 0.9): Promise<Blob> => {
    const b1 = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/webp", q),
    );
    if (b1) return b1;
    const url = canvas.toDataURL("image/webp", q);
    const bin = atob(url.split(",")[1] || "");
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: "image/webp" });
  };

  const doCrop = useCallback(async () => {
    if (!natural) return;
    const scaleX = natural.w / displayed.w;
    const scaleY = natural.h / displayed.h;
    const sx = Math.max(0, Math.min(natural.w, (crop.x - displayed.x) * scaleX));
    const sy = Math.max(0, Math.min(natural.h, (crop.y - displayed.y) * scaleY));
    const sw = Math.max(1, Math.min(natural.w - sx, crop.size * scaleX));
    const sh = Math.max(1, Math.min(natural.h - sy, crop.size * scaleY));
    const srcSide = Math.min(sw, sh);
    const targetSide = srcSide > 2000 ? 1600 : Math.round(srcSide);
    const canvas = document.createElement("canvas");
    canvas.width = targetSide;
    canvas.height = targetSide;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new window.Image();
    img.decoding = "async";
    img.src = imgUrl;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej();
    });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, srcSide, srcSide, 0, 0, targetSide, targetSide);
    const blob = await toWebpBlob(canvas, 0.9);
    const base = file.name.replace(/\.[^.]+$/, "");
    const name = `${base}.webp`;
    onCropped(blob, name);
  }, [
    natural,
    displayed.w,
    displayed.h,
    displayed.x,
    displayed.y,
    crop.x,
    crop.y,
    crop.size,
    imgUrl,
    file.name,
    onCropped,
  ]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-[1000] flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded shadow max-w-[95vw] max-h-[95vh] w-full sm:w-auto p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            className="px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100"
            onClick={onCancel}
          >
            Close
          </button>
        </div>

        <div className="mt-3 grid justify-items-center sm:justify-items-center grid-cols-1 sm:grid-cols-[min(80vmin,720px),260px] gap-3">
          <div
            ref={containerRef}
            className="relative w-[80vmin] max-w-[600px] aspect-square bg-gray-50 rounded overflow-hidden select-none touch-none justify-self-center"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {imgUrl && (
              <div
                className="absolute"
                style={{
                  left: `${displayed.x}px`,
                  top: `${displayed.y}px`,
                  width: `${displayed.w}px`,
                  height: `${displayed.h}px`,
                }}
              >
                <Image
                  src={imgUrl}
                  alt=""
                  fill
                  unoptimized
                  sizes="80vmin"
                  className="object-fill"
                  priority
                />
              </div>
            )}

            <svg className="absolute inset-0" width="100%" height="100%" aria-hidden>
              <path
                d={`${overlayPath.outer} ${overlayPath.inner}`}
                fill="rgba(0,0,0,0.5)"
                fillRule="evenodd"
              />
            </svg>

            <div
              className="absolute"
              style={{
                left: crop.x,
                top: crop.y,
                width: crop.size,
                height: crop.size,
              }}
              onPointerDown={onCropPointerDown}
            >
              <div className="absolute inset-0 border-[4px] border-black/90 pointer-events-none" />
              <div className="absolute inset-0 border-[2px] border-white pointer-events-none" />
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    "linear-gradient(transparent,transparent), repeating-linear-gradient(0deg, transparent, transparent 18px, rgba(255,255,255,0.2) 18px, rgba(255,255,255,0.2) 19px), repeating-linear-gradient(90deg, transparent, transparent 18px, rgba(255,255,255,0.2) 18px, rgba(255,255,255,0.2) 19px)",
                }}
              />
              {(["nw", "ne", "sw", "se"] as Corner[]).map((c) => {
                const base = "absolute w-4 h-4 bg-white border border-black/60 rounded-sm";
                const posCls =
                  c === "nw"
                    ? "left-[-8px] top-[-8px] cursor-nwse-resize"
                    : c === "ne"
                      ? "right-[-8px] top-[-8px] cursor-nesw-resize"
                      : c === "sw"
                        ? "left-[-8px] bottom-[-8px] cursor-nesw-resize"
                        : "right-[-8px] bottom-[-8px] cursor-nwse-resize";
                const label =
                  c === "nw"
                    ? "Resize handle northwest"
                    : c === "ne"
                      ? "Resize handle northeast"
                      : c === "sw"
                        ? "Resize handle southwest"
                        : "Resize handle southeast";
                return (
                  <div
                    key={c}
                    className={`${base} ${posCls}`}
                    onPointerDown={onHandlePointerDown(c)}
                    role="button"
                    aria-label={label}
                  />
                );
              })}
            </div>
          </div>

          <div className="text-sm text-gray-800 space-y-3 justify-self-center">
            {natural && (
              <div className="text-xs text-gray-600">
                Source: {natural.w}×{natural.h}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1 rounded border border-blue-700 bg-blue-600 text-white hover:bg-blue-700"
            onClick={doCrop}
            disabled={!natural || displayed.w <= 0}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
