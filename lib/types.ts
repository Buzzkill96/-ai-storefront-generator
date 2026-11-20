import { z } from "zod";

// ---- Fixed vocabularies (shared by the AI schema, the editor and the public page) ----

export const FORMATS = [
  "ebook",
  "template_pack",
  "webinar",
  "workshop",
  "recorded_course",
  "one_on_one",
  "cohort_course",
  "community",
] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABELS: Record<Format, string> = {
  ebook: "E-book / Guide",
  template_pack: "Template pack",
  webinar: "Live webinar",
  workshop: "Workshop",
  recorded_course: "Recorded course",
  one_on_one: "1:1 session",
  cohort_course: "Live cohort",
  community: "Paid community (monthly)",
};

export const THEMES = ["sunset", "ocean", "forest", "midnight"] as const;
export type Theme = (typeof THEMES)[number];

export const LANGUAGES = ["english", "hinglish"] as const;
export type Language = (typeof LANGUAGES)[number];

export const AUDIENCES = ["under_5k", "5k_25k", "25k_100k", "over_100k", "not_sure"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<Audience, string> = {
  under_5k: "Under 5K",
  "5k_25k": "5K–25K",
  "25k_100k": "25K–100K",
  over_100k: "100K+",
  not_sure: "Not sure",
};

// ---- What the creator types in ----

export const CreatorInputSchema = z.object({
  name: z.string().max(60).default(""),
  handle: z.string().max(100).default(""),
  description: z.string().max(1200).default(""),
  niche: z.string().max(40).default(""),
  audience: z.enum(AUDIENCES).catch("not_sure"),
  language: z.enum(LANGUAGES).catch("english"),
});
export type CreatorInput = z.infer<typeof CreatorInputSchema>;

// ---- The storefront (what the editor holds and what gets published) ----

export const ProductSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(100),
  format: z.enum(FORMATS).catch("ebook"),
  price: z.number().int().min(0).max(100000),
  suggestedPrice: z.number().int().min(0).max(100000).optional(),
  priceReason: z.string().max(300).default(""),
  description: z.string().max(800),
});
export type Product = z.infer<typeof ProductSchema>;

export const StoreSchema = z.object({
  name: z.string().max(60),
  handle: z.string().max(30).default(""),
  tagline: z.string().max(120),
  bio: z.string().max(600),
  theme: z.enum(THEMES).catch("sunset"),
  language: z.enum(LANGUAGES).catch("english"),
  products: z.array(ProductSchema).min(1).max(4),
});
export type Store = z.infer<typeof StoreSchema>;

// ---- What the model must return (validated before anyone sees it) ----

export const AIProductSchema = z.object({
  title: z.string().trim().min(3),
  format: z.enum(FORMATS),
  price: z.number(),
  priceReason: z.string().trim().min(5),
  description: z.string().trim().min(20),
});
export type AIProduct = z.infer<typeof AIProductSchema>;

export const AIGenerationSchema = z.object({
  inputQuality: z.enum(["usable", "unusable"]),
  unusableReason: z.string().default(""),
  assumptions: z.array(z.string()).default([]),
  displayName: z.string().default(""),
  tagline: z.string().default(""),
  bio: z.string().default(""),
  theme: z.enum(THEMES).catch("sunset"),
  products: z.array(AIProductSchema).default([]),
});
export type AIGeneration = z.infer<typeof AIGenerationSchema>;

export const AIProfileSchema = z.object({
  tagline: z.string().trim().min(3),
  bio: z.string().trim().min(20),
});

// ---- API response shapes ----

export type GenerateResponse =
  | { status: "ok"; store: Store; assumptions: string[] }
  | { status: "needs_more_info"; reason: string }
  | { status: "error"; message: string };
