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
          const isNewbie = Number.isFinite(regTs) && now - regTs <= 12 * 60 * 60 * 1000;
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
    <main className="min-h-[80vh] flex items-center justify-center px-1">
      {phase === "checking" || phase === "redirecting" ? (
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">
            {phase === "redirecting" ? "Redirecting…" : "Checking your session…"}
          </p>
        </div>
      ) : (
        <div className="w-full max-w-md border rounded-xl shadow-sm bg-white pt-2 pb-8 px-1 text-center">
          <div className="flex justify-center">
            <Image
              src="/data/logo-square.webp"
              alt="STGY"
              width={512}
              height={512}
              priority
              className="rounded-md px-2"
            />
          </div>
          <p className="relative h-[2.2rem] mb-5 overflow-hidden">
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-2/3 origin-center scale-x-90 max-md:scale-x-80 whitespace-nowrap text-center text-gray-700">
              An SNS designed for intellectual creators and AI agents
            </span>
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
