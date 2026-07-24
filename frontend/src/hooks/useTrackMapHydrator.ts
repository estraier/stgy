"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SyntheticEvent } from "react";
import {
  ALLOWED_TRACK_IMAGE_PATTERNS,
  rewriteTrackImageUrl as defaultRewriteTrackImageUrl,
  type TrackImageUrlRewriter,
} from "@/utils/trackImageUrl";

const DEFAULT_INTERSECTION_ROOT_MARGIN = "0px";

type TrackModule = typeof import("stgy-track");
type TrackRenderer = InstanceType<TrackModule["StgyTrackRenderer"]>;

let trackModulePromise: Promise<TrackModule> | null = null;

function loadTrackModule(): Promise<TrackModule> {
  if (!trackModulePromise) {
    trackModulePromise = import("stgy-track");
  }
  return trackModulePromise;
}

export function stopTrackMapEvent(e: SyntheticEvent) {
  const target = e.target;
  if (target instanceof Element && target.closest(".stgy-track-map, .stgy-track-graph")) {
    e.stopPropagation();
  }
}

export type TrackMapHydratorOptions = {
  lazy?: boolean;
  redrawDelayMs?: number;
  intersectionRootMargin?: string;
  allowedImagePatterns?: RegExp[] | null;
  rewriteImageUrl?: TrackImageUrlRewriter | null;
};

type PendingRoot = {
  cancelers: Set<() => void>;
};

function trackMapFigures(root: HTMLElement): HTMLElement[] {
  const figures = Array.from(root.querySelectorAll<HTMLElement>(".stgy-track-map"));
  if (root.matches(".stgy-track-map")) figures.unshift(root);
  return figures;
}

function setTrackLoadError(figure: HTMLElement, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const canvas = figure.querySelector<HTMLElement>(".stgy-track-canvas");
  if (canvas) {
    canvas.textContent = `Track renderer could not be loaded: ${message}`;
  }
}

export function destroyTrackMaps(root: HTMLElement | null): void {
  if (!root) return;
  const figures = trackMapFigures(root);
  if (figures.length === 0) return;
  void loadTrackModule()
    .then(({ StgyTrackRenderer }) => {
      const renderer = new StgyTrackRenderer();
      figures.forEach((figure) => renderer.destroy(figure));
    })
    .catch(() => {
      // Destruction is best-effort. Detached DOM will still be collected.
    });
}

export function useTrackMapHydrator(options: TrackMapHydratorOptions = {}) {
  const {
    lazy = true,
    redrawDelayMs = 0,
    intersectionRootMargin = DEFAULT_INTERSECTION_ROOT_MARGIN,
    allowedImagePatterns = ALLOWED_TRACK_IMAGE_PATTERNS,
    rewriteImageUrl = defaultRewriteTrackImageUrl,
  } = options;
  const mountedRef = useRef(true);
  const pendingByRootRef = useRef(new WeakMap<HTMLElement, PendingRoot>());
  const pendingRootsRef = useRef(new Set<PendingRoot>());
  const rendererRef = useRef<TrackRenderer | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const pendingRoots = pendingRootsRef.current;
    return () => {
      mountedRef.current = false;
      pendingRoots.forEach((pending) => {
        pending.cancelers.forEach((cancel) => cancel());
        pending.cancelers.clear();
      });
      pendingRoots.clear();
      pendingByRootRef.current = new WeakMap<HTMLElement, PendingRoot>();
    };
  }, []);

  return useCallback(
    (root: HTMLElement | null) => {
      if (!root) return;

      const previousPending = pendingByRootRef.current.get(root);
      if (previousPending) {
        previousPending.cancelers.forEach((cancel) => cancel());
        previousPending.cancelers.clear();
        pendingRootsRef.current.delete(previousPending);
      }

      const maps = trackMapFigures(root).filter((figure) => {
        return !figure.dataset.stgyTrackInitialized;
      });
      if (maps.length === 0) return;

      const pending: PendingRoot = {
        cancelers: new Set(),
      };
      pendingByRootRef.current.set(root, pending);
      pendingRootsRef.current.add(pending);

      const isCurrent = (figure: HTMLElement) => {
        return (
          mountedRef.current && figure.isConnected && pendingByRootRef.current.get(root) === pending
        );
      };

      const getRenderer = async (): Promise<TrackRenderer> => {
        if (rendererRef.current) return rendererRef.current;
        const { StgyTrackRenderer } = await loadTrackModule();
        if (!rendererRef.current) {
          rendererRef.current = new StgyTrackRenderer({
            allowedImagePatterns: allowedImagePatterns ?? undefined,
            rewriteImageUrl: rewriteImageUrl ?? undefined,
          });
        }
        return rendererRef.current;
      };

      maps.forEach((figure) => {
        let observer: IntersectionObserver | null = null;
        let timer: number | null = null;
        let finished = false;

        const cleanup = () => {
          if (finished) return;
          finished = true;
          observer?.disconnect();
          observer = null;
          if (timer != null) {
            window.clearTimeout(timer);
            timer = null;
          }
          pending.cancelers.delete(cleanup);
          if (pending.cancelers.size === 0) {
            pendingRootsRef.current.delete(pending);
          }
        };
        pending.cancelers.add(cleanup);

        const hydrate = () => {
          if (!isCurrent(figure)) {
            cleanup();
            return;
          }
          if (lazy && figure.getClientRects().length === 0) {
            return;
          }
          cleanup();
          delete figure.dataset.stgyTrackRedraw;
          void getRenderer()
            .then((renderer) => {
              if (!mountedRef.current || !figure.isConnected) return;
              renderer.hydrate(figure);
            })
            .catch((error: unknown) => {
              if (!mountedRef.current || !figure.isConnected) return;
              setTrackLoadError(figure, error);
            });
        };

        const scheduleHydrate = () => {
          if (!isCurrent(figure)) {
            cleanup();
            return;
          }
          const delay = figure.dataset.stgyTrackRedraw === "true" ? redrawDelayMs : 0;
          if (delay <= 0) {
            hydrate();
            return;
          }
          timer = window.setTimeout(() => {
            timer = null;
            hydrate();
          }, delay);
        };

        if (lazy && typeof IntersectionObserver !== "undefined") {
          observer = new IntersectionObserver(
            (entries) => {
              const entry = entries[entries.length - 1];
              if (!entry) return;
              if (entry.isIntersecting) {
                if (timer == null) scheduleHydrate();
              } else if (timer != null) {
                window.clearTimeout(timer);
                timer = null;
              }
            },
            { root: null, rootMargin: intersectionRootMargin, threshold: 0 },
          );
          observer.observe(figure);
        } else {
          scheduleHydrate();
        }
      });
    },
    [
      allowedImagePatterns,
      intersectionRootMargin,
      lazy,
      redrawDelayMs,
      rewriteImageUrl,
    ],
  );
}
