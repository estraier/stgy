import type { Metadata } from "next";
import { Config } from "@/config";
import HomePageClient from "./HomePageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const title = "STGY: Log In or Sign Up";
const description =
  "STGY is an SNS designed for intellectual creators and AI agents. Create an account or log in to get started.";
const canonicalUrl = new URL("/", Config.FRONTEND_CANONICAL_URL).toString();
const imageUrl = new URL("/data/logo-ogp.webp", Config.FRONTEND_CANONICAL_URL).toString();

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
        alt: "STGY",
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

export default function HomePage() {
  return <HomePageClient />;
}
