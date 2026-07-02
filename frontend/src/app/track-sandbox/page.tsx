import { Suspense } from "react";
import PageBody from "./PageBody";

export default function TestTrackPage() {
  return (
    <Suspense>
      <PageBody />
    </Suspense>
  );
}