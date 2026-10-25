import "./globals.css";
import "./published.css";
import "leaflet/dist/leaflet.css";
import "stgy-track/track-viewer.css";
import type { Metadata, Viewport } from "next";
import SessionAgreementGuard from "@/components/SessionAgreementGuard";
import ImageFallbackBinder from "@/components/ImageFallbackBinder";

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
  width: 440,
  themeColor: "#f8f8ff",
};

function buildGoogleFontsHref(
  families: string[],
  weights: number[] = [400, 500, 600, 700, 800],
  display: "auto" | "block" | "swap" | "fallback" | "optional" = "swap",
) {
  const famParam = families
    .map((f) => `family=${f.trim().replace(/\s+/g, "+")}:wght@${weights.join(";")}`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${famParam}&display=${display}`;
}

const FONT_FAMILIES = [
  "Noto Sans JP",
  "Noto Serif JP",
  "BIZ UDMincho",
  "BIZ UDGothic",
  "IBM Plex Sans JP",
  "Klee One",
  "Zen Antique",
  "Inconsolata",
  "Source Code Pro",
];

const GOOGLE_FONTS_HREF = buildGoogleFontsHref(FONT_FAMILIES);

const MOBILE_LAYOUT_WIDTH = 440;
const MOBILE_VIEWPORT_SCRIPT = `
(() => {
  const layoutWidth = ${MOBILE_LAYOUT_WIDTH};
  const applyViewport = () => {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) return false;
    const screenWidth = window.screen?.width || layoutWidth;
    const scale = Math.min(1, screenWidth / layoutWidth);
    viewport.setAttribute('content', 'width=' + layoutWidth + ', initial-scale=' + scale);
    return true;
  };
  if (!applyViewport()) {
    const observer = new MutationObserver(() => {
      if (applyViewport()) observer.disconnect();
    });
    observer.observe(document.head, { childList: true });
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mul">
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOBILE_VIEWPORT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={GOOGLE_FONTS_HREF} rel="stylesheet" />
      </head>
      <body lang="en" className="min-h-screen bg-white text-slate-900">
        <ImageFallbackBinder />
        <SessionAgreementGuard />
        {children}
      </body>
    </html>
  );
}