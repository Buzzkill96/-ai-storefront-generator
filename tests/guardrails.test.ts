import { test } from "node:test";
import assert from "node:assert/strict";
import { guardPrice, looksLikeGibberish, normalizeHandle, slugify, syncReasonWithPrice } from "../lib/guardrails";
import { finalizeProducts, parseGeneration } from "../lib/build-store";

test("prices are clamped to the format's range and snapped to charm prices", () => {
  assert.deepEqual(guardPrice("ebook", 25000), { price: 999, adjusted: true });
  assert.deepEqual(guardPrice("ebook", 10), { price: 99, adjusted: true });
  assert.deepEqual(guardPrice("ebook", 499), { price: 499, adjusted: false });
  assert.equal(guardPrice("cohort_course", 3200).price, 2999);
  assert.equal(guardPrice("one_on_one", Number.NaN).price, 299);
});

test("price reason follows an adjusted price", () => {
  assert.equal(syncReasonWithPrice("At ₹25,000 this is premium.", 999), "At ₹999 this is premium.");
});

test("gibberish detection", () => {
  for (const bad of ["asdfghjkl", "!!!!!!", "x", "hhhhhhhh", "qwrtpsdfgh zxcv"]) assert.ok(looksLikeGibberish(bad), bad);
  for (const ok of ["fitness", "I teach yoga to working women", "bhai main CA ki taiyari karwata hu", "मैं योग सिखाती हूँ"])
    assert.ok(!looksLikeGibberish(ok), ok);
});

test("instagram handle normalisation", () => {
  assert.deepEqual(normalizeHandle("@FitWithPriya"), { handle: "fitwithpriya", valid: true });
  assert.deepEqual(normalizeHandle("https://www.instagram.com/chef.ankit/?hl=en"), { handle: "chef.ankit", valid: true });
  assert.equal(normalizeHandle("bad handle!").valid, false);
  assert.equal(normalizeHandle("..dots").valid, false);
  assert.deepEqual(normalizeHandle(""), { handle: "", valid: true });
});

test("slugs are url-safe", () => {
  assert.match(slugify("Priya Sharma — Fitness!"), /^priya-sharma-fitness-[a-z0-9]{6}$/);
  assert.match(slugify("😀"), /^store-[a-z0-9]{6}$/);
});

test("AI output with too few products is rejected so it gets retried", () => {
  assert.throws(() =>
    parseGeneration({ inputQuality: "usable", assumptions: [], displayName: "A", tagline: "Hello there", bio: "x".repeat(30), theme: "ocean", products: [] }),
  );
  const ok = parseGeneration({ inputQuality: "unusable", unusableReason: "Gibberish", assumptions: [], displayName: "", tagline: "", bio: "", theme: "nope", products: [] });
  assert.equal(ok.theme, "sunset");
});

test("duplicate products are dropped and the list is capped at 4", () => {
  const p = (title: string) => ({ title, format: "ebook" as const, price: 199, priceReason: "Easy first buy at ₹199.", description: "A helpful guide for beginners who want results." });
  const { products } = finalizeProducts([p("Guide A"), p("guide a!"), p("Guide B"), p("Guide C"), p("Guide D"), p("Guide E")]);
  assert.deepEqual(products.map((x) => x.title), ["Guide A", "Guide B", "Guide C", "Guide D"]);
});

import { findUnsupportedClaims } from "../lib/guardrails";
test("unsupported claims are flagged only when the creator didn't state them", () => {
  const store = { tagline: "Strong after baby", bio: "Safe postpartum workouts that fix your posture.", products: [{ title: "Certified plan", description: "Lose 5 kg in 30 days", priceReason: "" }] };
  const flags = findUnsupportedClaims(store, "I teach yoga");
  for (const f of ["postpartum / pregnancy", "safe", "posture correction", "weight-loss results", "certified / qualified"]) assert.ok(flags.includes(f), f);
  assert.deepEqual(findUnsupportedClaims(store, "Certified postpartum trainer: safe workouts, posture, lose 5 kg"), []);
  assert.deepEqual(findUnsupportedClaims({ tagline: "Learn yoga at home", bio: "Gentle beginner flows.", products: [] }, "I teach yoga"), []);
});

test("two near-identical products are rejected so the AI is asked again", () => {
  const p = (title: string) => ({ title, format: "ebook", price: 199, priceReason: "Easy first buy.", description: "A helpful guide for beginners who want results." });
  assert.throws(
    () => parseGeneration({ inputQuality: "usable", assumptions: [], displayName: "A", tagline: "Hello there", bio: "x".repeat(30), theme: "ocean", products: [p("Yoga Guide"), p("yoga guide!")] }),
    /clearly different titles/,
  );
});
