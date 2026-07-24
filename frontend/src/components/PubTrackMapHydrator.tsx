"use client";

import { useEffect } from "react";
import { STGY_TRACK_RENDERER_IMAGE_OPTIONS } from "@/utils/trackImageUrl";

type Props = {
  htmlKey: string;
  selector?: string;
};

const DEFAULT_SELECTOR = ".pub-main .markdown-body.post-content";

export default function PubTrackMapHydrator({
  htmlKey,
  selector = DEFAULT_SELECTOR,
}: Props) {
  useEffect(() => {
    let cancelled = false;
    let frame1: number | null = null;
    let frame2: number | null = null;

    frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => {
        if (cancelled) return;

        const root = document.querySelector<HTMLElement>(selector);
        if (!root || !root.querySelector(".stgy-track-map")) return;

        void import("stgy-track")
          .then(({ StgyTrackRenderer }) => {
            if (cancelled) return;
            new StgyTrackRenderer(STGY_TRACK_RENDERER_IMAGE_OPTIONS).hydrate(root);
          })
          .catch(() => {});
      });
    });

    return () => {
      cancelled = true;
      if (frame1 !== null) window.cancelAnimationFrame(frame1);
      if (frame2 !== null) window.cancelAnimationFrame(frame2);
    };
  }, [htmlKey, selector]);

  return null;
}
