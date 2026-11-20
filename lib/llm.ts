// Gets validated, structured JSON from an AI model, across more than one provider.
//
// Reliability plan for every AI request (the "chain"):
//   1. Google Gemini (GEMINI_MODEL), with a strict JSON schema and minimal "thinking" for speed.
//   2. Groq (GROQ_MODEL), a separate provider, if GROQ_API_KEY is set. If Google is overloaded,
//      the next attempt doesn't depend on Google recovering.
//   3. Gemini fallback model(s) (GEMINI_FALLBACK_MODEL, comma-separated).
// Within each step:
//   - An answer that fails validation is retried once on the same model, with feedback on what was wrong.
//   - Overloaded / timeout / rate limit / retired model: move straight to the next step (fast),
//     except on the last step, which gets one more try after a short pause.
// If everything fails, the API route returns a friendly error and the creator keeps their input.

export type LLMErrorKind = "no_key" | "timeout" | "rate_limit" | "overloaded" | "http" | "bad_output" | "blocked";

export class LLMError extends Error {
  kind: LLMErrorKind;
  constructor(kind: LLMErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

type GeminiSchema = Record<string, unknown>;
type Target = { provider: "gemini" | "groq"; model: string };
type CallOpts = { model: string; system: string; user: string; schema: GeminiSchema; timeoutMs: number; temperature: number };

// GEMINI_BASE_URL / GROQ_BASE_URL are only overridden in local tests (to simulate slow or broken AI answers).
const GEMINI_ENDPOINT = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ_ENDPOINT = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";

// Remembers models that rejected the thinking setting, so we stop sending it to them.
const noThinkingSupport = new Set<string>();

async function postJSON(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new LLMError("rate_limit", `Rate limited on ${label}`);
    if (res.status >= 500) throw new LLMError("overloaded", `${label} ${res.status}: ${text.slice(0, 200)}`);
    if (!res.ok) throw new LLMError("http", `${label} ${res.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new LLMError("bad_output", `${label} sent a non-JSON reply`);
    }
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if ((err as Error).name === "AbortError") throw new LLMError("timeout", `${label} took longer than ${timeoutMs}ms`);
    const cause = (err as { cause?: unknown }).cause;
    throw new LLMError("http", `${String(err)}${cause ? ` (cause: ${String((cause as Error).message ?? cause)})` : ""}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseModelJSON(text: string): unknown {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new LLMError("bad_output", "The answer was not valid JSON");
  }
}

// ---------- Google Gemini ----------

function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  if (noThinkingSupport.has(model)) return undefined;
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3/.test(model)) return { thinkingLevel: /flash/.test(model) ? "minimal" : "low" };
  return undefined;
}

async function callGemini(o: CallOpts): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LLMError("no_key", "GEMINI_API_KEY is not set");

  const isGemini3 = /^gemini-3/.test(o.model);
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: o.schema,
    maxOutputTokens: 4096,
    // Google recommends keeping Gemini 3 at its default temperature (1.0); lower values can cause loops.
    temperature: isGemini3 ? 1 : o.temperature,
  };
  const thinking = thinkingConfigFor(o.model);
  if (thinking) generationConfig.thinkingConfig = thinking;

  const send = () =>
    postJSON(
      `${GEMINI_ENDPOINT}/${o.model}:generateContent`,
      { "x-goog-api-key": key },
      {
        systemInstruction: { parts: [{ text: o.system }] },
        contents: [{ role: "user", parts: [{ text: o.user }] }],
        generationConfig,
      },
      o.timeoutMs,
      `Gemini ${o.model}`,
    );

  let json: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; promptFeedback?: unknown };
  try {
    json = await send();
  } catch (err) {
    // If this model doesn't accept the thinking setting, drop it and try once more.
    if (err instanceof LLMError && err.kind === "http" && thinking && /thinking/i.test(err.message)) {
      noThinkingSupport.add(o.model);
      delete generationConfig.thinkingConfig;
      json = await send();
    } else {
      throw err;
    }
  }

  const candidate = json.candidates?.[0];
  if (!candidate) throw new LLMError("blocked", `No answer: ${JSON.stringify(json.promptFeedback ?? {})}`);
  const text = candidate.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new LLMError("bad_output", `Empty answer (finishReason: ${candidate.finishReason})`);
  return parseModelJSON(text);
}

// ---------- Groq (OpenAI-compatible) ----------

/** Gemini's schema format uses upper-case types; standard JSON Schema uses lower-case. */
function toJsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (s && typeof s === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      if (k === "propertyOrdering") continue;
      out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : toJsonSchema(v);
    }
    return out;
  }
  return s;
}

async function callGroq(o: CallOpts): Promise<unknown> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new LLMError("no_key", "GROQ_API_KEY is not set");
  const json = (await postJSON(
    `${GROQ_ENDPOINT}/chat/completions`,
    { Authorization: `Bearer ${key}` },
    {
      model: o.model,
      messages: [
        {
          role: "system",
          content: `${o.system}\n\nRespond with ONLY a JSON object that matches this JSON Schema exactly (all required fields, no extra text):\n${JSON.stringify(toJsonSchema(o.schema))}`,
        },
        { role: "user", content: o.user },
      ],
      response_format: { type: "json_object" },
      temperature: o.temperature,
      max_tokens: 3000,
    },
    o.timeoutMs,
    `Groq ${o.model}`,
  )) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new LLMError("bad_output", "Empty answer from Groq");
  return parseModelJSON(text);
}

// ---------- The chain ----------

function buildChain(): Target[] {
  const primary = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbacks = (process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m && m !== primary);
  const chain: Target[] = [{ provider: "gemini", model: primary }];
  if (process.env.GROQ_API_KEY) chain.push({ provider: "groq", model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile" });
  for (const m of fallbacks) chain.push({ provider: "gemini", model: m });
  return chain;
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
  const chain = buildChain();
  const budget = opts.totalBudgetMs ?? 45_000;
  const start = Date.now();
  let lastError: LLMError | null = null;
  let attempts = 0;

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i];
    const isLast = i === chain.length - 1;
    let feedback = "";
    let usedFeedbackRetry = false;
    let usedPauseRetry = false;

    for (let tryNo = 0; tryNo < 3; tryNo++) {
      const remaining = budget - (Date.now() - start);
      if (remaining < 4_000) break;
      attempts++;
      const label = `${target.provider}:${target.model}`;
      try {
        const callOpts: CallOpts = {
          model: target.model,
          system: opts.system,
          user: opts.user + feedback,
          schema: opts.schema,
          timeoutMs: Math.min(isLast ? 20_000 : 15_000, remaining),
          temperature: opts.temperature ?? 0.8,
        };
        const raw = target.provider === "groq" ? await callGroq(callOpts) : await callGemini(callOpts);
        return { data: opts.parse(raw), model: label, attempts };
      } catch (err) {
        lastError = err instanceof LLMError ? err : new LLMError("bad_output", (err as Error).message);
        console.error(`[llm] attempt ${attempts} (${label}) failed: ${lastError.kind} - ${lastError.message}`);
        if (lastError.kind === "no_key") break; // try the next provider
        if (lastError.kind === "bad_output" && !usedFeedbackRetry) {
          usedFeedbackRetry = true;
          feedback = `\n\nIMPORTANT: your previous answer was rejected because: ${lastError.message}. Return valid JSON that follows every rule.`;
          continue;
        }
        if (isLast && lastError.kind === "overloaded" && !usedPauseRetry && budget - (Date.now() - start) > 10_000) {
          usedPauseRetry = true;
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        break; // next provider/model
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
    case "timeout":
      return "Lots of creators are building right now. Please try again in a minute — your details are saved.";
    case "blocked":
      return "We couldn't create a store from that description. Try describing your skills a little differently.";
    default:
      return "Something went wrong while building your store. Please try again — your details are saved.";
  }
}
