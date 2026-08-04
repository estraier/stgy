import { Suspense } from "react";
import Navbar from "@/components/Navbar";
import PageBody from "./PageBody";

export default function EditingHistoryPage() {
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
