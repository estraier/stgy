"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSessionInfo } from "@/api/auth";
import type { SessionInfo } from "@/api/models";
import { makeAgreementPageUrl, needsAgreement } from "@/utils/agreement";

type RequireLoginStatus =
  | { state: "loading" }
  | { state: "authenticated"; session: SessionInfo }
  | { state: "unauthenticated" };

export function useRequireLogin() {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<RequireLoginStatus>({ state: "loading" });

  useEffect(() => {
    getSessionInfo()
      .then((session) => {
        if (needsAgreement(session)) {
          const returnPath =
            `${window.location.pathname}${window.location.search}${window.location.hash}`;
          window.location.replace(makeAgreementPageUrl(returnPath));
          return;
        }
        setStatus({ state: "authenticated", session });
      })
      .catch(() => {
        setStatus({ state: "unauthenticated" });
        const returnPath =
          `${window.location.pathname}${window.location.search}${window.location.hash}`;
        router.replace(`/login?next=${encodeURIComponent(returnPath)}`);
      });
  }, [pathname, router]);

  return status;
}
