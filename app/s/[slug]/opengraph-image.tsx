import { ImageResponse } from "next/og";
import { getRecord } from "@/lib/storage";

// The preview card WhatsApp, Instagram and others show when a store link is shared.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Creator store";

const GRADIENTS: Record<string, string> = {
  sunset: "linear-gradient(135deg, #ff8a4c, #ee3f78)",
  ocean: "linear-gradient(135deg, #2c6bff, #19b4c9)",
  forest: "linear-gradient(135deg, #138a5c, #7cc35a)",
  midnight: "linear-gradient(135deg, #4b2fd6, #141026)",
};

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rec = await getRecord(slug);
  const store = rec?.store;
  const name = store?.name || "Creator store";
  const initials = name.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "★";
  const count = store?.products.length ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
          alignItems: "center", color: "white", padding: 80, textAlign: "center",
          backgroundImage: GRADIENTS[store?.theme ?? "midnight"],
        }}
      >
        <div style={{ width: 150, height: 150, borderRadius: 75, border: "6px solid rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 700 }}>
          {initials}
        </div>
        <div style={{ fontSize: 72, fontWeight: 700, marginTop: 30 }}>{name.slice(0, 40)}</div>
        {store?.tagline && <div style={{ fontSize: 38, marginTop: 16, opacity: 0.95, maxWidth: 950 }}>{store.tagline.slice(0, 90)}</div>}
        {count > 0 && (
          <div style={{ marginTop: 40, fontSize: 30, background: "rgba(255,255,255,0.22)", borderRadius: 40, padding: "12px 32px" }}>
            {count} product{count > 1 ? "s" : ""} · Tap to view
          </div>
        )}
      </div>
    ),
    size,
  );
}
