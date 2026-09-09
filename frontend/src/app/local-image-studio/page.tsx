import type { Metadata } from "next";
import { Suspense } from "react";
import { Config } from "@/config";
import PageBody from "./PageBody";

const title = "Local Image Studio";
const description = "Crop, resize, rotate, adjust tone and color, and develop RAW photos with a simple set of editing tools. It also includes auto tone adjustment, text and drawing tools, mosaic effects, and sharpening.";
const canonicalUrl = new URL("/local-image-studio", Config.FRONTEND_CANONICAL_URL).toString();
const imageUrl = new URL(
  "/data/local-image-studio-ogp.jpg",
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
        alt: "Local Image Studio",
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
