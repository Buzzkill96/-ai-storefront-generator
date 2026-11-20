// Talks to Google Gemini and returns validated, structured JSON.
//
// Reliability plan for every AI request:
//   1. Primary model, with a strict JSON schema and a per-call timeout.
//   2. If the answer fails validation, or the model is briefly overloaded (503), retry the same model
//      once after a short pause (with feedback on what was wrong, for bad answers).
//   3. A timeout, rate limit, retired model or second failure moves on to the next fallback model.
//      GEMINI_FALLBACK_MODEL can list several models, separated by commas.
//   4. If everything fails, the API route returns a friendly error and the creator keeps their input.

export type LLMErrorKind = "no_key" | "timeout" | "rate_limit" | "overloaded" | "http" | "bad_output" | "blocked";

export class LLMError extends Error {
  kind: LLMErrorKind;
  constructor(kind: LLMErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

type GeminiSchema = Record<string, unknown>;

// GEMINI_BASE_URL is only overridden in local tests (to simulate slow or broken AI answers).
const ENDPOINT = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";

async function callGemini(opts: {
  model: string;
  system: string;
  user: string;
  schema: GeminiSchema;
  timeoutMs: number;
  temperature: number;
}): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LLMError("no_key", "GEMINI_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: opts.schema,
    temperature: opts.temperature,
    maxOutputTokens: 4096,
  };
  // Gemini 2.5 Flash "thinks" by default, which adds seconds. Copywriting doesn't need it.
  if (/^gemini-2\.5-flash/.test(opts.model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  try {
    const res = await fetch(`${ENDPOINT}/${opts.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.user }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });

    if (res.status === 429) throw new LLMError("rate_limit", `Rate limited on ${opts.model}`);
    if (res.status >= 500) {
      const body = await res.text().catch(() => "");
      throw new LLMError("overloaded", `Gemini ${res.status} on ${opts.model}: ${body.slice(0, 200)}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMError("http", `Gemini ${res.status} on ${opts.model}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: unknown;
    };
    const candidate = json.candidates?.[0];
    if (!candidate) throw new LLMError("blocked", `No answer: ${JSON.stringify(json.promptFeedback ?? {})}`);
    const text = candidate.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new LLMError("bad_output", `Empty answer (finishReason: ${candidate.finishReason})`);

    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new LLMError("bad_output", "The answer was not valid JSON");
    }
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if ((err as Error).name === "AbortError") throw new LLMError("timeout", `${opts.model} took longer than ${opts.timeoutMs}ms`);
    const cause = (err as { cause?: unknown }).cause;
    throw new LLMError("http", `${String(err)}${cause ? ` (cause: ${String((cause as Error).message ?? cause)})` : ""}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateStructured<T>(opts: {
  system: string;
  user: string;
  schema: GeminiSchema;
  /** Validate and convert the raw JSON. Throw an Error with a clear message to trigger a retry. */
  parse: (raw: unknown) => T;
  temperature?: number;
  totalBudgetMs?: number;
}): Promise<{ data: T; model: string; attempts: number }> {
  const primary = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbacks = (process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const models = [primary, ...fallbacks.filter((m) => m !== primary)];

  const budget = opts.totalBudgetMs ?? 50_000;
  const start = Date.now();
  let lastError: LLMError | null = null;
  let feedback = "";
  let attempts = 0;

  outer: for (const model of models) {
    let usedFeedbackRetry = false;
    // Up to 3 calls per model: overload spikes usually clear within a few seconds.
    for (let tryNo = 0; tryNo < 3; tryNo++) {
      const remaining = budget - (Date.now() - start);
      if (remaining < 4_000) break outer;
      attempts++;
      try {
        const raw = await callGemini({
          model,
          system: opts.system,
          user: opts.user + feedback,
          schema: opts.schema,
          timeoutMs: Math.min(25_000, remaining),
          temperature: opts.temperature ?? 0.8,
        });
        return { data: opts.parse(raw), model, attempts };
      } catch (err) {
        lastError = err instanceof LLMError ? err : new LLMError("bad_output", (err as Error).message);
        console.error(`[llm] attempt ${attempts} (${model}) failed: ${lastError.kind} - ${lastError.message}`);
        if (lastError.kind === "no_key") break outer;
        if (lastError.kind === "bad_output" && !usedFeedbackRetry) {
          usedFeedbackRetry = true;
          feedback = `\n\nIMPORTANT: your previous answer was rejected because: ${lastError.message}. Return valid JSON that follows every rule.`;
          continue; // retry same model with feedback
        }
        if (lastError.kind === "overloaded" && tryNo < 2) {
          const wait = (tryNo + 1) * 2_000; // 2s, then 4s
          if (budget - (Date.now() - start) < wait + 6_000) break;
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        break; // timeout, rate limit, retired model, or repeated failure: next model
      }
    }
  }
  throw lastError ?? new LLMError("timeout", "Ran out of time");
}

/** What the creator sees when the AI fails. Never a stack trace. */
export function friendlyMessage(err: unknown): string {
  const kind = err instanceof LLMError ? err.kind : "http";
  switch (kind) {
    case "no_key":
      return "The AI isn't connected yet (missing API key). Please contact the site owner.";
    case "rate_limit":
    case "overloaded":
      return "Lots of creators are building right now. Please try again in a minute — your details are saved.";
    case "timeout":
      return "The AI is taking longer than usual. Please try again — your details are saved.";
    case "blocked":
      return "We couldn't create a store from that description. Try describing your skills a little differently.";
    default:
      return "Something went wrong while building your store. Please try again — your details are saved.";
  }
}
