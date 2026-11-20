import { StoreNotFound } from "@/components/NotFound";

// Shown (with a real 404 status) for unknown store links and any unknown page.
export default function NotFound() {
  return <StoreNotFound />;
}
