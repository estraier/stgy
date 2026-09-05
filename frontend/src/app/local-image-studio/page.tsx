import type { Metadata } from "next";
import { Suspense } from "react";
import { Config } from "@/config";
import PageBody from "./PageBody";

const title = "Local Image Studio | STGY";
const description =
  "Lightweight, client-side RAW development and image editing. Process photos locally in your browser without uploading them to a server.";
const canonicalUrl = new URL("/local-image-studio", Config.FRONTEND_CANONICAL_URL).toString();
const imageUrl = new URL(
  "/data/local-image-studio-ogp.png",
  Config.FRONTEND_CANONICAL_URL,
).toString();

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: canonicalUrl,
  },
  openGraph: {
    type: "website",
    url: canonicalUrl,
    siteName: "STGY",
    title,
    description,
    images: [
      {
        url: imageUrl,
        alt: "STGY Local Image Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [imageUrl],
  },
};

export default function LocalImageStudioPage() {
  return (
    <Suspense>
      <PageBody />
    </Suspense>
  );
}
