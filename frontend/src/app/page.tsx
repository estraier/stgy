"use client";

import { Config } from "@/config";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSessionInfo } from "@/api/auth";
import type { SessionInfo } from "@/api/models";

function checkFirstVisit(session: SessionInfo) {
  const NEWBIE_WINDOW = 48 * 60 * 60 * 1000;
  const HOLD_WINDOW = 300 * 1000;
  const now = Date.now();

  const regTsRaw = Date.parse(session.userCreatedAt);
  const isNewbie = Number.isFinite(regTsRaw) && now - regTsRaw <= NEWBIE_WINDOW;

  const key = "visited:" + session.userId;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const ts = Number.parseInt(raw, 10);
      if (!Number.isFinite(ts)) {
        localStorage.setItem(key, String(now));
        return isNewbie;
      }
      if (ts < now - HOLD_WINDOW) {
        return false;
      }
      return isNewbie;
    }
    localStorage.setItem(key, String(now));
    return isNewbie;
  } catch {
    return false;
  }
}

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    getSessionInfo()
      .then((session: SessionInfo) => {
        if (checkFirstVisit(session)) {
          router.replace(Config.WELCOME_PAGE_PATH);
        } else {
          router.replace("/posts");
        }
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  return null;
}
