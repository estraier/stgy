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

const GOOGLE_FONTS: string[] = [
  "family=IBM Plex Sans JP:wght@400;700",
  "family=Noto+Sans+JP:wght@400;700",
  "family=Inconsolata:wght@400;700",
  "family=Source Code Pro:wght@400;700",
  "family=Klee One:wght@400;700",
];
const GOOGLE_FONTS_HREF = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.join("&")}&display=swap`;

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
