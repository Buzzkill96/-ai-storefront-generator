import type { Metadata } from "next";
import { StoreNotFound } from "@/components/NotFound";
import { StorePage } from "@/components/StorePage";
import { getRecord } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const rec = await getRecord(slug);
  if (!rec) return { title: "Store not found" };
  return {
    title: `${rec.store.name} — Store`,
    description: rec.store.tagline,
    openGraph: { title: rec.store.name, description: rec.store.tagline },
  };
}

export default async function PublishedStore({ params }: Props) {
  const { slug } = await params;
  const rec = await getRecord(slug);
  if (!rec) return <StoreNotFound />;
  return <StorePage store={rec.store} />;
}
