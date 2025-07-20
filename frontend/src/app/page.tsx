"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSessionInfo } from "@/api/auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    getSessionInfo()
      .then(() => {
        router.replace("/posts");
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  return null;
}
