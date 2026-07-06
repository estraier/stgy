"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SyntheticEvent } from "react";

const ALLOWED_TRACK_IMAGE_PATTERNS: RegExp[] = [
  /^\/images\//,
  /^\/data\//,
  /^\/media\//,
];

export function stopTrackMapEvent(e: SyntheticEvent) {
  const target = e.target;
  if (target instanceof HTMLElement && target.closest(".stgy-track-map")) {
    e.stopPropagation();
  }
}

export function useTrackMapHydrator() {
  const mountedRef = useRef(true);
  const nextSeqRef = useRef(0);
  const rootSeqRef = useRef(new WeakMap<HTMLElement, number>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      rootSeqRef.current = new WeakMap<HTMLElement, number>();
    };
  }, []);

  return useCallback((root: HTMLElement | null) => {
    if (!root) return;
    const maps = Array.from(root.querySelectorAll<HTMLElement>(".stgy-track-map"));
    if (maps.length === 0) return;

    const needsHydration = maps.some((figure) => {
      return !figure.dataset.stgyTrackInitialized;
    });
    if (!needsHydration) return;

    const hydrateSeq = ++nextSeqRef.current;
    rootSeqRef.current.set(root, hydrateSeq);

    maps.forEach((figure) => {
      delete figure.dataset.stgyTrackInitialized;
      const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
      if (!canvas) return;
      const nextCanvas = canvas.cloneNode(false) as HTMLElement;
      canvas.replaceWith(nextCanvas);
    });
    root.querySelectorAll(".stgy-track-graph").forEach((node) => node.remove());

    void import("stgy-track")
      .then(({ StgyTrackRenderer }) => {
        if (!mountedRef.current) return;
        if (!root.isConnected) return;
        if (rootSeqRef.current.get(root) !== hydrateSeq) return;

        const renderer = new StgyTrackRenderer({
          allowedImagePatterns: ALLOWED_TRACK_IMAGE_PATTERNS,
        });
        renderer.hydrate(root);
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        if (!root.isConnected) return;
        if (rootSeqRef.current.get(root) !== hydrateSeq) return;

        const message = e instanceof Error ? e.message : String(e);
        root.querySelectorAll<HTMLElement>(".stgy-track-canvas").forEach((canvas) => {
          canvas.textContent = `Track renderer could not be loaded: ${message}`;
        });
      });
  }, []);
}
