import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StorePage } from "@/components/StorePage";
import { decodeStore } from "@/lib/storage";

// Self-contained link: the whole store travels inside ?d=. Used when no database is configured.
type Props = { searchParams: Promise<{ d?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const store = decodeStore((await searchParams).d);
  return store ? { title: `${store.name} — Store`, description: store.tagline } : { title: "Store not found" };
}

export default async function LinkStore({ searchParams }: Props) {
  const store = decodeStore((await searchParams).d);
  if (!store) notFound();
  return <StorePage store={store} />;
}
