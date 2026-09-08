import type { Metadata } from "next";
import { Suspense } from "react";
import { Config } from "@/config";
import PageBody from "./PageBody";

const title = "Local Stack Studio | STGY";
const description = "Combine multiple images in your browser.";
const canonicalUrl = new URL("/local-stack-studio", Config.FRONTEND_CANONICAL_URL).toString();
const imageUrl = new URL(
  "/data/local-stack-studio-ogp.jpg",
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
        alt: "STGY Local Stack Studio",
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

export default function LocalStackStudioPage() {
  return (
    <Suspense>
      <PageBody />
    </Suspense>
  );
}
