"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageEditDialog,
  buildDefaultEditParams,
  buildEditedVariant,
  detectBestEditableImageOutputColorProfile,
  encodeEditedVariant,
  probeEditableImage,
  type DecodedImage,
  type ImageEditOutputColorProfile,
  type ImageEditOutputFormat,
  type ImageEditParams,
  type ImageEditPreparedVariant,
} from "@/components/ImageUploadDialog";
import { Config } from "@/config";
import { formatBytes } from "@/utils/format";

type SourceImage = {
  file: File;
  width: number;
  height: number;
  edit: ImageEditParams;
  bestOutputColorProfile: ImageEditOutputColorProfile;
};

type EditResult = {
  url: string;
  size: number;
  width: number;
  height: number;
  format: ImageEditOutputFormat;
  colorProfile: ImageEditOutputColorProfile;
};

type OutputColorProfileSelection = "best" | ImageEditOutputColorProfile;

type ResultZoomFocus = {
  x: number;
  y: number;
};

type ResultZoomPan = {
  x: number;
  y: number;
};

type ResultZoomDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
  moved: boolean;
};

function clampResultZoomPan(
  pan: ResultZoomPan,
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
): ResultZoomPan {
  const clampAxis = (value: number, viewportSize: number, imageSize: number) => {
    if (imageSize <= viewportSize) return (viewportSize - imageSize) / 2;
    const max = viewportSize / 2;
    const min = viewportSize / 2 - imageSize;
    return Math.min(max, Math.max(min, value));
  };
  return {
    x: clampAxis(pan.x, viewportWidth, imageWidth),
    y: clampAxis(pan.y, viewportHeight, imageHeight),
  };
}

const OUTPUT_FORMAT_OPTIONS: { value: ImageEditOutputFormat; label: string }[] = [
  { value: "image/webp", label: "WebP" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "image/png16", label: "PNG16" },
];

const OUTPUT_COLOR_PROFILE_OPTIONS: { value: OutputColorProfileSelection; label: string }[] = [
  { value: "best", label: "best profile" },
  { value: "srgb", label: "sRGB" },
  { value: "display-p3", label: "Display P3" },
];

function resolveOutputColorProfile(
  sourceImage: SourceImage | null,
  selection: OutputColorProfileSelection,
): ImageEditOutputColorProfile {
  if (selection === "best") {
    return sourceImage?.bestOutputColorProfile ?? "srgb";
  }
  return selection;
}

function releasePreparedVariant(prepared: ImageEditPreparedVariant | null): void {
  if (!prepared) return;
  prepared.canvas.width = 1;
  prepared.canvas.height = 1;
}

async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const meta = await probeEditableImage(file);
  if (!meta.width || !meta.height) {
    throw new Error("Could not determine the image dimensions.");
  }
  return { width: meta.width, height: meta.height };
}

export default function ImageEditSandbox() {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultUrlRef = useRef<string | null>(null);
  const editedVariantRef = useRef<ImageEditPreparedVariant | null>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [editing, setEditing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<ImageEditOutputFormat>("image/webp");
  const [outputColorProfileSelection, setOutputColorProfileSelection] = useState<OutputColorProfileSelection>("best");
  const resultZoomViewportRef = useRef<HTMLDivElement | null>(null);
  const resultZoomDragRef = useRef<ResultZoomDrag | null>(null);
  const resultZoomSuppressClickRef = useRef(false);
  const [resultZoomFocus, setResultZoomFocus] = useState<ResultZoomFocus | null>(null);
  const [resultZoomPan, setResultZoomPan] = useState<ResultZoomPan>({ x: 0, y: 0 });

  const clearEditedVariant = useCallback(() => {
    releasePreparedVariant(editedVariantRef.current);
    editedVariantRef.current = null;
  }, []);

  const clearResult = useCallback(() => {
    resultZoomDragRef.current = null;
    setResultZoomFocus(null);
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
    setResult(null);
  }, []);

  useEffect(() => clearResult, [clearResult]);
  useEffect(() => clearEditedVariant, [clearEditedVariant]);

  const closeResultZoom = useCallback(() => {
    resultZoomDragRef.current = null;
    resultZoomSuppressClickRef.current = false;
    setResultZoomFocus(null);
  }, []);

  useEffect(() => {
    if (!resultZoomFocus || !result) return;
    const frame = requestAnimationFrame(() => {
      const viewport = resultZoomViewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      setResultZoomPan(
        clampResultZoomPan(
          {
            x: rect.width / 2 - resultZoomFocus.x * result.width,
            y: rect.height / 2 - resultZoomFocus.y * result.height,
          },
          rect.width,
          rect.height,
          result.width,
          result.height,
        ),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [result, resultZoomFocus]);

  useEffect(() => {
    if (!resultZoomFocus) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeResultZoom();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeResultZoom, resultZoomFocus]);

  const openResultZoom = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setResultZoomPan({ x: 0, y: 0 });
    setResultZoomFocus({
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    });
  }, []);

  const onResultZoomPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!result) return;
    event.preventDefault();
    resultZoomSuppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    resultZoomDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: resultZoomPan.x,
      startPanY: resultZoomPan.y,
      moved: false,
    };
  }, [result, resultZoomPan]);

  const onResultZoomPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = resultZoomDragRef.current;
    const viewport = resultZoomViewportRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !viewport || !result) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) >= 3) drag.moved = true;
    const rect = viewport.getBoundingClientRect();
    setResultZoomPan(
      clampResultZoomPan(
        { x: drag.startPanX + dx, y: drag.startPanY + dy },
        rect.width,
        rect.height,
        result.width,
        result.height,
      ),
    );
  }, [result]);

  const onResultZoomPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = resultZoomDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resultZoomDragRef.current = null;
    resultZoomSuppressClickRef.current = drag.moved;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onResultZoomClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (resultZoomSuppressClickRef.current) {
      resultZoomSuppressClickRef.current = false;
      return;
    }
    closeResultZoom();
  }, [closeResultZoom]);

  const onResultZoomPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = resultZoomDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resultZoomDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onChooseFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    clearResult();
    clearEditedVariant();
    try {
      const [size, bestOutputColorProfile] = await Promise.all([
        readImageSize(file),
        detectBestEditableImageOutputColorProfile(file),
      ]);
      const { width, height } = size;
      const edit = buildDefaultEditParams(width, height);
      const nextSource: SourceImage = {
        file,
        width,
        height,
        edit: { ...edit, resizePercent: 100 },
        bestOutputColorProfile,
      };
      setSource(nextSource);
      setEditing(true);
    } catch (e) {
      setSource(null);
      setEditing(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [clearEditedVariant, clearResult]);

  const generateResult = useCallback(async (
    sourceImage: SourceImage,
    params: ImageEditParams,
    format: ImageEditOutputFormat,
    outputColorProfileSelectionValue: OutputColorProfileSelection,
    decodedImage?: DecodedImage,
    rebuildEditedVariant = false,
  ) => {
    setProcessing(true);
    setError(null);
    try {
      let prepared = editedVariantRef.current;
      if (rebuildEditedVariant || !prepared) {
        const cacheColorProfile = resolveOutputColorProfile(sourceImage, "best");
        const nextPrepared = await buildEditedVariant(
          sourceImage.file,
          sourceImage.width,
          sourceImage.height,
          sourceImage.file.name,
          sourceImage.file.type,
          params,
          decodedImage,
          cacheColorProfile,
        );
        releasePreparedVariant(editedVariantRef.current);
        editedVariantRef.current = nextPrepared;
        prepared = nextPrepared;
      }

      const resolvedOutputColorProfile = resolveOutputColorProfile(sourceImage, outputColorProfileSelectionValue);
      const processed = await encodeEditedVariant(
        prepared,
        0.8,
        format,
        resolvedOutputColorProfile,
      );
      const url = URL.createObjectURL(processed.blob);
      const previousUrl = resultUrlRef.current;
      resultUrlRef.current = url;
      setResult({
        url,
        size: processed.blob.size,
        width: processed.width,
        height: processed.height,
        format,
        colorProfile: resolvedOutputColorProfile,
      });
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }, []);

  const onEditError = useCallback((message: string) => {
    setEditing(false);
    setError(message || "Failed to load image preview.");
  }, []);

  const onApply = useCallback(async (params: ImageEditParams, decodedImage?: DecodedImage) => {
    if (!source) {
      decodedImage?.cleanup();
      return;
    }
    setEditing(false);
    const nextSource = { ...source, edit: params };
    setSource(nextSource);
    try {
      await generateResult(nextSource, params, outputFormat, outputColorProfileSelection, decodedImage, true);
    } finally {
      decodedImage?.cleanup();
    }
  }, [generateResult, outputColorProfileSelection, outputFormat, source]);

  const onOutputFormatChange = useCallback((format: ImageEditOutputFormat) => {
    setOutputFormat(format);
    if (source && result) {
      void generateResult(source, source.edit, format, outputColorProfileSelection);
    }
  }, [generateResult, outputColorProfileSelection, result, source]);

  const onOutputColorProfileSelectionChange = useCallback((selection: OutputColorProfileSelection) => {
    setOutputColorProfileSelection(selection);
    if (source && result) {
      void generateResult(source, source.edit, outputFormat, selection);
    }
  }, [generateResult, outputFormat, result, source]);

  const onReEdit = useCallback(() => {
    clearEditedVariant();
    setEditing(true);
  }, [clearEditedVariant]);

  const sandboxDefaultEditParams = source
    ? { ...buildDefaultEditParams(source.width, source.height), resizePercent: 100 }
    : undefined;

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Image Edit Sandbox</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={Config.IMAGE_ALLOWED_TYPES}
          onChange={(e) => void onChooseFile(e.target.files?.[0])}
          disabled={processing}
          className="hidden"
        />
        <div className="inline-flex items-center gap-2 text-sm text-gray-800">
          <span className="font-medium">Input:</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={processing}
            className="rounded border border-gray-400 bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-200 disabled:opacity-50"
          >
            Choose file
          </button>
        </div>

        <div className="inline-flex items-center text-sm text-gray-800">
          <span className="mr-2 font-medium">Output:</span>
          <select
            value={outputFormat}
            onChange={(e) => onOutputFormatChange(e.target.value as ImageEditOutputFormat)}
            disabled={processing}
            className="rounded-l border border-gray-400 bg-white px-3 py-1.5 text-sm"
          >
            {OUTPUT_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={outputColorProfileSelection}
            onChange={(e) => onOutputColorProfileSelectionChange(e.target.value as OutputColorProfileSelection)}
            disabled={processing}
            className="-ml-px rounded-r border border-gray-400 bg-white px-3 py-1.5 text-sm"
          >
            {OUTPUT_COLOR_PROFILE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {result && source && (
          <button
            type="button"
            className="ml-auto rounded border border-gray-400 bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-200 disabled:text-gray-400"
            onClick={onReEdit}
            disabled={processing}
          >
            Re-edit
          </button>
        )}
      </div>

      {processing && <div className="mt-4 text-sm text-gray-600">Processing…</div>}
      {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

      {result && (
        <section className="mt-6">
          <div className="rounded border border-gray-300 bg-gray-100 p-3">
            {/* The sandbox displays the generated blob directly; Next/Image is unnecessary here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.url}
              alt="Edited result"
              className="mx-auto block max-h-[70vh] max-w-full cursor-zoom-in object-contain"
              onClick={openResultZoom}
              draggable={false}
            />
          </div>
          <div className="mt-2 text-sm text-gray-700">
            {OUTPUT_FORMAT_OPTIONS.find((option) => option.value === result.format)?.label ?? result.format}
            {" • "}
            {result.colorProfile === "display-p3" ? "Display P3" : "sRGB"}
            {" • "}
            {formatBytes(result.size)}
            {" • "}
            {result.width}×{result.height}
          </div>
        </section>
      )}

      {resultZoomFocus && result && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-1.5 sm:p-3"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.target === event.currentTarget) closeResultZoom();
          }}
        >
          <div
            ref={resultZoomViewportRef}
            className="relative h-[95vh] w-[96vw] sm:h-[90vh] sm:w-[92vw] touch-none select-none overflow-hidden rounded border border-gray-500 bg-black cursor-grab active:cursor-grabbing"
            onPointerDown={onResultZoomPointerDown}
            onPointerMove={onResultZoomPointerMove}
            onPointerUp={onResultZoomPointerUp}
            onPointerCancel={onResultZoomPointerCancel}
            onClick={onResultZoomClick}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.url}
              alt="Edited result enlarged"
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-h-none max-w-none select-none"
              style={{
                width: `${result.width}px`,
                height: `${result.height}px`,
                transform: `translate3d(${resultZoomPan.x}px, ${resultZoomPan.y}px, 0)`,
              }}
            />
          </div>
        </div>
      )}

      {editing && source && (
        <ImageEditDialog
          file={source.file}
          initialParams={source.edit}
          defaultParams={sandboxDefaultEditParams}
          onCancel={() => setEditing(false)}
          onError={onEditError}
          onApply={(params, decodedImage) => void onApply(params, decodedImage)}
        />
      )}
    </main>
  );
}
