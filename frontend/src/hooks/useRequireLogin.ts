"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSessionInfo } from "@/api/auth";
import type { SessionInfo } from "@/api/model";

type RequireLoginStatus =
  | { state: "loading" }
  | { state: "authenticated"; user: SessionInfo }
  | { state: "unauthenticated" };

export function useRequireLogin() {
  const router = useRouter();
  const [status, setStatus] = useState<RequireLoginStatus>({ state: "loading" });

  useEffect(() => {
    getSessionInfo()
      .then(user => setStatus({ state: "authenticated", user }))
      .catch(() => {
        setStatus({ state: "unauthenticated" });
        router.replace("/error?page=login-required");
      });
  }, [router]);

  return status;
}
