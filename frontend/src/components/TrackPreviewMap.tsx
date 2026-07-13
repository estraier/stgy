"use client";

import { useEffect, useRef, useState } from "react";

const TRACK_DATA_LOADED_EVENT = "stgy-track-data-loaded";

type TrackDataLoadedEventDetail = {
  source?: unknown;
  data?: unknown;
};

type Props = {
  src: string;
  lazy?: boolean;
  interactive?: boolean;
  controls?: boolean;
  graph?: boolean;
  overlay?: boolean;
  onTrackData?: (data: unknown) => void;
};

export default function TrackPreviewMap({
  src,
  lazy = false,
  interactive = true,
  controls = true,
  graph = false,
  overlay = false,
  onTrackData,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onTrackDataRef = useRef(onTrackData);
  const [visible, setVisible] = useState(!lazy);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    onTrackDataRef.current = onTrackData;
  }, [onTrackData]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const handleTrackDataLoaded = (event: Event) => {
      const detail = (event as CustomEvent<TrackDataLoadedEventDetail>).detail;
      if (detail?.source === src) {
        onTrackDataRef.current?.(detail.data);
      }
    };

    root.addEventListener(TRACK_DATA_LOADED_EVENT, handleTrackDataLoaded);
    return () => root.removeEventListener(TRACK_DATA_LOADED_EVENT, handleTrackDataLoaded);
  }, [src]);

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
  }, [controls, graph, overlay, src, visible]);

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
        data-show-graph={graph ? undefined : "false"}
        data-show-overlay={overlay ? undefined : "false"}
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
