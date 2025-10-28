"use client";

import { useEffect } from "react";
import { Config } from "@/config";
import type { SessionInfo } from "@/api/models";

type Props = {
  redirectIfLoggedIn?: boolean;
  onSession?: (s: SessionInfo) => void;
};

export default function SessionProbe({
  redirectIfLoggedIn = false,
  onSession,
}: Props) {
  useEffect(() => {
    let aborted = false;
    fetch("/backend/auth", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SessionInfo | null) => {
        if (aborted || !s) return;
        onSession?.(s);
        if (redirectIfLoggedIn) {
          const now = Date.now();
          const regTs = Date.parse(s.userCreatedAt || "");
          const isNewbie =
            Number.isFinite(regTs) && now - regTs <= 48 * 60 * 60 * 1000;
          const target = isNewbie ? Config.WELCOME_PAGE_PATH : "/posts";
          if (location.pathname === "/" || location.pathname === "") {
            location.replace(target);
          }
        }
      })
      .catch(() => {});
    return () => {
      aborted = true;
    };
  }, [redirectIfLoggedIn, onSession]);

  return null;
}
