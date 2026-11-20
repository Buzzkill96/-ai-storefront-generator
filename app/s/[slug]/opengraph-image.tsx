import { getRecord } from "@/lib/storage";
import { OG_SIZE, renderStoreCard } from "@/lib/og-card";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Creator store";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rec = await getRecord(slug);
  return renderStoreCard(rec?.store ?? null);
}
