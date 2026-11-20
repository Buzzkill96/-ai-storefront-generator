import { randomUUID } from "crypto";
import { clip, guardPrice, syncReasonWithPrice } from "./guardrails";
import {
  AIGenerationSchema,
  AIProductSchema,
  AIProfileSchema,
  type AIGeneration,
  type AIProduct,
  type Product,
} from "./types";

// Turns raw model JSON into clean, safe data. Throwing here makes llm.ts retry with feedback.

function zodMessage(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join(".") || "root"}: ${i.message}`)
    .join("; ");
}

export function parseGeneration(raw: unknown): AIGeneration {
  const result = AIGenerationSchema.safeParse(raw);
  if (!result.success) throw new Error(zodMessage(result.error));
  const g = result.data;
  if (g.inputQuality === "usable") {
    if (g.products.length < 2) throw new Error("a usable input needs at least 2 products");
    const distinct = new Set(g.products.map((p) => titleKey(p.title)));
    if (distinct.size < 2) throw new Error("products must have clearly different titles");
    if (g.bio.trim().length < 20) throw new Error("bio is missing or too short");
    if (g.tagline.trim().length < 3) throw new Error("tagline is missing");
  }
  return g;
}

export function parseProduct(raw: unknown): AIProduct {
  const result = AIProductSchema.safeParse(raw);
  if (!result.success) throw new Error(zodMessage(result.error));
  return result.data;
}

export function parseProfile(raw: unknown): { tagline: string; bio: string } {
  const result = AIProfileSchema.safeParse(raw);
  if (!result.success) throw new Error(zodMessage(result.error));
  return { tagline: clip(result.data.tagline, 80), bio: clip(result.data.bio, 400) };
}

/** Apply price guardrails and length limits to one AI product. */
export function finalizeProduct(p: AIProduct): { product: Product; adjusted: boolean } {
  const { price, adjusted } = guardPrice(p.format, p.price);
  const reason = clip(adjusted ? syncReasonWithPrice(p.priceReason, price) : p.priceReason, 200);
  return {
    adjusted,
    product: {
      id: randomUUID(),
      title: clip(p.title, 80),
      format: p.format,
      price,
      suggestedPrice: price,
      priceReason: reason,
      description: clip(p.description, 500),
    },
  };
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Drop near-duplicate titles and keep at most 4 products. */
export function finalizeProducts(list: AIProduct[]): { products: Product[]; pricesAdjusted: number } {
  const seen = new Set<string>();
  const products: Product[] = [];
  let pricesAdjusted = 0;
  for (const p of list) {
    const key = titleKey(p.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const { product, adjusted } = finalizeProduct(p);
    if (adjusted) pricesAdjusted++;
    products.push(product);
    if (products.length === 4) break;
  }
  return { products, pricesAdjusted };
}
