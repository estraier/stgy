"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Config } from "@/config";
import type { MediaObject } from "@/api/models";
import { listImages } from "@/api/media";

type Props = {
  userId: string;
  onClose: () => void;
  onEmbed: (keys: string[]) => void;
};

const PAGE_SIZE = Config.IMAGES_PAGE_SIZE || 30;

export default function ExistingImageEmbedDialog({ userId, onClose, onEmbed }: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);

  const [items, setItems] = useState<MediaObject[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => setMounted(true), []);

  const safeClose = useCallback(() => {
    setVisible(false);
    queueMicrotask(onClose);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") safeClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeClose]);

  const offset = useMemo(() => (page - 1) * PAGE_SIZE, [page]);

  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!userId || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setErr(null);
    try {
      const data = await listImages(userId, { offset, limit: PAGE_SIZE + 1 });
      const nextHasNext = data.length > PAGE_SIZE;
      const pageItems = data.slice(0, PAGE_SIZE);
      setHasNext(nextHasNext);
      setItems((prev) => (offset === 0 ? pageItems : [...prev, ...pageItems]));
    } catch (e) {
      setItems((prev) => (offset === 0 ? [] : prev));
      setHasNext(false);
      setErr(e instanceof Error ? e.message : "Failed to load images.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [userId, offset]);

  useEffect(() => {
    if (mounted && visible) load();
  }, [mounted, visible, load]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const canEmbed = selected.size > 0 && !loading;

  if (!mounted || !visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-[1000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={safeClose}
    >
      <div
        className="bg-white rounded shadow max-w-[95vw] max-h-[90vh] w-full sm:w-auto p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Choose images</h2>
          <button
            className="px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100"
            onClick={safeClose}
          >
            Close
          </button>
        </div>

        <div className="mt-3 min-w-[280px] max-w-[80vw]">
          {err && (
            <div className="mb-2 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
              {err}
            </div>
          )}
          {!err && !loading && items.length === 0 && (
            <div className="mb-2 p-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded">
              No images found.
            </div>
          )}

          <div className="overflow-auto max-h-[60vh]">
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {items.map((it) => {
                const isSel = selected.has(it.key);
                return (
                  <li key={it.key} className="relative">
                    <div
                      className={`relative aspect-square rounded border overflow-hidden cursor-pointer ${
                        isSel ? "ring-2 ring-blue-600" : "hover:shadow"
                      }`}
                      onClick={() => toggle(it.key)}
                      title={it.key}
                    >
                      <Image
                        src={it.publicUrl}
                        alt=""
                        fill
                        unoptimized
                        className="object-cover"
                        sizes="160px"
                      />
                      {isSel && (
                        <div className="absolute top-1 right-1 bg-blue-600 text-white text-[10px] px-1 rounded">
                          Selected
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-gray-600 break-all line-clamp-1">
                      {it.key}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {loading ? "Loading…" : `Total loaded: ${items.length}`}
            </div>
            <div className="flex items-center gap-2">
              {hasNext ? (
                <button
                  className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 text-sm disabled:opacity-50"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading}
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
            onClick={() => {
              onEmbed(Array.from(selected));
              safeClose();
            }}
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
