"use client";

import { useEffect } from "react";

export function HeadLangPatcher({ lang }: { lang: string }) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (lang) {
      document.head.setAttribute("lang", lang);
    }
  }, [lang]);
  return null;
}
