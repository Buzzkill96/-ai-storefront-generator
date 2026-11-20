import { OG_SIZE, renderCard } from "@/lib/og-card";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "AI Storefront Generator";

export default function Image() {
  return renderCard({
    title: "AI Storefront Generator",
    subtitle: "Turn what you know into a store in 2 minutes",
    badge: "Bio · Products · INR pricing · Shareable page",
    initials: "AI",
  });
}
