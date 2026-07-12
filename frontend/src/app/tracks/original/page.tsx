import { Suspense } from "react";
import PageBody from "./PageBody";

export default function OriginalTrackPage() {
  return (
    <Suspense>
      <PageBody />
    </Suspense>
  );
}
