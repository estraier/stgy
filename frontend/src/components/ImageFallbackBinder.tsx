"use client";

import { useEffect } from "react";
import { applyImageFallback } from "@/utils/imageFallback";

function replaceFailedImage(image: HTMLImageElement): void {
  if (image.complete && image.naturalWidth === 0) {
    applyImageFallback(image);
  }
}

export default function ImageFallbackBinder() {
  useEffect(() => {
    const handleError = (event: Event) => {
      if (event.target instanceof HTMLImageElement) {
        applyImageFallback(event.target);
      }
    };

    const scanNode = (node: Node) => {
      if (node instanceof HTMLImageElement) {
        replaceFailedImage(node);
        return;
      }
      if (node instanceof Element) {
        node.querySelectorAll("img").forEach(replaceFailedImage);
      }
    };

    document.addEventListener("error", handleError, true);
    document.querySelectorAll("img").forEach(replaceFailedImage);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(scanNode);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("error", handleError, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
