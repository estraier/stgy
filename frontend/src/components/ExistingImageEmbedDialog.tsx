"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Config } from "@/config";
import type { MediaObject, TrackObject } from "@/api/models";
import { listImages } from "@/api/media";
import { listTracks } from "@/api/tracks";
import TrackPreviewMap from "@/components/TrackPreviewMap";
import { formatDateTime } from "@/utils/format";
import type { ExistingMediaSelection } from "@/utils/mediaEmbed";

type Props = {
  userId: string;
  onClose: () => void;
  onEmbed: (selection: ExistingMediaSelection) => void;
};

type MediaTab = "images" | "tracks";

const IMAGE_PAGE_SIZE = Config.IMAGES_PAGE_SIZE || 30;
const TRACK_PAGE_SIZE = Config.TRACKS_PAGE_SIZE || 30;

function parseIsoToDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function ExistingImageEmbedDialog({ userId, onClose, onEmbed }: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<MediaTab>("images");

  const [imageItems, setImageItems] = useState<MediaObject[]>([]);
  const [imagePage, setImagePage] = useState(1);
  const [imageHasNext, setImageHasNext] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  const [trackItems, setTrackItems] = useState<TrackObject[]>([]);
  const [trackPage, setTrackPage] = useState(1);
  const [trackHasNext, setTrackHasNext] = useState(false);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());

  const imageLoadingRef = useRef(false);
  const trackLoadingRef = useRef(false);
  const loadedTrackPageRef = useRef(0);

  useEffect(() => setMounted(true), []);

  const safeClose = useCallback(() => {
    setVisible(false);
    queueMicrotask(onClose);
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") safeClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeClose]);

  const imageOffset = useMemo(
    () => (imagePage - 1) * IMAGE_PAGE_SIZE,
    [imagePage],
  );
  const trackOffset = useMemo(
    () => (trackPage - 1) * TRACK_PAGE_SIZE,
    [trackPage],
  );

  const loadImages = useCallback(async () => {
    if (!userId || imageLoadingRef.current) return;
    imageLoadingRef.current = true;
    setImageLoading(true);
    setImageError(null);
    try {
      const data = await listImages(userId, {
        offset: imageOffset,
        limit: IMAGE_PAGE_SIZE + 1,
      });
      const pageItems = data.slice(0, IMAGE_PAGE_SIZE);
      setImageHasNext(data.length > IMAGE_PAGE_SIZE);
      setImageItems((current) =>
        imageOffset === 0 ? pageItems : [...current, ...pageItems],
      );
    } catch (caught: unknown) {
      setImageItems((current) => (imageOffset === 0 ? [] : current));
      setImageHasNext(false);
      setImageError(
        caught instanceof Error ? caught.message : "Failed to load images.",
      );
    } finally {
      imageLoadingRef.current = false;
      setImageLoading(false);
    }
  }, [imageOffset, userId]);

  const loadTracks = useCallback(async () => {
    if (
      !userId ||
      trackLoadingRef.current ||
      loadedTrackPageRef.current >= trackPage
    ) {
      return;
    }
    trackLoadingRef.current = true;
    setTrackLoading(true);
    setTrackError(null);
    try {
      const data = await listTracks(userId, {
        offset: trackOffset,
        limit: TRACK_PAGE_SIZE + 1,
      });
      const pageItems = data.slice(0, TRACK_PAGE_SIZE);
      setTrackHasNext(data.length > TRACK_PAGE_SIZE);
      setTrackItems((current) =>
        trackOffset === 0 ? pageItems : [...current, ...pageItems],
      );
      loadedTrackPageRef.current = trackPage;
    } catch (caught: unknown) {
      setTrackItems((current) => (trackOffset === 0 ? [] : current));
      setTrackHasNext(false);
      setTrackError(
        caught instanceof Error ? caught.message : "Failed to load tracks.",
      );
    } finally {
      trackLoadingRef.current = false;
      setTrackLoading(false);
    }
  }, [trackOffset, trackPage, userId]);

  useEffect(() => {
    if (mounted && visible) void loadImages();
  }, [loadImages, mounted, visible]);

  useEffect(() => {
    if (mounted && visible && activeTab === "tracks") void loadTracks();
  }, [activeTab, loadTracks, mounted, visible]);

  const toggleImage = useCallback((key: string) => {
    setSelectedImages((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleTrack = useCallback((key: string) => {
    setSelectedTracks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const currentLoading = activeTab === "images" ? imageLoading : trackLoading;
  const currentCount = activeTab === "images" ? imageItems.length : trackItems.length;
  const currentHasNext = activeTab === "images" ? imageHasNext : trackHasNext;
  const selectedCount =
    activeTab === "images" ? selectedImages.size : selectedTracks.size;
  const canEmbed = selectedCount > 0 && !currentLoading;

  const embedSelection = useCallback(() => {
    if (activeTab === "images") {
      onEmbed({ kind: "images", keys: Array.from(selectedImages) });
    } else {
      onEmbed({
        kind: "tracks",
        tracks: trackItems
          .filter((track) => selectedTracks.has(track.key))
          .map((track) => ({ previewKey: track.previewKey })),
      });
    }
    safeClose();
  }, [activeTab, onEmbed, safeClose, selectedImages, selectedTracks, trackItems]);

  if (!mounted || !visible) return null;

  const activeError = activeTab === "images" ? imageError : trackError;
  const emptyLabel = activeTab === "images" ? "No images found." : "No tracks found.";

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-[1000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={safeClose}
    >
      <div
        className="bg-white rounded shadow max-w-[95vw] max-h-[90vh] w-full sm:w-auto p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Select media</h2>
          <button
            className="px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100"
            onClick={safeClose}
          >
            Close
          </button>
        </div>

        <div className="mt-3 w-[80vw] max-w-[80rem] min-w-[280px]">
          <div
            className="mb-3 inline-flex rounded border border-gray-300 overflow-hidden"
            role="tablist"
            aria-label="Media type"
          >
            {(["images", "tracks"] as const).map((tab) => {
              const selected = activeTab === tab;
              const label = tab === "images" ? "Images" : "Tracks";
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`px-4 py-1.5 text-sm ${
                    selected
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {activeError && (
            <div className="mb-2 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
              {activeError}
            </div>
          )}
          {!activeError && !currentLoading && currentCount === 0 && (
            <div className="mb-2 p-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded">
              {emptyLabel}
            </div>
          )}

          <div className="overflow-auto max-h-[60vh]">
            {activeTab === "images" ? (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {imageItems.map((item) => {
                  const selected = selectedImages.has(item.key);
                  return (
                    <li key={item.key} className="relative">
                      <button
                        type="button"
                        className={`relative block w-full aspect-square rounded border overflow-hidden cursor-pointer ${
                          selected ? "ring-2 ring-blue-600" : "hover:shadow"
                        }`}
                        onClick={() => toggleImage(item.key)}
                        title={item.key}
                      >
                        <Image
                          src={item.publicUrl}
                          alt=""
                          fill
                          unoptimized
                          className="object-cover"
                          sizes="160px"
                        />
                        {selected && (
                          <span className="absolute top-1 right-1 bg-blue-600 text-white text-[10px] px-1 rounded">
                            Selected
                          </span>
                        )}
                      </button>
                      <div className="mt-1 text-[11px] text-gray-600 break-all line-clamp-1">
                        {item.key}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {trackItems.map((track) => {
                  const selected = selectedTracks.has(track.key);
                  const lastModified = parseIsoToDate(track.lastModified);
                  return (
                    <li key={`${track.bucket}/${track.key}`} className="relative">
                      <div
                        className={`relative block w-full aspect-square rounded border overflow-hidden bg-gray-50 ${
                          selected ? "ring-2 ring-blue-600" : "hover:shadow"
                        }`}
                      >
                        <div className="absolute inset-0">
                          <TrackPreviewMap
                            src={track.previewUrl}
                            lazy
                            interactive={false}
                            controls={false}
                          />
                        </div>
                        <button
                          type="button"
                          className="absolute inset-0 z-[700] cursor-pointer"
                          onClick={() => toggleTrack(track.key)}
                          title={track.previewKey}
                          aria-label="Select track"
                        />
                        {selected && (
                          <span className="absolute z-[710] top-1 right-1 bg-blue-600 text-white text-[10px] px-1 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis">
                        {lastModified ? formatDateTime(lastModified) : track.previewKey}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {currentLoading ? "Loading…" : `Total loaded: ${currentCount}`}
            </div>
            <div className="flex items-center gap-2">
              {currentHasNext ? (
                <button
                  className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 text-sm disabled:opacity-50"
                  onClick={() => {
                    if (activeTab === "images") setImagePage((page) => page + 1);
                    else setTrackPage((page) => page + 1);
                  }}
                  disabled={currentLoading}
                >
                  Load more
                </button>
              ) : (
                <span className="text-xs text-gray-400">No more</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
            onClick={safeClose}
          >
            Cancel
          </button>
          <button
            className={`px-3 py-1 rounded border ${
              canEmbed
                ? "border-blue-700 bg-blue-600 text-white hover:bg-blue-700"
                : "border-gray-300 bg-gray-200 text-gray-500 cursor-not-allowed"
            }`}
            onClick={embedSelection}
            disabled={!canEmbed}
          >
            Embed
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
