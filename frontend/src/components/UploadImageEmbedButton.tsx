"use client";

import { Config } from "@/config";
import React, { useRef, useState, useCallback } from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import ImageUploadDialog, { DialogFileItem, UploadResult } from "@/components/ImageUploadDialog";
import { Upload as UploadIcon } from "lucide-react";

type Props = {
  onInsert: (markdown: string) => void;
  className?: string;
  title?: string;
};

export default function UploadImageEmbedButton({
  onInsert,
  className = "",
  title = "Upload images",
}: Props) {
  const status = useRequireLogin();
  const userId = status.state === "authenticated" ? status.session.userId : undefined;

  const inputRef = useRef<HTMLInputElement>(null);
  const [dialogFiles, setDialogFiles] = useState<DialogFileItem[] | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const pickFiles = useCallback(() => {
    if (!userId) return;
    inputRef.current?.click();
  }, [userId]);

  const onFilesChosen = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0 || !userId) return;
      const files = Array.from(list).slice(0, Config.MEDIA_IMAGE_COUNT_LIMIT_ONCE);
      const mapped: DialogFileItem[] = files.map((f) => ({
        id: cryptoRandomId(),
        file: f,
        name: f.name,
        type: f.type,
        size: f.size,
      }));
      setDialogFiles(mapped);
      setShowDialog(true);
      if (inputRef.current) inputRef.current.value = "";
    },
    [userId],
  );

  const handleComplete = useCallback(
    (results: UploadResult[]) => {
      const oks = results.filter((r): r is Extract<UploadResult, { ok: true }> => r.ok);
      const errs = results.filter((r): r is Extract<UploadResult, { ok: false }> => !r.ok);

      if (oks.length > 0 || errs.length > 0) {
        const useGrid = oks.length >= 2;
        const mdParts: string[] = [];

        if (oks.length > 0) {
          mdParts.push(...oks.map((r) => `![](/images/${r.objectKey})${useGrid ? "{grid}" : ""}`));
        }
        if (errs.length > 0) {
          mdParts.push(...errs.map((e) => `> Upload error: **${e.name}** — ${e.error}`));
        }

        onInsert(mdParts.join("\n") + "\n");
      }

      setShowDialog(false);
      setDialogFiles(null);
    },
    [onInsert],
  );

  const handleClose = useCallback(() => {
    setShowDialog(false);
    setDialogFiles(null);
  }, []);

  const disabled = status.state !== "authenticated";

  return (
    <div className={"relative " + className}>
      <input
        ref={inputRef}
        type="file"
        accept={Config.IMAGE_ALLOWED_TYPES}
        multiple
        className="hidden"
        onChange={(e) => onFilesChosen(e.target.files)}
        disabled={disabled}
      />
      <button
        type="button"
        className="inline-flex h-6 px-2 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none"
        onClick={pickFiles}
        disabled={disabled}
        title={title}
      >
        <span className="inline-flex items-center gap-1 leading-none">
          <UploadIcon className="w-4 h-4 opacity-80" aria-hidden />
        </span>
      </button>

      {showDialog && dialogFiles && userId && (
        <ImageUploadDialog
          userId={userId}
          files={dialogFiles}
          maxCount={Config.MEDIA_IMAGE_COUNT_LIMIT_ONCE}
          onClose={handleClose}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}
