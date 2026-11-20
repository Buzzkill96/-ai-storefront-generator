import { NextResponse } from "next/server";
import { finalizeProducts, parseGeneration } from "@/lib/build-store";
import { clip, looksLikeGibberish, normalizeHandle } from "@/lib/guardrails";
import { friendlyMessage, generateStructured } from "@/lib/llm";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/ratelimit";
import { buildGeneratePrompt, GENERATION_SCHEMA, SYSTEM_PROMPT } from "@/lib/prompts";
import { CreatorInputSchema, type GenerateResponse, type Store } from "@/lib/types";

export const maxDuration = 60;

function reply(body: GenerateResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  if (body === undefined || body === null || typeof body !== "object") {
    return reply({ status: "error", message: "We couldn't read that request. Please refresh and try again." }, 400);
  }
  const parsed = CreatorInputSchema.safeParse(body);
  if (!parsed.success) {
    return reply({ status: "error", message: "Some details are too long. Please shorten them and try again." }, 400);
  }
  const input = parsed.data;
  const { handle, valid: handleValid } = normalizeHandle(input.handle);
  const description = input.description.trim();

  // 1) Nothing to build from. We never read Instagram, so a handle alone isn't enough:
  //    ask for one line instead of guessing who the creator is. A picked niche is enough to start.
  if (!description && !input.niche) {
    return reply({
      status: "needs_more_info",
      reason: handle
        ? "We don't read Instagram profiles, so tell us in one line what you post about or teach."
        : "Tell us in one line what you post about or teach.",
    });
  }

  // 2) Cheap gibberish check before spending an AI call
  if (description && looksLikeGibberish(description) && !input.niche) {
    return reply({
      status: "needs_more_info",
      reason: "We couldn't quite understand that. Tell us what you post about or teach, in a few simple words.",
    });
  }

  // 3) Per-IP limit before spending an AI call
  const limit = await checkRateLimit(req, "generate");
  if (!limit.ok) return reply({ status: "error", message: RATE_LIMIT_MESSAGE }, 429);

  // 4) Ask the AI
  try {
    const { data, model, attempts } = await generateStructured({
      system: SYSTEM_PROMPT,
      user: buildGeneratePrompt({ ...input, description }, handleValid ? handle : ""),
      schema: GENERATION_SCHEMA,
      parse: parseGeneration,
    });

    if (data.inputQuality === "unusable") {
      return reply({
        status: "needs_more_info",
        reason: clip(data.unusableReason || "We couldn't tell what you teach or post about.", 200),
      });
    }

    const { products, pricesAdjusted } = finalizeProducts(data.products);
    const store: Store = {
      name: clip(input.name.trim() || data.displayName || (handle ? "@" + handle : "My Store"), 60),
      handle: handleValid ? handle : "",
      tagline: clip(data.tagline, 80),
      bio: clip(data.bio, 400),
      theme: data.theme,
      language: input.language,
      products,
    };

    console.log(`[generate] ok model=${model} attempts=${attempts} products=${products.length} pricesAdjusted=${pricesAdjusted}`);
    return reply({
      status: "ok",
      store,
      assumptions: data.assumptions.slice(0, 3).map((a) => clip(a, 120)),
    });
  } catch (err) {
    console.error("[generate] failed", err);
    return reply({ status: "error", message: friendlyMessage(err) }, 503);
  }
}
