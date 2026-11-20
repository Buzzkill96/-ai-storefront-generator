import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeHandle, slugify } from "@/lib/guardrails";
import { createRecord, encodeStore, getRecord, hasDatabase, hashKey, saveRecord } from "@/lib/storage";
import { StoreSchema } from "@/lib/types";

const RequestSchema = z.object({
  store: StoreSchema,
  slug: z.string().max(40).optional(),
  editKey: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json({ status: "error", message: "We couldn't read that request. Please refresh and try again." }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path.at(-1) ?? "");
    const message =
      field === "price"
        ? "Prices must be whole rupees between ₹0 and ₹1,00,000."
        : field === "products"
          ? "A store needs between 1 and 4 products."
          : "Some fields are too long or missing. Check your profile and products, then try again.";
    return NextResponse.json({ status: "error", message }, { status: 400 });
  }
  const { slug: existingSlug, editKey: existingKey } = parsed.data;
  // The form already blocks invalid Instagram handles; the server enforces the same rule.
  const handleCheck = normalizeHandle(parsed.data.store.handle);
  const store = { ...parsed.data.store, handle: handleCheck.valid ? handleCheck.handle : "" };

  const missing = store.products.find((p) => !p.title.trim());
  if (!store.name.trim() || missing) {
    return NextResponse.json(
      { status: "error", message: "Every store needs a name and every product needs a title." },
      { status: 400 },
    );
  }

  // No database: still publish, using a self-contained link.
  if (!hasDatabase()) {
    return NextResponse.json({ status: "ok", mode: "link", path: `/p?d=${encodeStore(store)}` });
  }

  try {
    const now = new Date().toISOString();
    // Re-publishing to the same link needs the private edit key we gave this browser the first time.
    if (existingSlug && existingKey) {
      const rec = await getRecord(existingSlug);
      if (rec && rec.editKeyHash === hashKey(existingKey)) {
        await saveRecord(existingSlug, { ...rec, store, updatedAt: now });
        return NextResponse.json({ status: "ok", mode: "db", path: `/s/${existingSlug}`, slug: existingSlug, editKey: existingKey });
      }
    }
    const editKey = randomBytes(16).toString("hex");
    const record = { store, editKeyHash: hashKey(editKey), createdAt: now, updatedAt: now };
    // New link: create only if free, so an existing store can never be overwritten.
    for (let tries = 0; tries < 5; tries++) {
      const slug = slugify(store.name);
      if (await createRecord(slug, record)) {
        return NextResponse.json({ status: "ok", mode: "db", path: `/s/${slug}`, slug, editKey });
      }
    }
    throw new Error("Could not find a free link after 5 tries");
  } catch (err) {
    console.error("[publish] database failed, falling back to link", err);
    return NextResponse.json({ status: "ok", mode: "link", path: `/p?d=${encodeStore(store)}` });
  }
}
