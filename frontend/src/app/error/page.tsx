// src/app/error/page.tsx
import { Suspense } from "react";
import ErrorPageBody from "./ErrorPageBody";
import Navbar from "@/components/Navbar";

export default function ErrorPage() {
  return (
    <Suspense>
      <Navbar />
      <ErrorPageBody />
    </Suspense>
  );
}
