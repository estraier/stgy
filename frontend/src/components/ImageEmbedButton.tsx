"use client";

import React, { useRef, useState } from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { presignImageUpload, uploadToPresigned, finalizeImage } from "@/api/media";

type Props = {
  /** アップロード完了後、本文へ挿入する Markdown を親へ通知 */
  onInsert: (markdown: string) => void;
  /** 配置用クラス */
  className?: string;
  /** ボタンの title */
  title?: string;
  /** ボタンの中身を差し替えたい場合 */
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
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList) {
    if (!userId || files.length === 0) return;
    setUploading(true);
    try {
      // シンプル化：1枚だけ扱う（必要なら複数対応に拡張可）
      const file = files[0];
      const presigned = await presignImageUpload(userId, file.name, file.size);
      await uploadToPresigned(presigned, file, file.name, file.type);
      const obj = await finalizeImage(userId, presigned.objectKey);

      // プレーンな埋め込み記法のみ（マクロ無し）
      const md = `![](/images/${obj.key})\n`;
      onInsert(md);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const disabled = status.state !== "authenticated" || uploading;

  return (
    <div className={"relative " + className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
        disabled={disabled}
      />
      <button
        type="button"
        className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 disabled:opacity-50"
        onClick={() => inputRef.current?.click()}
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
            画像
          </span>
        )}
      </button>
    </div>
  );
}
