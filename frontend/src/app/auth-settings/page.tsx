import { Suspense } from "react";
import PageBody from "./PageBody";
import Navbar from "@/components/Navbar";

export default function SettingsPage() {
  return (
    <>
      <Suspense>
        <Navbar />
      </Suspense>
      <Suspense>
        <PageBody />
      </Suspense>
    </>
  );
}
