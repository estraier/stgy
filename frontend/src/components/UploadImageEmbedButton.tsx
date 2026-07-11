"use client";

import { Config } from "@/config";
import React, { useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import ImageUploadDialog, { DialogFileItem, UploadResult } from "@/components/ImageUploadDialog";
import TrackUploadDialog, {
  TrackDialogFileItem,
  TrackUploadResult,
} from "@/components/TrackUploadDialog";
import { classifyEditorUploadFiles, getEditorUploadSelectionError } from "@/utils/uploadFiles";
import { makeTrackMarkdown } from "@/utils/tracks";
import { Upload as UploadIcon, X as CloseIcon } from "lucide-react";

export type UploadImageEmbedButtonHandle = {
  openWithFiles: (files: File[]) => void;
};

type Props = {
  onInsert: (markdown: string) => void;
  className?: string;
  title?: string;
};

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

const UploadImageEmbedButton = forwardRef<UploadImageEmbedButtonHandle, Props>(
  function UploadImageEmbedButton(
    { onInsert, className = "", title = "Upload images or tracks" }: Props,
    ref,
  ) {
    const status = useRequireLogin();
    const userId = status.state === "authenticated" ? status.session.userId : undefined;

    const inputRef = useRef<HTMLInputElement>(null);
    const [imageDialogFiles, setImageDialogFiles] = useState<DialogFileItem[] | null>(null);
    const [trackDialogFiles, setTrackDialogFiles] = useState<TrackDialogFileItem[] | null>(null);
    const [selectionError, setSelectionError] = useState<string | null>(null);

    const normalizeText = useCallback((value: string) => {
      const noBom = value.replace(/^\uFEFF/, "");
      const lf = noBom.replace(/\r\n?/g, "\n");
      const nfc = typeof lf.normalize === "function" ? lf.normalize("NFC") : lf;
      return nfc.endsWith("\n") ? nfc : nfc + "\n";
    }, []);

    const pickFiles = useCallback(() => {
      if (!userId) return;
      setSelectionError(null);
      inputRef.current?.click();
    }, [userId]);

    const resetNativeInput = useCallback((list: FileList | File[] | null) => {
      if (inputRef.current && list instanceof FileList) {
        inputRef.current.value = "";
      }
    }, []);

    const onFilesChosen = useCallback(
      async (list: FileList | File[] | null) => {
        if (
          !list ||
          (list instanceof FileList && list.length === 0) ||
          (Array.isArray(list) && list.length === 0)
        ) {
          return;
        }

        setSelectionError(null);
        const files = Array.isArray(list) ? list : Array.from(list);
        const classified = classifyEditorUploadFiles(files);

        const nextSelectionError = getEditorUploadSelectionError(classified);
        if (nextSelectionError) {
          setSelectionError(nextSelectionError);
          resetNativeInput(list);
          return;
        }

        if (classified.textFiles.length > 0) {
          const results = await Promise.all(
            classified.textFiles.map(async (file) => {
              try {
                const raw = await file.text();
                return { ok: true as const, content: normalizeText(raw) };
              } catch (caught: unknown) {
                return {
                  ok: false as const,
                  name: file.name,
                  error: caught instanceof Error ? caught.message : String(caught),
                };
              }
            }),
          );
          const parts = results.map((result) =>
            result.ok ? result.content : `> Upload error: **${result.name}** — ${result.error}\n`,
          );
          if (parts.length > 0) onInsert(parts.join(""));
        }

        if (classified.imageFiles.length > 0 && userId) {
          const limited = classified.imageFiles.slice(0, Config.MEDIA_IMAGE_COUNT_LIMIT_ONCE);
          setImageDialogFiles(
            limited.map((file) => ({
              id: cryptoRandomId(),
              file,
              name: file.name,
              type: file.type,
              size: file.size,
            })),
          );
        }

        if (classified.trackFiles.length > 0 && userId) {
          const maxCount = Config.MEDIA_TRACK_COUNT_LIMIT_ONCE || 12;
          const limited = classified.trackFiles.slice(0, maxCount);
          setTrackDialogFiles(
            limited.map((file) => ({
              id: cryptoRandomId(),
              file,
              name: file.name,
              type: file.type,
              size: file.size,
            })),
          );
        }

        resetNativeInput(list);
      },
      [normalizeText, onInsert, resetNativeInput, userId],
    );

    const handleImageComplete = useCallback(
      (results: UploadResult[]) => {
        const markdown = results.map((result) =>
          result.ok
            ? `![](/images/${result.objectKey}){grid}`
            : `> Upload error: **${result.name}** — ${result.error}`,
        );
        if (markdown.length > 0) onInsert(markdown.join("\n") + "\n");
        setImageDialogFiles(null);
      },
      [onInsert],
    );

    const handleTrackComplete = useCallback(
      (results: TrackUploadResult[]) => {
        const markdown = results.map((result) =>
          result.ok
            ? makeTrackMarkdown({ previewKey: result.previewKey })
            : `> Upload error: **${result.name}** — ${result.error}`,
        );
        if (markdown.length > 0) onInsert(markdown.join("\n\n") + "\n");
        setTrackDialogFiles(null);
      },
      [onInsert],
    );

    useImperativeHandle(
      ref,
      () => ({
        openWithFiles(files: File[]) {
          void onFilesChosen(files);
        },
      }),
      [onFilesChosen],
    );

    const disabled = status.state !== "authenticated";

    return (
      <div className={`relative ${className}`}>
        <input
          ref={inputRef}
          type="file"
          accept={[
            Config.IMAGE_ALLOWED_TYPES,
            Config.TEXT_ALLOWED_TYPES,
            Config.TRACK_ALLOWED_TYPES,
          ].join(",")}
          multiple
          className="hidden"
          onChange={(event) => void onFilesChosen(event.target.files)}
          disabled={disabled}
        />
        <button
          type="button"
          className={
            "inline-flex h-6 px-2 items-center justify-center rounded border " +
            "border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 " +
            "disabled:opacity-50 leading-none"
          }
          onClick={pickFiles}
          disabled={disabled}
          title={title}
        >
          <span className="inline-flex items-center gap-1 leading-none">
            <UploadIcon className="w-4 h-4 opacity-80" aria-hidden />
          </span>
        </button>

        {selectionError && (
          <div
            className={
              "absolute left-0 top-full z-[1200] mt-1 flex w-80 max-w-[80vw] " +
              "items-start gap-2 rounded border border-red-300 bg-red-50 px-2 py-1.5 " +
              "text-xs text-red-700 shadow"
            }
            role="alert"
          >
            <span className="flex-1">{selectionError}</span>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 hover:bg-red-100"
              onClick={() => setSelectionError(null)}
              aria-label="Dismiss upload error"
            >
              <CloseIcon className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}

        {imageDialogFiles && userId && (
          <ImageUploadDialog
            userId={userId}
            files={imageDialogFiles}
            maxCount={Config.MEDIA_IMAGE_COUNT_LIMIT_ONCE}
            onClose={() => setImageDialogFiles(null)}
            onComplete={handleImageComplete}
          />
        )}

        {trackDialogFiles && userId && (
          <TrackUploadDialog
            userId={userId}
            files={trackDialogFiles}
            maxCount={Config.MEDIA_TRACK_COUNT_LIMIT_ONCE || 12}
            onClose={() => setTrackDialogFiles(null)}
            onComplete={handleTrackComplete}
          />
        )}
      </div>
    );
  },
);

export default UploadImageEmbedButton;
