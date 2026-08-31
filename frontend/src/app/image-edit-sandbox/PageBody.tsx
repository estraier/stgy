"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageEditDialog,
  buildDefaultEditParams,
  buildOptimizedVariant,
  type ImageEditOutputFormat,
  type ImageEditParams,
} from "@/components/ImageUploadDialog";
import { formatBytes } from "@/utils/format";

type SourceImage = {
  file: File;
  width: number;
  height: number;
  edit: ImageEditParams;
};

type EditResult = {
  url: string;
  size: number;
  width: number;
  height: number;
  format: ImageEditOutputFormat;
};

const OUTPUT_FORMAT_OPTIONS: { value: ImageEditOutputFormat; label: string }[] = [
  { value: "image/webp", label: "WebP" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
];

async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not decode this image in the browser."));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error("Could not determine the image dimensions.");
    }
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ImageEditSandbox() {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultUrlRef = useRef<string | null>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [editing, setEditing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<EditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputFormat, setOutputFormat] = useState<ImageEditOutputFormat>("image/webp");

  const clearResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
    setResult(null);
  }, []);

  useEffect(() => clearResult, [clearResult]);

  const onChooseFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    clearResult();
    try {
      const { width, height } = await readImageSize(file);
      const edit = buildDefaultEditParams(width, height);
      const nextSource: SourceImage = {
        file,
        width,
        height,
        edit: { ...edit, resizePercent: 100 },
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
  }, [clearResult]);

  const generateResult = useCallback(async (
    sourceImage: SourceImage,
    params: ImageEditParams,
    format: ImageEditOutputFormat,
  ) => {
    setProcessing(true);
    setError(null);
    try {
      const processed = await buildOptimizedVariant(
        sourceImage.file,
        sourceImage.width,
        sourceImage.height,
        0.8,
        sourceImage.file.name,
        sourceImage.file.type,
        params,
        format,
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
      });
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }, []);

  const onApply = useCallback(async (params: ImageEditParams) => {
    if (!source) return;
    setEditing(false);
    const nextSource = { ...source, edit: params };
    setSource(nextSource);
    await generateResult(nextSource, params, outputFormat);
  }, [generateResult, outputFormat, source]);

  const onOutputFormatChange = useCallback((format: ImageEditOutputFormat) => {
    setOutputFormat(format);
    if (source && result) {
      void generateResult(source, source.edit, format);
    }
  }, [generateResult, result, source]);

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
          accept="image/*,.svg"
          onChange={(e) => void onChooseFile(e.target.files?.[0])}
          disabled={processing}
          className="block max-w-full text-sm file:mr-3 file:rounded file:border file:border-gray-400 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-800 hover:file:bg-gray-200"
        />

        <label className="inline-flex items-center gap-2 text-sm text-gray-800">
          <span className="font-medium">Format</span>
          <select
            value={outputFormat}
            onChange={(e) => onOutputFormatChange(e.target.value as ImageEditOutputFormat)}
            disabled={processing}
            className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm"
          >
            {OUTPUT_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {result && source && (
          <button
            type="button"
            className="ml-auto rounded border border-gray-400 bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-200 disabled:text-gray-400"
            onClick={() => setEditing(true)}
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
              className="mx-auto block max-h-[70vh] max-w-full object-contain"
            />
          </div>
          <div className="mt-2 text-sm text-gray-700">
            {OUTPUT_FORMAT_OPTIONS.find((option) => option.value === result.format)?.label ?? result.format}
            {" • "}
            {formatBytes(result.size)}
            {" • "}
            {result.width}×{result.height}
          </div>
        </section>
      )}

      {editing && source && (
        <ImageEditDialog
          file={source.file}
          initialParams={source.edit}
          defaultParams={sandboxDefaultEditParams}
          onCancel={() => setEditing(false)}
          onApply={(params) => void onApply(params)}
        />
      )}
    </main>
  );
}
