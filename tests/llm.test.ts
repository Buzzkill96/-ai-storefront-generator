// Failure-path tests for the AI client. `fetch` is replaced with a scripted fake, so these run
// offline and prove the retry / fallback behaviour without calling Google or Groq.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateStructured, friendlyMessage, LLMError } from "../lib/llm";

type Handler = (url: string, body: any, signal?: AbortSignal) => Promise<Response> | Response;
const realFetch = globalThis.fetch;
let calls: string[] = [];

function useFetch(handler: Handler) {
  calls = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push(url.includes("groq") ? `groq:${url.endsWith("/models") ? "list-models" : JSON.parse(init.body).model}` : `gemini:${url.split("/").pop()!.split(":")[0]}`);
    return handler(url, init?.body ? JSON.parse(init.body) : undefined, init?.signal);
  }) as typeof fetch;
}
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const geminiAnswer = (obj: unknown) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }] });
const groqAnswer = (obj: unknown) => json({ choices: [{ message: { content: JSON.stringify(obj) } }] });
const hang = (signal?: AbortSignal) => new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));

const GOOD = { answer: "ok" };
const parse = (raw: unknown) => {
  if ((raw as any)?.answer !== "ok") throw new Error("answer must be ok");
  return raw as typeof GOOD;
};
const run = (extra: Partial<Parameters<typeof generateStructured>[0]> = {}) =>
  generateStructured({ system: "s", user: "u", schema: { type: "OBJECT" }, parse, callTimeoutMs: 200, ...extra });

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test";
  process.env.GROQ_API_KEY = "test";
  process.env.GEMINI_MODEL = "gemini-3.8-flash";
  process.env.GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
  delete process.env.GROQ_MODEL;
});
afterEach(() => { globalThis.fetch = realFetch; });

test("a malformed answer is retried once on the same model, with feedback", async () => {
  let n = 0;
  useFetch((_url, body) => {
    n++;
    if (n === 1) return geminiAnswer({ answer: "wrong" });
    assert.match(body.contents[0].parts[0].text, /rejected because: answer must be ok/);
    return geminiAnswer(GOOD);
  });
  const r = await run();
  assert.deepEqual(calls, ["gemini:gemini-3.8-flash", "gemini:gemini-3.8-flash"]);
  assert.equal(r.model, "gemini:gemini-3.8-flash");
});

test("Gemini overloaded (503) -> Groq answers straight away", async () => {
  useFetch((url) => (url.includes("groq") ? groqAnswer(GOOD) : json({ error: "high demand" }, 503)));
  const r = await run();
  assert.equal(r.model, "groq:openai/gpt-oss-120b");
  assert.deepEqual(calls, ["gemini:gemini-3.8-flash", "groq:openai/gpt-oss-120b"]);
});

test("Gemini times out -> next provider", async () => {
  useFetch((url, _b, signal) => (url.includes("groq") ? groqAnswer(GOOD) : hang(signal)));
  const r = await run();
  assert.equal(r.model, "groq:openai/gpt-oss-120b");
});

test("Gemini rate-limited and Groq down -> Gemini Flash-Lite", async () => {
  useFetch((url) =>
    url.includes("groq") ? json({}, 500) : url.includes("flash-lite") ? geminiAnswer(GOOD) : json({}, 429),
  );
  const r = await run();
  assert.equal(r.model, "gemini:gemini-3.5-flash-lite");
});

test("a retired Groq model is replaced by one Groq says is available", async () => {
  process.env.GROQ_MODEL = "retired-model";
  useFetch((url, body) => {
    if (!url.includes("groq")) return json({}, 503);
    if (url.endsWith("/models")) return json({ data: [{ id: "whisper-large-v3" }, { id: "openai/gpt-oss-120b" }] });
    if (body.model === "retired-model") return json({ error: { code: "model_not_found", message: "does not exist" } }, 404);
    return groqAnswer(GOOD);
  });
  const r = await run();
  assert.equal((r.data as typeof GOOD).answer, "ok");
  assert.ok(calls.includes("groq:list-models") && calls.includes("groq:openai/gpt-oss-120b"));
});

test("everything down -> a friendly error, never a crash", async () => {
  useFetch(() => json({}, 503));
  await assert.rejects(run(), (err: unknown) => {
    assert.ok(err instanceof LLMError);
    assert.match(friendlyMessage(err), /try again in a minute/);
    return true;
  });
});

test("missing Gemini key still falls through to Groq", async () => {
  delete process.env.GEMINI_API_KEY;
  useFetch((url) => (url.includes("groq") ? groqAnswer(GOOD) : json({}, 500)));
  const r = await run();
  assert.equal(r.model, "groq:openai/gpt-oss-120b");
});
