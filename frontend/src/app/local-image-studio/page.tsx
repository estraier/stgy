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
  manifest: "/manifest-lis.json",
  icons: {
    icon: [
      { url: "/icons/lis-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/lis-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/lis-apple.png", type: "image/png", sizes: "180x180" }],
  },
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
