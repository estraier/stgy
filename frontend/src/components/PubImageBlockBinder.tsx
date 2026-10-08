"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPubPostMasterImage } from "@/api/posts";

type LightboxImage = {
  src: string;
  alt: string;
};

type Props = {
  pubMasterPostId?: string;
};

function isPublishedArticleThumbnail(img: HTMLImageElement): boolean {
  const src = img.currentSrc || img.src;
  if (!src) return false;
  try {
    return /\/thumbs\/(?:[^/]+\/)*[^/]+_image\.webp$/i.test(
      new URL(src, window.location.href).pathname,
    );
  } catch {
    return false;
  }
}

function findPublishedMediaIndex(img: HTMLImageElement): number | null {
  const article = img.closest(".post-content");
  if (!(article instanceof HTMLElement)) return null;
  const media = Array.from(
    article.querySelectorAll<HTMLImageElement | HTMLVideoElement>(
      "figure.image-block img, figure.image-block video, figure.featured-block img, figure.featured-block video",
    ),
  );
  const index = media.indexOf(img);
  return index >= 0 ? index : null;
}

export default function PubImageBlockBinder({ pubMasterPostId }: Props = {}) {
  const [image, setImage] = useState<LightboxImage | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const masterObjectUrlRef = useRef<string | null>(null);
  const masterRequestRef = useRef(0);

  const clearMasterObjectUrl = useCallback(() => {
    if (masterObjectUrlRef.current) {
      URL.revokeObjectURL(masterObjectUrlRef.current);
      masterObjectUrlRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    masterRequestRef.current += 1;
    clearMasterObjectUrl();
    setImage(null);
  }, [clearMasterObjectUrl]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const block = target.closest(
        pubMasterPostId ? ".image-block, .featured-block" : ".image-block",
      );
      if (!(block instanceof HTMLElement)) return;
      const img = block.querySelector("img");
      if (!(img instanceof HTMLImageElement)) return;

      const src = img.currentSrc || img.src;
      if (!src) return;

      event.preventDefault();
      event.stopPropagation();
      restoreFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const requestId = masterRequestRef.current + 1;
      masterRequestRef.current = requestId;
      clearMasterObjectUrl();
      setImage({ src, alt: img.alt || "" });

      if (!pubMasterPostId || !isPublishedArticleThumbnail(img)) return;
      const imageIndex = findPublishedMediaIndex(img);
      if (imageIndex === null) return;
      void getPubPostMasterImage(pubMasterPostId, imageIndex)
        .then((blob) => {
          if (masterRequestRef.current !== requestId) return;
          const objectUrl = URL.createObjectURL(blob);
          if (masterRequestRef.current !== requestId) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          clearMasterObjectUrl();
          masterObjectUrlRef.current = objectUrl;
          setImage((current) => current ? { ...current, src: objectUrl } : current);
        })
        .catch(() => {
          // Keep the already-visible article thumbnail when the master cannot be loaded.
        });
    }

    document.body.addEventListener("click", handleClick);
    return () => document.body.removeEventListener("click", handleClick);
  }, [clearMasterObjectUrl, pubMasterPostId]);

  useEffect(() => () => {
    masterRequestRef.current += 1;
    clearMasterObjectUrl();
  }, [clearMasterObjectUrl]);

  const isOpen = image !== null;

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    const frameId = requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [close, isOpen]);

  if (!image || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="stgy-article-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt ? `Image: ${image.alt}` : "Image preview"}
    >
      <button
        type="button"
        className="stgy-article-lightbox-backdrop"
        aria-label="Close image preview"
        tabIndex={-1}
        onClick={close}
      />
      <button
        ref={closeButtonRef}
        type="button"
        className="stgy-article-lightbox-close"
        aria-label="Close image preview"
        title="Close"
        onClick={close}
      >
        ×
      </button>
      {/* Keep the lightbox image outside Next.js image rewriting, including on-demand blob URLs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="stgy-article-lightbox-image"
        src={image.src}
        alt={image.alt}
        draggable={false}
      />
    </div>,
    document.body,
  );
}
