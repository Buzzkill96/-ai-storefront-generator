import { createHash } from "crypto";
import { getRedis } from "./storage";

// Per-IP limits on the AI endpoints, so nobody can run up the AI bill by hammering them.
// Fixed one-hour windows counted in Redis. Generous enough for a team testing from one office.
// If Redis is missing or unreachable, requests are allowed (fail open) and Google's monthly
// spend cap remains the backstop.

const LIMITS = {
  generate: { max: 30, windowSec: 3600 },
  regenerate: { max: 90, windowSec: 3600 },
} as const;

export type Bucket = keyof typeof LIMITS;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip") || "unknown").trim();
}

export async function checkRateLimit(req: Request, bucket: Bucket): Promise<{ ok: boolean; retryAfterSec: number }> {
  const redis = getRedis();
  if (!redis) return { ok: true, retryAfterSec: 0 };
  const { max, windowSec } = LIMITS[bucket];
  const nowSec = Math.floor(Date.now() / 1000);
  const window = Math.floor(nowSec / windowSec);
  const ipHash = createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 16);
  const key = `rl:${bucket}:${ipHash}:${window}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return { ok: count <= max, retryAfterSec: (window + 1) * windowSec - nowSec };
  } catch (err) {
    console.error("[ratelimit] check failed, allowing request", err);
    return { ok: true, retryAfterSec: 0 };
  }
}

export const RATE_LIMIT_MESSAGE =
  "You've built a lot in the last hour. Please try again a little later — your details are saved.";
