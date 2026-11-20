import { NextResponse } from "next/server";
import { finalizeProducts, parseGeneration } from "@/lib/build-store";
import { clip, looksLikeGibberish, normalizeHandle } from "@/lib/guardrails";
import { friendlyMessage, generateStructured } from "@/lib/llm";
import { buildGeneratePrompt, GENERATION_SCHEMA, SYSTEM_PROMPT } from "@/lib/prompts";
import { CreatorInputSchema, type GenerateResponse, type Store } from "@/lib/types";

export const maxDuration = 60;

function reply(body: GenerateResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreatorInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return reply({ status: "needs_more_info", reason: "Tell us a little about what you do so we can build your store." });
  }
  const input = parsed.data;
  const { handle, valid: handleValid } = normalizeHandle(input.handle);
  const description = input.description.trim();

  // 1) Nothing usable at all
  if (!description && (!handle || !handleValid)) {
    return reply({
      status: "needs_more_info",
      reason: handle && !handleValid
        ? "That doesn't look like an Instagram handle. Tell us in one line what you post about instead."
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

  // 3) Ask the AI
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
      meta: { model, attempts, pricesAdjusted },
    });
  } catch (err) {
    console.error("[generate] failed", err);
    return reply({ status: "error", message: friendlyMessage(err) }, 503);
  }
}
