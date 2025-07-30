import { Suspense } from "react";
import PageBody from "./PageBody";

export default function TestMarkdownPage() {
  return (
    <Suspense>
      <PageBody />
    </Suspense>
  );
}
