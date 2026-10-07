"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type LightboxImage = {
  src: string;
  alt: string;
};

export default function PubImageBlockBinder() {
  const [image, setImage] = useState<LightboxImage | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setImage(null);
  }, []);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const block = target.closest(".image-block");
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
      setImage({ src, alt: img.alt || "" });
    }

    document.body.addEventListener("click", handleClick);
    return () => document.body.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!image) return;

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
  }, [close, image]);

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
      {/* The lightbox must display the exact article image URL without Next.js image rewriting. */}
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
