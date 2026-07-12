"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  lazy?: boolean;
  interactive?: boolean;
  controls?: boolean;
};

export default function TrackPreviewMap({
  src,
  lazy = false,
  interactive = true,
  controls = true,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!lazy || visible) return;
    const root = rootRef.current;
    if (!root) return;

    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    if (!visible) return;
    const root = rootRef.current;
    if (!root) return;

    let cancelled = false;
    let renderer: {
      hydrate: (element: HTMLElement) => void;
      destroy: (element: HTMLElement) => void;
    } | null = null;
    setLoadError(null);
    void import("stgy-track")
      .then(({ StgyTrackRenderer }) => {
        if (cancelled || !root.isConnected) return;
        renderer = new StgyTrackRenderer();
        renderer.hydrate(root);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      renderer?.destroy(root);
    };
  }, [src, visible]);

  return (
    <div
      ref={rootRef}
      className={`track-manager-map h-full w-full ${
        interactive ? "track-manager-interactive" : "track-manager-thumbnail"
      }`}
    >
      <figure
        className="stgy-track-map"
        data-src={src}
        data-show-graph="false"
        data-show-overlay="false"
        data-controls={controls ? undefined : "false"}
        style={{ height: "100%" }}
      >
        <div className="stgy-track-canvas" />
      </figure>
      {!visible && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
          Loading…
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-red-600 bg-red-50/90">
          {loadError}
        </div>
      )}
    </div>
  );
}
