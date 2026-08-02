"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getSessionInfo } from "@/api/auth";
import { makeAgreementPageUrl, needsAgreement } from "@/utils/agreement";

export default function SessionAgreementGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/user-agreement" || pathname.startsWith("/user-agreement/")) return;

    let canceled = false;

    getSessionInfo()
      .then((session) => {
        if (canceled || !needsAgreement(session)) return;
        const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.replace(
          makeAgreementPageUrl(returnPath),
        );
      })
      .catch(() => {
        // Public and logged-out pages do not need an agreement redirect.
      });

    return () => {
      canceled = true;
    };
  }, [pathname]);

  return null;
}
