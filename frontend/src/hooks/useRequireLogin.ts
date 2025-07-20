"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSessionInfo } from "@/api/auth";

export function useRequireLogin() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getSessionInfo()
      .then(() => setReady(true))
      .catch(() => router.replace("/error?page=login-required"));
  }, [router]);

  return ready;
}
