"use client";

import React, { useCallback, useState } from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import ExistingImageEmbedDialog from "@/components/ExistingImageEmbedDialog";
import { LayoutGrid as GridIcon } from "lucide-react";

type Props = {
  onInsert: (markdown: string) => void;
  className?: string;
  title?: string;
};

export default function ExistingImageEmbedButton({
  onInsert,
  className = "",
  title = "Insert from library",
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
    (keys: string[]) => {
      if (keys.length === 0) {
        setOpen(false);
        return;
      }
      const useGrid = keys.length >= 2;
      const md = keys.map((k) => `![](/images/${k})${useGrid ? "{grid}" : ""}`).join("\n") + "\n";
      onInsert(md);
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
          <GridIcon className="w-4 h-4 opacity-80" aria-hidden />
        </span>
      </button>

      {open && userId && (
        <ExistingImageEmbedDialog userId={userId} onClose={handleClose} onEmbed={handleEmbed} />
      )}
    </div>
  );
}
