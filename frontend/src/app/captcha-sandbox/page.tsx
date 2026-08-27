import { Suspense } from "react";
import PageBody from "./PageBody";

export default function CaptchaSandboxPage() {
  return (
    <Suspense>
      <PageBody />
    </Suspense>
  );
}
