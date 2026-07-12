"use client";

import React, { useCallback, useState } from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import ExistingImageEmbedDialog from "@/components/ExistingImageEmbedDialog";
import { Images as ImagesIcon } from "lucide-react";
import { makeExistingMediaMarkdown } from "@/utils/mediaEmbed";
import type { ExistingMediaSelection } from "@/utils/mediaEmbed";

type Props = {
  onInsert: (markdown: string) => void;
  className?: string;
  title?: string;
};

export default function ExistingImageEmbedButton({
  onInsert,
  className = "",
  title = "Insert existing media",
}: Props) {
  const status = useRequireLogin();
  const userId = status.state === "authenticated" ? status.session.userId : undefined;

  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    if (!userId) return;
    setOpen(true);
  }, [userId]);

  const handleClose = useCallback(() => setOpen(false), []);

  const handleEmbed = useCallback(
    (selection: ExistingMediaSelection) => {
      const markdown = makeExistingMediaMarkdown(selection);
      if (markdown) onInsert(markdown);
      setOpen(false);
    },
    [onInsert],
  );

  const disabled = status.state !== "authenticated";

  return (
    <div className={"relative " + className}>
      <button
        type="button"
        className="inline-flex h-6 px-2 items-center justify-center rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-50 leading-none"
        onClick={handleOpen}
        disabled={disabled}
        title={title}
      >
        <span className="inline-flex items-center gap-1 leading-none">
          <ImagesIcon className="w-4 h-4 opacity-80" aria-hidden />
        </span>
      </button>

      {open && userId && (
        <ExistingImageEmbedDialog userId={userId} onClose={handleClose} onEmbed={handleEmbed} />
      )}
    </div>
  );
}
