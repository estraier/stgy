"use client";

import { useEffect } from "react";

export default function PubImageBlockBinder() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as any;
    if (w.__stgyImageBlockBound) return;
    w.__stgyImageBlockBound = true;

    function handleClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t || !(t as any).closest) return;
      const b = (t as any).closest(".image-block") as HTMLElement | null;
      if (b) {
        b.classList.toggle("expanded");
        e.stopPropagation();
      }
    }

    document.body.addEventListener("click", handleClick);
    return () => {
      document.body.removeEventListener("click", handleClick);
      w.__stgyImageBlockBound = false;
    };
  }, []);

  return null;
}
