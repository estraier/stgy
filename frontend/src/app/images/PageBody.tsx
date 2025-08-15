"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import type { MediaObject } from "@/api/models";
import {
  listImages,
  presignImageUpload,
  uploadToPresigned,
  finalizeImage,
  deleteImage,
} from "@/api/media";

const PAGE_SIZE = 30;

export default function PageBody() {
  const status = useRequireLogin();
  const [items, setItems] = useState<MediaObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const userId = status.state === "authenticated" ? status.session.userId : undefined;
  const isAdmin = status.state === "authenticated" ? !!status.session.userIsAdmin : false;

  const offset = useMemo(() => (page - 1) * PAGE_SIZE, [page]);

  function restPathFromKey(key: string, uid: string): string {
    const needle = `${uid}/`;
    const i = key.indexOf(needle);
    return i >= 0 ? key.slice(i + needle.length) : key;
  }

  async function load() {
    if (status.state !== "authenticated") return;
    setLoading(true);
    setError(null);
    try {
      const data = await listImages(userId!, { offset, limit: PAGE_SIZE + 1 });
      setHasNext(data.length > PAGE_SIZE);
      setItems(data.slice(0, PAGE_SIZE));
    } catch (e: unknown) {
      setItems([]);
      setHasNext(false);
      setError(e instanceof Error ? e.message : "Failed to load images.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/exhaustive-deps
  }, [status.state, userId, offset]);

  async function handleFiles(files: FileList) {
    if (status.state !== "authenticated") return;
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const presigned = await presignImageUpload(userId!, file.name, file.size);
        await uploadToPresigned(presigned, file, file.name, file.type);
        await finalizeImage(userId!, presigned.objectKey);
      }
      setPage(1);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(obj: MediaObject) {
    if (status.state !== "authenticated") return;
    const restPath = restPathFromKey(obj.key, userId!);
    const ok = confirm("Delete this image?");
    if (!ok) return;
    try {
      await deleteImage(userId!, restPath);
      setItems((prev) => prev.filter((x) => !(x.bucket === obj.bucket && x.key === obj.key)));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to delete.");
    }
  }

  if (status.state !== "authenticated") return null;

  return (
    <main className="max-w-5xl mx-auto mt-8 p-4">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-semibold">Images</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files);
            }}
            disabled={uploading || !isAdmin}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !isAdmin}
            className={`px-3 py-1 rounded border transition ${
              uploading || !isAdmin
                ? "bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed"
                : "bg-gray-300 text-gray-900 border-gray-700 hover:bg-gray-400"
            }`}
            title={isAdmin ? "" : "Only admin can upload"}
          >
            {uploading ? "Uploading…" : "Upload images"}
          </button>
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {loading && <div className="text-gray-500">Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="text-gray-500">No images.</div>
      )}

      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {items.map((obj) => (
          <li key={`${obj.bucket}/${obj.key}`} className="group relative">
            <button
              className="block w-full aspect-square overflow-hidden rounded border border-gray-300 bg-gray-50"
              onClick={() => setPreviewUrl(obj.publicUrl)}
              title="Open"
            >
              <img
                src={obj.publicUrl}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition">
              <button
                onClick={() => handleDelete(obj)}
                className="px-2 py-0.5 text-xs rounded border border-red-200 text-red-600 bg-white/90 hover:bg-red-50"
                title="Delete"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex justify-center gap-4">
        <button
          className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setPage((p) => Math.max(p - 1, 1))}
          disabled={page === 1}
        >
          Prev
        </button>
        <span className="text-gray-800">Page {page}</span>
        <button
          className="px-3 py-1 rounded border text-gray-800 bg-blue-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setPage((p) => (hasNext ? p + 1 : p))}
          disabled={!hasNext}
        >
          Next
        </button>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="bg-white rounded shadow max-w-[90vw] max-h-[90vh] p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end">
              <button
                className="px-2 py-0.5 text-sm rounded border border-gray-300 hover:bg-gray-100"
                onClick={() => setPreviewUrl(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-2">
              <img
                src={previewUrl}
                alt=""
                className="max-w-[85vw] max-h-[80vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
