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
  type RawDemosaicQuality,
  type RawHighlightMode,
} from "@/components/ImageUploadDialog";
import type { ImageEditClarityMap } from "@/components/image-editor/clarity";
import { Config } from "@/config";
import { isRawImageFile } from "@/image/libraw";
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
];

const OUTPUT_COLOR_PROFILE_OPTIONS: { value: OutputColorProfileSelection; label: string }[] = [
  { value: "best", label: "best profile" },
  { value: "srgb", label: "sRGB" },
  { value: "display-p3", label: "Display P3" },
];

const RAW_DEMOSAIC_OPTIONS: { value: RawDemosaicQuality; label: string }[] = [
  { value: 0, label: "Linear (0)" },
  { value: 1, label: "VNG (1)" },
  { value: 2, label: "PPG (2)" },
  { value: 3, label: "AHD (3)" },
  { value: 4, label: "DCB (4)" },
  { value: 11, label: "DHT (11)" },
  { value: 12, label: "Modified AHD (12)" },
];

const RAW_HIGHLIGHT_OPTIONS: { value: RawHighlightMode; label: string }[] = [
  { value: 0, label: "Clip (0)" },
  { value: 1, label: "Unclip (1)" },
  { value: 2, label: "Blend (2)" },
  { value: 3, label: "Rebuild (3)" },
  { value: 4, label: "Rebuild (4)" },
  { value: 5, label: "Rebuild (5)" },
  { value: 6, label: "Rebuild (6)" },
  { value: 7, label: "Rebuild (7)" },
  { value: 8, label: "Rebuild (8)" },
  { value: 9, label: "Rebuild (9)" },
];

const IMAGE_ALLOWED_TYPE_TOKENS = Config.IMAGE_ALLOWED_TYPES
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const CLIPBOARD_IMAGE_MIME_TYPES = new Set<string>(
  IMAGE_ALLOWED_TYPE_TOKENS.filter((value) => value.startsWith("image/")),
);

const DROP_IMAGE_EXTENSIONS = new Set<string>(
  IMAGE_ALLOWED_TYPE_TOKENS.filter((value) => value.startsWith(".")),
);

function isAllowedDroppedImageFile(file: File): boolean {
  const mimeType = file.type.trim().toLowerCase();
  if (mimeType && CLIPBOARD_IMAGE_MIME_TYPES.has(mimeType)) return true;
  const lowerName = file.name.trim().toLowerCase();
  return Array.from(DROP_IMAGE_EXTENSIONS).some((extension) => lowerName.endsWith(extension));
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea") !== null;
}

function outputFilename(fileName: string | undefined, format: ImageEditOutputFormat): string {
  const extension = format === "image/jpeg" ? "jpg" : format === "image/png" ? "png" : "webp";
  const trimmedName = fileName?.trim() ?? "";
  const baseName = trimmedName
    ? trimmedName.replace(/\.[^./\\]+$/, "") || "image"
    : "image";
  return `${baseName}-edited.${extension}`;
}

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

export default function LocalImageStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultUrlRef = useRef<string | null>(null);
  const editedVariantRef = useRef<ImageEditPreparedVariant | null>(null);
  const rawDevelopmentRef = useRef<DecodedImage | null>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [editing, setEditing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<ImageEditOutputFormat>("image/webp");
  const [outputColorProfileSelection, setOutputColorProfileSelection] = useState<OutputColorProfileSelection>("best");
  const [rawDemosaicQuality, setRawDemosaicQuality] = useState<RawDemosaicQuality>(11);
  const [rawHighlightMode, setRawHighlightMode] = useState<RawHighlightMode>(2);
  const [showRawDemosaicSelector, setShowRawDemosaicSelector] = useState(false);
  const altOnlyPressRef = useRef(false);
  const resultZoomViewportRef = useRef<HTMLDivElement | null>(null);
  const resultZoomDragRef = useRef<ResultZoomDrag | null>(null);
  const resultZoomSuppressClickRef = useRef(false);
  const [resultZoomFocus, setResultZoomFocus] = useState<ResultZoomFocus | null>(null);
  const [resultZoomPan, setResultZoomPan] = useState<ResultZoomPan>({ x: 0, y: 0 });

  const clearEditedVariant = useCallback(() => {
    releasePreparedVariant(editedVariantRef.current);
    editedVariantRef.current = null;
  }, []);

  const clearRawDevelopment = useCallback(() => {
    if (rawDevelopmentRef.current) {
      rawDevelopmentRef.current.cleanup();
      rawDevelopmentRef.current = null;
    }
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
  useEffect(() => clearRawDevelopment, [clearRawDevelopment]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        if (!event.repeat) {
          altOnlyPressRef.current = !event.ctrlKey && !event.metaKey && !event.shiftKey;
        }
        return;
      }
      if (event.altKey) altOnlyPressRef.current = false;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      if (altOnlyPressRef.current) {
        setShowRawDemosaicSelector((visible) => !visible);
      }
      altOnlyPressRef.current = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.altKey) altOnlyPressRef.current = false;
    };
    const onBlur = () => {
      altOnlyPressRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

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
    clearRawDevelopment();
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
  }, [clearEditedVariant, clearRawDevelopment, clearResult]);

  const onStudioDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    const fileItems = Array.from(event.dataTransfer.items).filter((item) => item.kind === "file");
    const hasFiles = fileItems.length > 0 || Array.from(event.dataTransfer.types).includes("Files");
    if (!hasFiles) return;
    event.preventDefault();
    if (editing || processing || resultZoomFocus || fileItems.length > 1) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.dataTransfer.dropEffect = "copy";
  }, [editing, processing, resultZoomFocus]);

  const onStudioDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    if (editing || processing || resultZoomFocus) return;

    if (files.length !== 1) {
      setError("Drop one image file at a time.");
      return;
    }

    const file = files[0];
    if (!isAllowedDroppedImageFile(file)) {
      setError("Unsupported image format.");
      return;
    }

    void onChooseFile(file);
  }, [editing, onChooseFile, processing, resultZoomFocus]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (editing || processing || resultZoomFocus || isEditablePasteTarget(event.target)) return;
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      const item = Array.from(clipboardData.items).find((candidate) => (
        candidate.kind === "file" &&
        CLIPBOARD_IMAGE_MIME_TYPES.has(candidate.type.trim().toLowerCase())
      ));
      if (!item) return;

      const file = item.getAsFile();
      if (!file) return;
      event.preventDefault();
      void onChooseFile(file);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editing, onChooseFile, processing, resultZoomFocus]);

  const generateResult = useCallback(async (
    sourceImage: SourceImage,
    params: ImageEditParams,
    format: ImageEditOutputFormat,
    outputColorProfileSelectionValue: OutputColorProfileSelection,
    decodedImage?: DecodedImage,
    rebuildEditedVariant = false,
    previewClarityMap?: ImageEditClarityMap | null,
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
          undefined,
          previewClarityMap,
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

  const onApply = useCallback(async (
    params: ImageEditParams,
    decodedImage?: DecodedImage,
    previewClarityMap?: ImageEditClarityMap | null,
  ) => {
    if (!source) {
      if (decodedImage && rawDevelopmentRef.current !== decodedImage) decodedImage.cleanup();
      return;
    }
    setEditing(false);
    const nextSource = { ...source, edit: params };
    setSource(nextSource);
    try {
      await generateResult(
        nextSource,
        params,
        outputFormat,
        outputColorProfileSelection,
        decodedImage,
        true,
        previewClarityMap,
      );
    } finally {
      if (decodedImage && rawDevelopmentRef.current !== decodedImage) decodedImage.cleanup();
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

  const onRawDemosaicQualityChange = useCallback((quality: RawDemosaicQuality) => {
    setRawDemosaicQuality(quality);
    if (!source || !isRawImageFile(source.file.name, source.file.type)) return;
    clearResult();
    clearEditedVariant();
    clearRawDevelopment();
    setEditing(true);
  }, [clearEditedVariant, clearRawDevelopment, clearResult, source]);

  const onRawHighlightModeChange = useCallback((mode: RawHighlightMode) => {
    setRawHighlightMode(mode);
    if (!source || !isRawImageFile(source.file.name, source.file.type)) return;
    clearResult();
    clearEditedVariant();
    clearRawDevelopment();
    setEditing(true);
  }, [clearEditedVariant, clearRawDevelopment, clearResult, source]);

  const onReEdit = useCallback(() => {
    clearEditedVariant();
    setEditing(true);
  }, [clearEditedVariant]);

  const studioDefaultEditParams = source
    ? { ...buildDefaultEditParams(source.width, source.height), resizePercent: 100 }
    : undefined;

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:py-8">
      <section
        className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
        onDragOver={onStudioDragOver}
        onDrop={onStudioDrop}
      >
        <div className="border-b border-gray-200 bg-gradient-to-br from-white via-gray-50 to-gray-100 px-5 py-6 sm:px-7 sm:py-8">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            Local Image Studio
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl">
            Edit and finish your photos in the browser.
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-600 sm:text-base">
            Crop, resize, rotate, adjust tone and color, and develop RAW photos with a simple set of editing tools. It also includes auto tone adjustment, text and drawing tools, mosaic effects, and sharpening.
          </p>
        </div>

        <div className="p-4 sm:p-6">
          <input
            ref={inputRef}
            type="file"
            accept={Config.IMAGE_ALLOWED_TYPES}
            onChange={(e) => void onChooseFile(e.target.files?.[0])}
            disabled={processing}
            className="hidden"
          />

          <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Input</div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setShowRawDemosaicSelector((visible) => !visible);
                }}
                disabled={processing}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-100 disabled:opacity-50"
              >
                Choose file
              </button>
            </div>

            {showRawDemosaicSelector && (
              <>
                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">RAW demosaic</div>
                  <select
                    value={rawDemosaicQuality}
                    onChange={(e) => onRawDemosaicQualityChange(Number(e.target.value) as RawDemosaicQuality)}
                    disabled={processing}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    {RAW_DEMOSAIC_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">RAW highlight</div>
                  <select
                    value={rawHighlightMode}
                    onChange={(e) => onRawHighlightModeChange(Number(e.target.value) as RawHighlightMode)}
                    disabled={processing}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    {RAW_HIGHLIGHT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Output</div>
              <div className="inline-flex items-center">
                <select
                  value={outputFormat}
                  onChange={(e) => onOutputFormatChange(e.target.value as ImageEditOutputFormat)}
                  disabled={processing}
                  className="rounded-l-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
                  className="-ml-px rounded-r-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                >
                  {OUTPUT_COLOR_PROFILE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {result && source && (
              <button
                type="button"
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-100 disabled:text-gray-400 sm:ml-auto"
                onClick={onReEdit}
                disabled={processing}
              >
                Re-edit
              </button>
            )}
          </div>

          {!source && !processing && (
            <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4 sm:px-5">
              <div className="text-sm font-semibold text-gray-900">Usage</div>
              <ol className="mt-2 grid gap-2 text-sm leading-5 text-gray-600 sm:grid-cols-3 sm:gap-4">
                <li><span className="font-medium text-gray-900">1.</span> Choose an image.</li>
                <li><span className="font-medium text-gray-900">2.</span> Adjust the image, then click Edit.</li>
                <li><span className="font-medium text-gray-900">3.</span> Choose the output format and profile.</li>
              </ol>
            </div>
          )}

          {processing && <div className="mt-4 text-sm text-gray-600">Processing…</div>}
          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

          {result && (
            <section className="mt-6">
              <div className="rounded-xl border border-gray-200 bg-gray-100 p-3 shadow-inner">
                {/* The studio displays the generated blob directly; Next/Image is unnecessary here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.url}
                  alt="Edited result"
                  className="mx-auto block max-h-[70vh] max-w-full cursor-zoom-in object-contain"
                  onClick={openResultZoom}
                  draggable={false}
                />
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm text-gray-700">
                <div className="min-w-0">
                  {OUTPUT_FORMAT_OPTIONS.find((option) => option.value === result.format)?.label ?? result.format}
                  {" • "}
                  {result.colorProfile === "display-p3" ? "Display P3" : "sRGB"}
                  {" • "}
                  {formatBytes(result.size)}
                  {" • "}
                  {result.width}×{result.height}
                </div>
                <a
                  href={result.url}
                  download={outputFilename(source?.file.name, result.format)}
                  className="ml-auto shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-100"
                >
                  Download
                </a>
              </div>
            </section>
          )}
        </div>
      </section>
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
            <button
              type="button"
              aria-label="Close full-size preview"
              className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-lg cursor-pointer leading-none text-white/80 shadow-sm backdrop-blur-sm hover:bg-black/65 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeResultZoom();
              }}
            >
              ×
            </button>
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
          defaultParams={studioDefaultEditParams}
          initialDecodedImage={rawDevelopmentRef.current ?? undefined}
          rawDemosaicQuality={rawDemosaicQuality}
          rawHighlightMode={rawHighlightMode}
          onRawDevelopmentReady={(decodedImage) => {
            const previous = rawDevelopmentRef.current;
            if (previous && previous !== decodedImage) previous.cleanup();
            rawDevelopmentRef.current = decodedImage;
          }}
          onCancel={() => setEditing(false)}
          onError={onEditError}
          onApply={(params, decodedImage, previewClarityMap) =>
            void onApply(params, decodedImage, previewClarityMap)
          }
        />
      )}
    </main>
  );
}
