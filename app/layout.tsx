import type { Metadata, Viewport } from "next";
import "./globals.css";

// Full site address for share links (og:url). Vercel sets VERCEL_PROJECT_PRODUCTION_URL automatically.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AI Storefront Generator",
  description: "Turn what you know into a ready-to-share creator store in about two minutes.",
  openGraph: {
    title: "AI Storefront Generator",
    description: "Turn what you know into a ready-to-share creator store in about two minutes.",
    type: "website",
    url: "/",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f5f2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
