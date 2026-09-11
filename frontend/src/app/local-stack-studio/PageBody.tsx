"use client";

import { useCallback, useEffect, useState, type DragEvent } from "react";
import {
  ImageEditDialog,
  buildDefaultEditParams,
  buildEditedDecodedRgb16,
  type ImageEditParams,
} from "@/components/ImageUploadDialog";
import type { DecodedRgbImage16, ImageEditOutputColorProfile } from "@/components/image-editor/types";
import type { ImageEditClarityMap } from "@/components/image-editor/clarity";
import {
  mountLocalStackStudio,
  type LocalStackStudioEditRequest,
} from "./stack/controller";

const INPUT_ACCEPT = ".jpg,.jpeg,.webp,.png,.tif,.tiff,.3fr,.ari,.arw,.bay,.cap,.cr2,.cr3,.crw,.dcr,.dcs,.dng,.drf,.eip,.erf,.fff,.gpr,.iiq,.k25,.kdc,.mdc,.mef,.mos,.mrw,.nef,.nrw,.obm,.orf,.pef,.ptx,.pxn,.raf,.raw,.rwl,.rw2,.rwz,.sr2,.srf,.srw,.x3f,image/jpeg,image/png,image/webp,image/tiff,image/x-adobe-dng,image/x-canon-cr2,image/x-canon-cr3,image/x-epson-erf,image/x-fuji-raf,image/x-kodak-dcr,image/x-kodak-k25,image/x-minolta-mrw,image/x-nikon-nef,image/x-olympus-orf,image/x-panasonic-rw2,image/x-pentax-pef,image/x-sony-arw,image/x-sony-sr2,image/x-sony-srf,image/x-sigma-x3f,image/dng";

const INPUT_ACCEPT_PARTS = INPUT_ACCEPT.split(",").map((value) => value.trim().toLowerCase());
const INPUT_ACCEPT_EXTENSIONS = new Set(INPUT_ACCEPT_PARTS.filter((value) => value.startsWith(".")));
const INPUT_ACCEPT_MIME_TYPES = new Set(INPUT_ACCEPT_PARTS.filter((value) => value.includes("/")));

function isAcceptedInputFile(file: File): boolean {
  const mimeType = file.type.trim().toLowerCase();
  if (mimeType && INPUT_ACCEPT_MIME_TYPES.has(mimeType)) return true;
  const dotIndex = file.name.lastIndexOf(".");
  if (dotIndex < 0) return false;
  return INPUT_ACCEPT_EXTENSIONS.has(file.name.slice(dotIndex).toLowerCase());
}

function dataTransferContainsFiles(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.files.length > 0) return true;
  for (let index = 0; index < dataTransfer.items.length; index += 1) {
    if (dataTransfer.items[index]?.kind === "file") return true;
  }
  return false;
}

export default function PageBody() {
  const [editRequest, setEditRequest] = useState<LocalStackStudioEditRequest | null>(null);

  const handleInputDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();

    const input = document.getElementById("input-files") as HTMLInputElement | null;
    if (!input || input.disabled) return;

    const transfer = new DataTransfer();
    for (let index = 0; index < event.dataTransfer.files.length; index += 1) {
      const file = event.dataTransfer.files.item(index);
      if (file && isAcceptedInputFile(file)) transfer.items.add(file);
    }
    if (transfer.files.length === 0) return;

    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, []);

  const handleInputDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleEditRequest = useCallback((request: LocalStackStudioEditRequest) => {
    setEditRequest(request);
  }, []);

  useEffect(() => mountLocalStackStudio({ onEditRequest: handleEditRequest }), [handleEditRequest]);

  const closeEditor = useCallback(() => {
    setEditRequest((current) => {
      current?.onCancel();
      return null;
    });
  }, []);

  const applyEditorResult = useCallback(async (
    params: ImageEditParams,
    decodedImage?: DecodedRgbImage16,
    previewClarityMap?: ImageEditClarityMap | null,
  ) => {
    const request = editRequest;
    if (!request) return;
    const source = decodedImage ?? request.decodedImage;
    try {
      const edited = await buildEditedDecodedRgb16(
        source,
        params,
        request.outputColorProfile as ImageEditOutputColorProfile,
        previewClarityMap,
      );
      request.onApply(edited);
      setEditRequest(null);
    } catch (error) {
      request.onError(error instanceof Error ? error.message : String(error));
      setEditRequest(null);
    }
  }, [editRequest]);

  const editorDefaults = editRequest
    ? {
        ...buildDefaultEditParams(editRequest.decodedImage.width, editRequest.decodedImage.height),
        resizePercent: 100,
      }
    : null;

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:py-8">
      <section
        className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
        onDragOver={handleInputDragOver}
        onDrop={handleInputDrop}
      >
        <div className="border-b border-gray-200 bg-gradient-to-br from-white via-gray-50 to-gray-100 px-5 py-6 sm:px-7 sm:py-8">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            Local Stack Studio
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl">
            Combine photos with various stacking methods.
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-600 sm:text-base">
            Align and combine multiple photos for multiple exposure blending, noise reduction, HDR, and focus stacking, then fine-tune the result with tone adjustments.
          </p>
        </div>

        <div className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-0 sm:min-w-80">
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Input</div>
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-100">
                  Choose files
                  <input
                    id="input-files"
                    className="sr-only"
                    type="file"
                    multiple
                    accept={INPUT_ACCEPT}
                  />
                </label>
                <span id="file-count" className="text-[13px] text-gray-500">No files selected</span>
              </div>
            </div>

            <label className="flex flex-col items-start gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Merge</span>
              <select id="merge-mode" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm">
                <option value="average">Blend (average)</option>
                <option value="median">Denoise (median)</option>
                <option value="hdr1">HDR1 (Debevec)</option>
                <option value="hdr2">HDR2 (Mertens)</option>
                <option value="stf">STF (aperture-weighted)</option>
                <option value="focus">Focus (sharpness-weighted)</option>
              </select>
            </label>

            <label className="flex flex-col items-start gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Alignment</span>
              <select id="alignment-mode" defaultValue="auto" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm">
                <option value="auto">Auto</option>
                <option value="center-crop">Center crop</option>
                <option value="fit">Fit</option>
                <option value="feature-match">Feature match</option>
              </select>
            </label>

            <button
              id="process-button"
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-100 disabled:opacity-50"
            >
              Process
            </button>
          </div>

          <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4 sm:px-5">
            <div className="text-sm font-semibold text-gray-900">Usage</div>
            <ol className="mt-2 grid gap-2 text-sm leading-5 text-gray-600 sm:grid-cols-3 sm:gap-4">
              <li><span className="font-medium text-gray-900">1.</span> Choose one or more images.</li>
              <li><span className="font-medium text-gray-900">2.</span> Choose Merge and Alignment, then click Process.</li>
              <li><span className="font-medium text-gray-900">3.</span> Fine-tune the tone, then choose a format and download.</li>
            </ol>
          </div>

          <section id="progress-panel" className="mt-5 hidden min-h-28 flex-col items-center justify-center gap-3 [&:not(.hidden)]:flex rounded-xl border border-gray-200 bg-white text-gray-600" aria-live="polite">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-gray-600" aria-hidden="true" />
            <div id="progress-message">Preparing...</div>
          </section>

          <section id="error-panel" className="mt-5 hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 leading-5 text-red-800" role="alert" />

          <section id="result-panel" className="mt-6 hidden">
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 p-3 shadow-inner">
              <canvas
                id="preview-image"
                className="block max-h-[70vh] max-w-full cursor-zoom-in"
                aria-label="Stacked image preview"
              />
            </div>

            <div className="mt-4 grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <ToneControl id="preview-exposure" label="Exposure" min="-5" max="5" step="0.1" value="0" valueId="preview-exposure-value" valueText="0 EV" />
              <ToneControl id="preview-logarithm" label="Midtone" min="-30" max="30" step="0.1" value="0" valueId="preview-logarithm-value" valueText="0" />
              <ToneControl id="preview-sigmoid" label="Contrast" min="-10" max="10" step="0.1" value="0" valueId="preview-sigmoid-value" valueText="0" />
              <ToneControl id="preview-shadow" label="Shadow" min="-100" max="100" step="1" value="0" valueId="preview-shadow-value" valueText="0" />
              <ToneControl id="preview-highlight" label="Highlight" min="-100" max="100" step="1" value="0" valueId="preview-highlight-value" valueText="0" />
              <ToneControl id="preview-clahe" label="Clarity" min="-100" max="100" step="1" value="0" valueId="preview-clahe-value" valueText="0" />
              <ToneControl id="preview-saturation" label="Saturation" min="-100" max="100" step="1" value="0" valueId="preview-saturation-value" valueText="0" />
              <ToneControl id="preview-vibrance" label="Vibrance" min="-100" max="100" step="1" value="0" valueId="preview-vibrance-value" valueText="0" />

              <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                <button
                  id="edit-button"
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-100 disabled:opacity-50"
                >
                  <span id="edit-button-spinner" className="hidden h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" aria-hidden="true" />
                  <span>Edit</span>
                </button>
                <div className="ml-auto flex flex-wrap items-center gap-2.5">
                  <select id="output-format" aria-label="Output format" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm">
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                    <option value="tiff8">TIFF-8</option>
                    <option value="tiff16">TIFF-16</option>
                  </select>
                  <select id="output-size" aria-label="Output size" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm">
                    <option value="full">Full-size</option>
                  </select>
                  <button
                    id="download-button"
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-100 disabled:opacity-50"
                  >
                    <span id="download-button-spinner" className="hidden h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" aria-hidden="true" />
                    <span id="download-button-label">Download</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

        </div>
      </section>

      <div
        id="zoom-modal"
        className="fixed inset-0 z-[90] hidden items-center justify-center bg-black/75 p-1.5 sm:p-3 [&:not(.hidden)]:flex"
        role="dialog"
        aria-modal="true"
        aria-label="Full-size preview"
      >
        <div className="relative h-[95vh] w-[96vw] overflow-hidden rounded border border-gray-500 bg-black sm:h-[90vh] sm:w-[92vw]">
          <button
            id="zoom-close-button"
            type="button"
            aria-label="Close full-size preview"
            className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-lg cursor-pointer leading-none text-white/80 shadow-sm backdrop-blur-sm hover:bg-black/65 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70"
          >
            ×
          </button>
          <div id="zoom-loading" className="absolute inset-0 z-10 hidden flex-col items-center justify-center gap-3 bg-black text-gray-400 [&:not(.hidden)]:flex">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-700 border-t-gray-300" aria-hidden="true" />
            <div id="zoom-message">Rendering full-size view...</div>
          </div>
          <div
            id="zoom-scroll-container"
            className="hidden h-full w-full touch-none select-none overflow-auto bg-black cursor-grab active:cursor-grabbing [&.is-dragging]:cursor-grabbing"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              id="zoom-image"
              className="block max-h-none max-w-none select-none"
              alt="Full-size stacked preview"
              draggable={false}
              data-stgy-no-image-fallback="true"
            />
          </div>
        </div>
      </div>

      {editRequest && editorDefaults && (
        <ImageEditDialog
          file={editRequest.file}
          initialParams={editorDefaults}
          defaultParams={editorDefaults}
          initialDecodedImage={editRequest.decodedImage}
          onCancel={closeEditor}
          onApply={(params, decodedImage, previewClarityMap) => {
            void applyEditorResult(params, decodedImage, previewClarityMap);
          }}
          onError={(message) => {
            editRequest.onError(message);
            setEditRequest(null);
          }}
        />
      )}
    </main>
  );
}

function ToneControl({
  id,
  label,
  min,
  max,
  step,
  value,
  valueId,
  valueText,
}: {
  id: string;
  label: string;
  min: string;
  max: string;
  step: string;
  value: string;
  valueId: string;
  valueText: string;
}) {
  return (
    <label className="grid grid-cols-[6.5rem_minmax(8rem,1fr)_5.25rem] items-center gap-3 max-sm:grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] max-sm:gap-2">
      <span className="text-sm font-medium tracking-wide text-gray-900">{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} defaultValue={value} aria-label={label} className="w-full min-w-0 accent-gray-600" />
      <span id={valueId} className="text-right font-mono text-xs tabular-nums text-gray-700">{valueText}</span>
    </label>
  );
}
