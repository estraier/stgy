"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __stgyImageBlockBound?: boolean;
  }
}

export default function PubImageBlockBinder() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.__stgyImageBlockBound) return;
    window.__stgyImageBlockBound = true;
    function handleClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      const b = t.closest(".image-block") as HTMLElement | null;
      if (b) {
        b.classList.toggle("expanded");
        e.stopPropagation();
      }
    }
    document.body.addEventListener("click", handleClick);
    return () => {
      document.body.removeEventListener("click", handleClick);
      window.__stgyImageBlockBound = false;
    };
  }, []);
  return null;
}
