"use client";

import { Config } from "@/config";
import React, { useRef, useState, useCallback } from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import ImageUploadDialog, { DialogFileItem, UploadResult } from "@/components/ImageUploadDialog";

type Props = {
  onInsert: (markdown: string) => void;
  className?: string;
  title?: string;
  children?: React.ReactNode;
};

export default function ImageEmbedButton({
  onInsert,
  className = "",
  title = "Insert image",
  children,
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
      const files = Array.from(list).slice(0, 5);
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
        className="px-2 py-1 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50"
        onClick={pickFiles}
        disabled={disabled}
        title={title}
      >
        {children ?? (
          <span className="inline-flex items-center gap-1">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className="opacity-80">
              <path
                fill="currentColor"
                d="M21 19V5a2 2 0 0 0-2-2H5C3.89 3 3 3.9 3 5v14a2 2 0 0 0 2 2h14c1.11 0 2-.9 2-2M8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5M8 8a2 2 0 1 1 4 0a2 2 0 0 1-4 0Z"
              />
            </svg>
            Image
          </span>
        )}
      </button>

      {showDialog && dialogFiles && userId && (
        <ImageUploadDialog
          userId={userId}
          files={dialogFiles}
          maxCount={5}
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
