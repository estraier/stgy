import "./globals.css";
import "./published.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "STGY",
  description: "STGY - Self-Tuning Generative Yarns",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.ico" }],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f8f8ff",
};

function buildGoogleFontsHref(
  families: string[],
  weights: number[] = [300, 400, 500, 600, 700, 800, 900],
  display: "auto" | "block" | "swap" | "fallback" | "optional" = "swap",
) {
  const famParam = families
    .map((f) => `family=${f.trim().replace(/\s+/g, "+")}:wght@${weights.join(";")}`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${famParam}&display=${display}`;
}

const FONT_FAMILIES = [
  "IBM Plex Sans JP",
  "Noto Sans JP",
  "Inconsolata",
  "Source Code Pro",
  "Klee One",
];

const GOOGLE_FONTS_HREF = buildGoogleFontsHref(FONT_FAMILIES);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mul">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={GOOGLE_FONTS_HREF} rel="stylesheet" />
      </head>
      <body lang="en" className="min-h-screen bg-white text-slate-900">
        {children}
      </body>
    </html>
  );
}
