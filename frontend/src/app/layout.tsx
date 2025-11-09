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

type FontSpec = { family: string; weights?: number[] };

function buildGoogleFontsHref(fonts: FontSpec[]) {
  const families = fonts
    .map((f) => {
      const name = f.family.trim().split(/\s+/).join("+");
      const weights =
        f.weights && f.weights.length
          ? `:wght@${Array.from(new Set(f.weights)).sort((a, b) => a - b).join(";")}`
          : "";
      return `family=${name}${weights}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

const FONT_SPECS: FontSpec[] = [
  { family: "IBM Plex Sans JP", weights: [400, 700] },
  { family: "Noto Sans JP", weights: [400, 700] },
  { family: "Inconsolata", weights: [400, 700] },
  { family: "Source Code Pro", weights: [400, 700] },
  { family: "Klee One", weights: [400, 700] },
];

const GOOGLE_FONTS_HREF = buildGoogleFontsHref(FONT_SPECS);

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
