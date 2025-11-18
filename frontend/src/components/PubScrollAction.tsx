"use client";

import { useEffect } from "react";

type Props = {
  selectors: string[];
};

export default function PubScrollAction({ selectors }: Props) {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (!selectors || selectors.length === 0) return;
    const vertRoot = document.querySelector(".pub-theme-dir-vert");
    if (!vertRoot) return;
    const viewH = window.innerHeight || document.documentElement.clientHeight || 0;
    let container: HTMLElement | null = null;
    for (const sel of selectors) {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      for (const el of Array.from(nodes)) {
        const sw = el.scrollWidth || 0;
        const cw = el.clientWidth || 0;
        const ch = el.clientHeight || 0;
        if (sw > cw + 1 && ch > viewH * 0.5) {
          container = el;
          break;
        }
      }
      if (container) break;
    }
    if (!container) return;
    const EDGE_EPS = 0.02;
    const DWELL_MS = 500;
    const NAV_COOLDOWN = 800;
    const MIN_GESTURE_DELTA = 50;
    const MIN_VERTICAL_DELTA = 100;
    const PAGE_LOAD_GRACE = 500;
    let lastLeftEdgeEnter = 0;
    let lastRightEdgeEnter = 0;
    let lastNavTime = 0;
    const nowMs = () =>
      typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const pageStart = nowMs();
    const update = () => {
      if (!container) return null;
      const sw = container.scrollWidth || 0;
      const cw = container.clientWidth || 0;
      const maxScroll = sw > cw ? sw - cw : 0;
      const rawScrollLeft = container.scrollLeft || 0;
      let sx = rawScrollLeft;
      if (maxScroll > 0) {
        if (sx > 0) sx = 0;
        else if (sx < -maxScroll) sx = -maxScroll;
      }
      let x = 0;
      if (maxScroll > 0) {
        x = (sx + maxScroll) / maxScroll;
        if (x < 0) x = 0;
        else if (x > 1) x = 1;
      }
      const now = nowMs();
      const nearLeft = x <= EDGE_EPS;
      const nearRight = x >= 1 - EDGE_EPS;
      if (nearLeft) {
        if (!lastLeftEdgeEnter) lastLeftEdgeEnter = now;
      } else {
        lastLeftEdgeEnter = 0;
      }
      if (nearRight) {
        if (!lastRightEdgeEnter) lastRightEdgeEnter = now;
      } else {
        lastRightEdgeEnter = 0;
      }
      return { nearLeft, nearRight, now };
    };
    update();
    const handleScroll = () => {
      update();
    };
    const handleWheel = (ev: WheelEvent) => {
      const state = update();
      if (!state) return;
      const { nearLeft, nearRight, now } = state;
      const dx = ev.deltaX || 0;
      const dy = ev.deltaY || 0;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (lastNavTime && now - lastNavTime < NAV_COOLDOWN) return;
      if (now - pageStart >= PAGE_LOAD_GRACE) {
        if (dy <= -MIN_VERTICAL_DELTA) {
          lastNavTime = now;
          window.history.back();
          return;
        } else if (dy >= MIN_VERTICAL_DELTA) {
          lastNavTime = now;
          window.history.forward();
          return;
        }
      }
      if (absX < MIN_GESTURE_DELTA) return;
      if (absX < absY * 1.5) return;
      const dwellLeft = nearLeft && lastLeftEdgeEnter ? now - lastLeftEdgeEnter : 0;
      const dwellRight = nearRight && lastRightEdgeEnter ? now - lastRightEdgeEnter : 0;
      if (nearLeft && dwellLeft >= DWELL_MS && dx < 0) {
        lastNavTime = now;
        window.history.back();
      } else if (nearRight && dwellRight >= DWELL_MS && dx > 0) {
        lastNavTime = now;
        window.history.forward();
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      container?.removeEventListener("scroll", handleScroll);
      container?.removeEventListener("wheel", handleWheel);
    };
  }, [selectors]);
  return null;
}
