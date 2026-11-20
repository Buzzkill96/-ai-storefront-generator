import { ImageResponse } from "next/og";
import type { Store } from "./types";

// The preview card WhatsApp, Instagram and others show when a link is shared.
// Note for the image renderer: every element with more than one child needs display:flex,
// so each text line below is built as ONE string.

export const OG_SIZE = { width: 1200, height: 630 };

const GRADIENTS: Record<string, string> = {
  sunset: "linear-gradient(135deg, #ff8a4c, #ee3f78)",
  ocean: "linear-gradient(135deg, #2c6bff, #19b4c9)",
  forest: "linear-gradient(135deg, #138a5c, #7cc35a)",
  midnight: "linear-gradient(135deg, #4b2fd6, #141026)",
};

/** Keep only characters the default font can draw (drops emoji and symbols that would break the image). */
function safeText(text: string, max: number): string {
  const cleaned = text.replace(/[^\p{L}\p{M}\p{N}\s.,:;!?'"()&@#%+\-–—/|·]/gu, "").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + "…" : cleaned;
}

export function renderCard(opts: { title: string; subtitle?: string; badge?: string; theme?: string; initials?: string }) {
  const title = safeText(opts.title, 40) || "Creator store";
  const subtitle = opts.subtitle ? safeText(opts.subtitle, 90) : "";
  const initials = opts.initials ?? (title.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "S");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
          alignItems: "center", color: "white", padding: 80, textAlign: "center",
          backgroundImage: GRADIENTS[opts.theme ?? "midnight"] ?? GRADIENTS.midnight,
        }}
      >
        <div style={{ width: 150, height: 150, borderRadius: 75, border: "6px solid rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 700 }}>
          {initials}
        </div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, marginTop: 30 }}>{title}</div>
        {subtitle ? <div style={{ display: "flex", fontSize: 38, marginTop: 16, opacity: 0.95, maxWidth: 950 }}>{subtitle}</div> : null}
        {opts.badge ? (
          <div style={{ display: "flex", marginTop: 40, fontSize: 30, background: "rgba(255,255,255,0.22)", borderRadius: 40, padding: "12px 32px" }}>
            {opts.badge}
          </div>
        ) : null}
      </div>
    ),
    OG_SIZE,
  );
}

export function renderStoreCard(store: Store | null) {
  if (!store) return renderCard({ title: "Creator store" });
  const n = store.products.length;
  return renderCard({
    title: store.name.replace(/^@/, ""),
    subtitle: store.tagline,
    theme: store.theme,
    badge: `${n} product${n === 1 ? "" : "s"} · Tap to view`,
  });
}
