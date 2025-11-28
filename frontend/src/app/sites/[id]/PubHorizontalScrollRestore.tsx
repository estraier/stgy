"use client";

import { useEffect } from "react";

const KEY_SCROLL_PREFIX = "stgyPubSiteScrollLeft:";
const KEY_LAST_POST = "stgyPubLastPost";
const RESTORE_RETRY_MAX = 10;

type LastPostData = {
  id: string;
  page: number;
};

function parseLastPost(raw: string | null): LastPostData | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "id" in parsed && "page" in parsed) {
      const idVal = (parsed as { id: unknown }).id;
      const pageVal = (parsed as { page: unknown }).page;
      if (typeof idVal === "string" && typeof pageVal === "number") {
        return { id: idVal, page: pageVal };
      }
    }
  } catch {}
  return null;
}

function getCurrentPage(): number | null {
  const root = document.querySelector<HTMLElement>(".pub-page");
  if (!root) return null;
  const attr = root.getAttribute("data-page");
  if (!attr) return null;
  const n = Number.parseInt(attr, 10);
  if (Number.isNaN(n)) return null;
  return n;
}

export default function PubHorizontalScrollRestore() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const keyScroll = KEY_SCROLL_PREFIX + window.location.pathname + window.location.search;

    const restoreForLastPost = (): boolean => {
      const sc = document.querySelector<HTMLElement>(".site-container");
      const currentPage = getCurrentPage();
      if (!sc || currentPage === null) return true;
      let raw: string | null = null;
      try {
        raw = window.sessionStorage.getItem(KEY_LAST_POST);
      } catch {}
      const lastPost = parseLastPost(raw);
      if (!lastPost) return true;
      if (lastPost.page !== currentPage) return true;
      const el = document.getElementById("pubpost-" + lastPost.id);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const targetRight = window.innerWidth * 0.6;
      const delta = rect.right - targetRight;
      const base = sc.scrollLeft || 0;
      const next = base + delta;
      sc.scrollLeft = next;
      return true;
    };

    const restoreFallbackScroll = (): boolean => {
      const sc = document.querySelector<HTMLElement>(".site-container");
      if (!sc) return false;
      let raw: string | null = null;
      try {
        raw = window.sessionStorage.getItem(keyScroll);
      } catch {}
      if (raw == null) return true;
      const v = Number.parseFloat(raw);
      if (!Number.isFinite(v)) return true;
      sc.scrollLeft = v;
      return true;
    };

    const tryRestore = (): boolean => {
      if (restoreForLastPost()) return true;
      return restoreFallbackScroll();
    };

    let attempts = 0;
    const raf = () => {
      if (tryRestore()) return;
      attempts += 1;
      if (attempts < RESTORE_RETRY_MAX) {
        window.requestAnimationFrame(raf);
      }
    };
    window.requestAnimationFrame(raf);

    const onScroll = () => {
      const sc = document.querySelector<HTMLElement>(".site-container");
      if (!sc) return;
      const left = sc.scrollLeft || 0;
      try {
        window.sessionStorage.setItem(keyScroll, String(left));
      } catch {}
    };

    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target || typeof target.closest !== "function") return;
      const n = target.closest<HTMLElement>(".post-div");
      if (!n) return;
      const idAttr = n.getAttribute("data-restore-id");
      const pageAttr = n.getAttribute("data-restore-page");
      if (!idAttr || !pageAttr) return;
      const pgNum = Number.parseInt(pageAttr, 10);
      if (Number.isNaN(pgNum)) return;
      const data: LastPostData = { id: idAttr, page: pgNum };
      try {
        window.sessionStorage.setItem(KEY_LAST_POST, JSON.stringify(data));
      } catch {}
    };

    const scInit = document.querySelector<HTMLElement>(".site-container");
    if (scInit) {
      scInit.addEventListener("scroll", onScroll, { passive: true });
    }
    if (document.body) {
      document.body.addEventListener("mousedown", onMouseDown, true);
    }

    return () => {
      const scCleanup = document.querySelector<HTMLElement>(".site-container");
      if (scCleanup) {
        scCleanup.removeEventListener("scroll", onScroll);
      }
      if (document.body) {
        document.body.removeEventListener("mousedown", onMouseDown, true);
      }
    };
  }, []);

  return null;
}
