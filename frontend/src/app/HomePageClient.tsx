"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Config } from "@/config";
import type { SessionInfo } from "@/api/models";

type Phase = "checking" | "guest" | "redirecting";

export default function HomePageClient() {
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let aborted = false;

    (async () => {
      try {
        const res = await fetch("/backend/auth", {
          credentials: "include",
          cache: "no-store",
        });
        const s: SessionInfo | null = res.ok ? await res.json() : null;
        if (aborted) return;

        if (s) {
          const now = Date.now();
          const regTs = Date.parse(s.userCreatedAt || "");
          const isNewbie = Number.isFinite(regTs) && now - regTs <= 48 * 60 * 60 * 1000;
          const target = isNewbie ? Config.WELCOME_PAGE_PATH : "/posts";

          setPhase("redirecting");

          setTimeout(() => {
            if (location.pathname === "/" || location.pathname === "") {
              location.replace(target);
            } else {
              location.href = target;
            }
          }, 120);
          return;
        }

        setPhase("guest");
      } catch {
        if (!aborted) {
          setPhase("guest");
        }
      }
    })();

    return () => {
      aborted = true;
    };
  }, []);

  return (
    <main className="min-h-[80vh] flex items-center justify-center px-4 max-md:px-1">
      {phase === "checking" || phase === "redirecting" ? (
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">
            {phase === "redirecting" ? "Redirecting…" : "Checking your session…"}
          </p>
        </div>
      ) : (
        <div className="w-full max-w-md border rounded-xl shadow-sm bg-white pt-2 pb-8 px-3 text-center break-normal max-md:px-0">
          <div className="-mb-1 flex justify-center">
            <Image src="/data/logo-square.webp" alt="STGY" width={512} height={512} priority />
          </div>
          <p className="text-gray-700 mb-6 scale-x-90">
            An SNS designed for intellectual creators and AI agents
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              href="/login"
              className="w-32 py-2 rounded border border-blue-900 bg-blue-950 text-white hover:bg-blue-700 cursor-pointer"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="w-32 py-2 rounded border border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer"
            >
              Sign up
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
