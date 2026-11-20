import { Redis } from "@upstash/redis";
import { createHash } from "crypto";
import LZString from "lz-string";
import { StoreSchema, type Store } from "./types";

// Published stores live in Upstash Redis (free tier) under short links: /s/priya-fitness-x7k2
// If Redis isn't configured, we fall back to a self-contained link (/p?d=...) that carries the
// whole store, compressed, in the URL. Longer, but publishing never breaks.

type StoredRecord = { store: Store; editKeyHash: string; createdAt: string; updatedAt: string };

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function hasDatabase(): boolean {
  return getRedis() !== null;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function getRecord(slug: string): Promise<StoredRecord | null> {
  const redis = getRedis();
  if (!redis || !/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  try {
    const rec = await redis.get<StoredRecord>(`store:${slug}`);
    if (!rec) return null;
    const parsed = StoreSchema.safeParse(rec.store);
    return parsed.success ? { ...rec, store: parsed.data } : null;
  } catch (err) {
    console.error("[storage] read failed", err);
    return null;
  }
}

export async function saveRecord(slug: string, rec: StoredRecord): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("No database configured");
  await redis.set(`store:${slug}`, rec);
}

/** Saves only if the link is free (atomic). Returns false if the slug is already taken. */
export async function createRecord(slug: string, rec: StoredRecord): Promise<boolean> {
  const redis = getRedis();
  if (!redis) throw new Error("No database configured");
  const ok = await redis.set(`store:${slug}`, rec, { nx: true });
  return ok === "OK";
}

export function encodeStore(store: Store): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(store));
}

export function decodeStore(data: string | undefined): Store | null {
  if (!data) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(data);
    if (!json) return null;
    const parsed = StoreSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
