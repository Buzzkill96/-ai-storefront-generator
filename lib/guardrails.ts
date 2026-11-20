import type { Format } from "./types";

// Rules applied in code, not just asked of the AI. The model suggests; these make sure
// nothing absurd (a ₹25,000 e-book, a ₹0 cohort, a 40-character keyboard mash) reaches the creator.

// ---- Prices ----

/** Allowed INR range per format. A model price outside this range gets pulled back in. */
export const PRICE_RANGES: Record<Format, [number, number]> = {
  ebook: [99, 999],
  template_pack: [99, 1499],
  webinar: [99, 1999],
  workshop: [199, 2999],
  recorded_course: [299, 4999],
  one_on_one: [299, 4999],
  cohort_course: [999, 14999],
  community: [49, 999],
};

/** "Charm" price points Indian buyers are used to seeing. */
export const CHARM_PRICES = [
  49, 99, 149, 199, 249, 299, 349, 399, 499, 599, 699, 799, 899, 999, 1199, 1299, 1499, 1799, 1999,
  2499, 2999, 3499, 3999, 4499, 4999, 5999, 6999, 7999, 8999, 9999, 11999, 12999, 14999,
];

export function snapToCharm(n: number): number {
  return CHARM_PRICES.reduce((best, c) => (Math.abs(c - n) < Math.abs(best - n) ? c : best), CHARM_PRICES[0]);
}

export function guardPrice(format: Format, raw: number): { price: number; adjusted: boolean } {
  const [lo, hi] = PRICE_RANGES[format];
  const original = Number.isFinite(raw) ? Math.round(raw) : lo;
  let p = Math.min(hi, Math.max(lo, original));
  p = snapToCharm(p);
  p = Math.min(hi, Math.max(lo, p));
  return { price: p, adjusted: p !== original };
}

export function formatINR(n: number): string {
  return n === 0 ? "Free" : "₹" + n.toLocaleString("en-IN");
}

/** If the price changed, make the "why this price" line quote the new number. */
export function syncReasonWithPrice(reason: string, price: number): string {
  return reason.replace(/₹\s?[\d,]+/, formatINR(price));
}

// ---- Text clean-up ----

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\-–]+$/, "") + "…";
}

// ---- Input checks ----

/**
 * Cheap first-pass check before spending an AI call.
 * Catches keyboard mashes ("asdfghjkl"), symbol spam and repeated characters.
 * Anything subtler is caught by the model, which can also mark input "unusable".
 */
export function looksLikeGibberish(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  const nonSpace = t.replace(/\s/g, "");
  // \p{M} counts vowel signs (matras) so Hindi in Devanagari isn't mistaken for gibberish.
  const letters = t.match(/[\p{L}\p{M}]/gu)?.length ?? 0;
  if (letters / nonSpace.length < 0.5) return true;
  if (/(.)\1{4,}/u.test(t)) return true;
  const latin = t.toLowerCase().match(/[a-z]/g) ?? [];
  if (latin.length >= 6) {
    const vowels = latin.filter((c) => "aeiouy".includes(c)).length;
    if (vowels / latin.length < 0.18) return true;
  }
  if (t.split(/\s+/).some((w) => w.length > 25 && !/^https?:/i.test(w))) return true;
  return false;
}

/** Accepts "@name", "name" or a full instagram.com URL. Returns the bare handle and whether it is valid. */
export function normalizeHandle(raw: string): { handle: string; valid: boolean } {
  let h = (raw || "").trim();
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@+/, "");
  if (!h) return { handle: "", valid: true };
  const valid = /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-zA-Z0-9._]{1,30}$/.test(h);
  return { handle: h.toLowerCase(), valid };
}

// ---- Links ----

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "store"}-${suffix}`;
}

// ---- Unsupported claims ----

/**
 * Words that make a claim a creator must stand behind (health, safety, credentials, guarantees).
 * If the store uses one that the creator never wrote, we warn them before publishing.
 * The AI is told not to do this; this check catches it when it slips.
 */
const CLAIM_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "postpartum / pregnancy", re: /post[\s-]?partum|post[\s-]?pregnan|pregnan|prenatal|new moms?/i },
  { label: "safe", re: /\bsafe(ly)?\b/i },
  { label: "pain relief", re: /\bpain\b/i },
  { label: "posture correction", re: /posture/i },
  { label: "injury or rehab", re: /injur|rehab/i },
  { label: "therapy or healing", re: /therap|\bheal|\bcure/i },
  { label: "medical conditions", re: /medical|clinical|diabet|pcos|pcod|thyroid|blood pressure/i },
  { label: "weight-loss results", re: /lose\s+\d+|\d+\s?kg|weight[\s-]?loss/i },
  { label: "certified / qualified", re: /certified|certificat|qualified|licensed/i },
  { label: "guaranteed results", re: /guarantee|100%|assured/i },
];

export function findUnsupportedClaims(
  store: { tagline: string; bio: string; products: { title: string; description: string; priceReason?: string }[] },
  creatorText: string,
): string[] {
  const output = [store.tagline, store.bio, ...store.products.flatMap((p) => [p.title, p.description, p.priceReason ?? ""])].join(" \n ");
  return CLAIM_PATTERNS.filter(({ re }) => re.test(output) && !re.test(creatorText)).map(({ label }) => label);
}
