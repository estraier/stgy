"use client";

import { Config } from "@/config";
import React, {
  useRef,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import ImageUploadDialog, { DialogFileItem, UploadResult } from "@/components/ImageUploadDialog";
import { Upload as UploadIcon } from "lucide-react";

export type UploadImageEmbedButtonHandle = {
  openWithFiles: (files: File[]) => void;
};

type Props = {
  onInsert: (markdown: string) => void;
  className?: string;
  title?: string;
};

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

const UploadImageEmbedButton = forwardRef<UploadImageEmbedButtonHandle, Props>(function UploadImageEmbedButton(
  {
    onInsert,
    className = "",
    title = "Upload images",
  }: Props,
  ref,
) {
  const status = useRequireLogin();
  const userId = status.state === "authenticated" ? status.session.userId : undefined;

  const inputRef = useRef<HTMLInputElement>(null);
  const [dialogFiles, setDialogFiles] = useState<DialogFileItem[] | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const textExts = useMemo(() => new Set(["txt", "text", "md", "markdown"]), []);
  const imageExts = useMemo(
    () =>
      new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "tif", "tiff", "gif", "bmp", "svg"]),
    [],
  );

  const isTextFile = useCallback(
    (f: File) => {
      const ext = f.name.toLowerCase().split(".").pop() || "";
      return f.type.startsWith("text/") || f.type === "text/markdown" || textExts.has(ext);
    },
    [textExts],
  );

  const isImageFile = useCallback(
    (f: File) => {
      const ext = f.name.toLowerCase().split(".").pop() || "";
      return f.type.startsWith("image/") || imageExts.has(ext);
    },
    [imageExts],
  );

  const normalizeText = useCallback((s: string) => {
    const noBom = s.replace(/^\uFEFF/, "");
    const lf = noBom.replace(/\r\n?/g, "\n");
    const nfc = typeof lf.normalize === "function" ? lf.normalize("NFC") : lf;
    return nfc.endsWith("\n") ? nfc : nfc + "\n";
  }, []);

  const pickFiles = useCallback(() => {
    if (!userId) return;
    inputRef.current?.click();
  }, [userId]);

  const onFilesChosen = useCallback(
    async (list: FileList | File[] | null) => {
      if (!list || (list instanceof FileList && list.length === 0) || (Array.isArray(list) && list.length === 0)) {
        return;
      }

      const files = Array.isArray(list) ? list : Array.from(list);
      const textFiles = files.filter(isTextFile);
      const imageFiles = files.filter(isImageFile);

      if (textFiles.length > 0) {
        const results = await Promise.all(
          textFiles.map(async (f) => {
            try {
              const raw = await f.text();
              return { ok: true as const, content: normalizeText(raw) };
            } catch (e) {
              return { ok: false as const, name: f.name, error: String(e) };
            }
          }),
        );
        const oks = results.filter((r) => r.ok) as { ok: true; content: string }[];
        const errs = results.filter((r) => !r.ok) as { ok: false; name: string; error: string }[];
        const parts: string[] = [];
        if (oks.length > 0) parts.push(...oks.map((r) => r.content));
        if (errs.length > 0)
          parts.push(...errs.map((e) => `> Upload error: **${e.name}** — ${e.error}\n`));
        if (parts.length > 0) onInsert(parts.join(""));
      }

      if (imageFiles.length > 0 && userId) {
        const limited = imageFiles.slice(0, Config.MEDIA_IMAGE_COUNT_LIMIT_ONCE);
        const mapped: DialogFileItem[] = limited.map((f) => ({
          id: cryptoRandomId(),
          file: f,
          name: f.name,
          type: f.type,
          size: f.size,
        }));
        setDialogFiles(mapped);
        setShowDialog(true);
      }

      if (inputRef.current && list instanceof FileList) inputRef.current.value = "";
    },
    [onInsert, userId, isTextFile, isImageFile, normalizeText],
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
    <div className={"relative " + className}>
      <input
        ref={inputRef}
        type="file"
        accept={`${Config.IMAGE_ALLOWED_TYPES},${Config.TEXT_ALLOWED_TYPES}`}
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
});

export default UploadImageEmbedButton;
