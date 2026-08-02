import type { Metadata } from "next";
import { Suspense } from "react";
import PageBody from "./PageBody";

export const metadata: Metadata = {
  title: "User Agreement - STGY",
};

export default function UserAgreementPage() {
  return (
    <Suspense>
      <PageBody />
    </Suspense>
  );
}
