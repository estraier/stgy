"use client";

import { useEffect, useState } from "react";
import { ensureLanguage, getPrism, resolveHighlightLang } from "@/utils/prism";

type Props = {
  root?: HTMLElement | null;
  deps?: ReadonlyArray<unknown>;
};

export default function PrismHighlighter({ root, deps = [] }: Props) {
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    setSignal((s) => s + 1);
  }, [deps]);

  useEffect(() => {
    const container = root ?? document.body;
    if (!container) return;

    let cancelled = false;

    (async () => {
      const pres = Array.from(
        container.querySelectorAll<HTMLPreElement>("pre[data-pre-mode]")
      );
      if (pres.length === 0) return;

      const Prism = await getPrism();

      for (const pre of pres) {
        if (cancelled) return;
        if (pre.dataset.prismified === "1") continue;

        const raw = pre.getAttribute("data-pre-mode");
        const lang = resolveHighlightLang(raw);
        if (!lang) continue;

        let code = pre.querySelector("code");
        if (!code) {
          const text = pre.textContent ?? "";
          pre.textContent = "";
          code = document.createElement("code");
          code.textContent = text;
          pre.appendChild(code);
        }

        pre.classList.add(`language-${lang}`);
        code.classList.add(`language-${lang}`);

        await ensureLanguage(lang);
        if (cancelled) return;

        Prism.highlightElement(code);
        pre.dataset.prismified = "1";
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [root, signal]);

  return null;
}
