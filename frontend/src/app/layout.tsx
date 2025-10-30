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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mul">
      <body lang="en" className="min-h-screen bg-white text-slate-900">
        {children}
      </body>
    </html>
  );
}
