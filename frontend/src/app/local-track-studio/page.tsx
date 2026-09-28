import type { Metadata } from "next";
import { Suspense } from "react";
import { Config } from "@/config";
import PageBody from "./PageBody";

const title = "Local Track Studio";
const description = "Open and convert FIT, GPX, TrackJSON, and TRJGZ tracks, preview routes and ride analysis, trim or downsample activities, protect start and end locations, and export TrackJSON, GPX, and FIT.";
const canonicalUrl = new URL("/local-track-studio", Config.FRONTEND_CANONICAL_URL).toString();
const imageUrl = new URL(
  "/data/local-track-studio-ogp.jpg",
  Config.FRONTEND_CANONICAL_URL,
).toString();

export const metadata: Metadata = {
  title,
  description,
  manifest: "/manifest-lts.json",
  icons: {
    icon: [
      { url: "/icons/lts-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/lts-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/lts-apple.png", type: "image/png", sizes: "180x180" }],
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
        alt: "Local Track Studio",
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

export default function LocalTrackStudioPage() {
  return (
    <Suspense>
      <PageBody />
    </Suspense>
  );
}
