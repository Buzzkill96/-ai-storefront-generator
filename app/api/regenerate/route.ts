import { NextResponse } from "next/server";
import { z } from "zod";
import { finalizeProduct, parseProduct, parseProfile } from "@/lib/build-store";
import { normalizeHandle } from "@/lib/guardrails";
import { friendlyMessage, generateStructured } from "@/lib/llm";
import {
  buildProductPrompt,
  buildProfilePrompt,
  PRODUCT_SCHEMA,
  PROFILE_SCHEMA,
  SYSTEM_PROMPT,
} from "@/lib/prompts";
import { CreatorInputSchema, StoreSchema } from "@/lib/types";

export const maxDuration = 60;

// Regenerates ONE part of the store, so the creator's edits elsewhere are never lost.
const RequestSchema = z.object({
  input: CreatorInputSchema,
  store: StoreSchema,
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("profile") }),
    z.object({ type: z.literal("product"), index: z.number().int().min(0).max(3) }),
    z.object({ type: z.literal("new_product") }),
  ]),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ status: "error", message: "Something looks off with this store. Please refresh and try again." }, { status: 400 });
  }
  const { input, store, target } = parsed.data;
  const { handle, valid } = normalizeHandle(input.handle);
  const safeHandle = valid ? handle : "";

  try {
    if (target.type === "profile") {
      const { data } = await generateStructured({
        system: SYSTEM_PROMPT,
        user: buildProfilePrompt(input, safeHandle, store),
        schema: PROFILE_SCHEMA,
        parse: parseProfile,
        temperature: 1,
      });
      return NextResponse.json({ status: "ok", profile: data });
    }

    const index = target.type === "product" ? target.index : null;
    if (index !== null && index >= store.products.length) {
      return NextResponse.json({ status: "error", message: "That product no longer exists." }, { status: 400 });
    }
    if (index === null && store.products.length >= 4) {
      return NextResponse.json({ status: "error", message: "A store can have up to 4 products." }, { status: 400 });
    }

    const { data } = await generateStructured({
      system: SYSTEM_PROMPT,
      user: buildProductPrompt(input, safeHandle, store, index),
      schema: PRODUCT_SCHEMA,
      parse: parseProduct,
      temperature: 1,
    });
    return NextResponse.json({ status: "ok", product: finalizeProduct(data).product });
  } catch (err) {
    console.error("[regenerate] failed", err);
    return NextResponse.json({ status: "error", message: friendlyMessage(err) }, { status: 503 });
  }
}
