import type { Metadata } from "next";
import { StoreNotFound } from "@/components/NotFound";

export const metadata: Metadata = { title: "Page not found" };

// Shown (with a real 404 status) for unknown store links and any unknown page.
export default function NotFound() {
  return <StoreNotFound />;
}
