"use client";

import { useEffect, useState } from "react";
import { ensureLanguage, resolveHighlightLang } from "@/utils/prism";

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
    let raf = 0;

    const needsHighlight = (
      pre: HTMLPreElement,
    ): { lang: string | null; code: HTMLElement | null } => {
      const raw = pre.getAttribute("data-pre-mode") || "";
      const lang = resolveHighlightLang(raw);
      if (!lang) return { lang: null, code: null };
      const code = pre.querySelector("code") as HTMLElement | null;
      if (code && code.querySelector(".token")) return { lang: null, code: null };
      return { lang, code };
    };

    const run = async () => {
      if (cancelled) return;

      const pres = Array.from(container.querySelectorAll<HTMLPreElement>("pre[data-pre-mode]"));
      if (pres.length === 0) return;

      for (const pre of pres) {
        if (cancelled) return;

        const { lang, code } = needsHighlight(pre);
        if (!lang) continue;

        let codeEl = code;
        if (!codeEl) {
          const text = pre.textContent ?? "";
          pre.textContent = "";
          codeEl = document.createElement("code");
          codeEl.textContent = text;
          pre.appendChild(codeEl);
        }

        pre.classList.add(`language-${lang}`);
        codeEl.classList.add(`language-${lang}`);

        const { Prism } = await ensureLanguage(lang);
        if (cancelled) return;

        Prism.highlightElement(codeEl);
      }
    };

    const scheduleRun = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(run);
    };

    scheduleRun();

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          scheduleRun();
          break;
        }
      }
    });
    mo.observe(container, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, [root, signal]);

  return null;
}
