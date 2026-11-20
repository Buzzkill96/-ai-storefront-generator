# AI Storefront Generator

Turns a creator's short self-description (and optionally their Instagram handle) into a ready-to-share storefront: an AI-written bio, 2–4 product ideas with India-appropriate INR pricing and a "why this price" line, a description for each product, and a mobile-first public page.

Built for the SuperProfile PM take-home assignment.

## Flow

1. **Describe yourself:** one line in English, Hindi or Hinglish, plus optional niche, follower range, name, Instagram handle and page language.
2. **Review & edit:** edit any field, regenerate the bio or any single product, add a product idea, change the page colour, preview the page.
3. **Publish:** get a public link (`/s/your-name-x7k2`) to share on Instagram or WhatsApp. Re-publishing updates the same link.

## How the AI part works

- **Models (a chain across two providers):** Google Gemini (`gemini-3.8-flash`, minimal "thinking" for speed) → Groq (`openai/gpt-oss-120b`, if `GROQ_API_KEY` is set; if Groq retires a model, the app asks Groq for its current models and switches automatically) → Gemini fallback (`gemini-3.5-flash-lite`). If Google's free tier is overloaded, the next attempt goes to a different provider instead of waiting. Every model name is an environment variable, so a retired model can be swapped without a code change.
- **Structured output:** Gemini gets a strict JSON response schema (`lib/prompts.ts`). Groq gets JSON mode plus the same schema in its instructions.
- **Validation:** every response is checked with Zod (`lib/types.ts`, `lib/build-store.ts`). Missing fields, fewer than 2 products, or an empty bio count as failures.
- **Retries:** an answer that fails validation is retried once on the same model, with feedback about what was wrong. An overload, timeout (15 s), rate limit or retired model moves straight to the next model in the chain. If every model fails, the creator sees a friendly message and keeps their input (`lib/llm.ts`).
- **Guardrails in code** (`lib/guardrails.ts`): prices are clamped to a sane INR range per format and snapped to familiar price points (₹199, ₹499, ₹999…), duplicate products are dropped, and text is trimmed.
- **Messy input:**
  - Empty input, an invalid handle or keyboard-mash text is caught before any AI call.
  - The model can also mark input "unusable" (gibberish, or a disallowed offer such as guaranteed returns). Either way, the creator gets a short follow-up question, not an error.
  - Thin input ("fitness") still produces a store, with the AI's assumptions shown so the creator can correct them.
- **Instagram:** never read or scraped (unreliable and against platform terms). A handle the creator types is only shown as a link and used for the "Get it" DM button. A handle on its own isn't enough to build a store, so the creator is asked for one line about what they do.
- **Prompt injection:** the creator's text is passed as quoted data, and the model is told to ignore instructions inside it.

## Abuse and cost protection

The AI endpoints are rate-limited per IP (30 store builds and 90 part regenerations per hour), counted in Redis. If Redis is unavailable, requests are allowed and the monthly spend cap on the Gemini project is the backstop.

## Storage

Published stores are saved in Upstash Redis (free tier) under a short link with a 6-character random suffix. A new link is created only if it's free (atomic create), so one store can never overwrite another. Updates need the private edit key: a random 128-bit key kept in the creator's browser, with only its SHA-256 hash stored on the server. If Redis isn't configured, publishing still works: the whole store is compressed into a self-contained `/p?d=...` link.

## Run locally

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # then add your GEMINI_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # 16 tests: guardrails + AI failure paths
```

## Tests

`npm test` runs offline:

- `tests/guardrails.test.ts`: price ranges, gibberish detection, handle validation, link format, duplicate products, unsupported-claim warnings.
- `tests/llm.test.ts`: the AI chain with a scripted fake network. It covers a malformed answer retried with feedback, Gemini overloaded → Groq, Gemini timing out → Groq, Gemini rate-limited and Groq down → Flash-Lite, a retired Groq model replaced automatically, a missing key, and everything down → a friendly error.

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Free from https://aistudio.google.com |
| `GEMINI_MODEL` | No | Default `gemini-3.8-flash` |
| `GROQ_API_KEY` | Recommended | Free from https://console.groq.com (no card). Adds a second provider as backup |
| `GROQ_MODEL` | No | Default `openai/gpt-oss-120b` |
| `GEMINI_FALLBACK_MODEL` | No | Default `gemini-3.5-flash-lite`. Several models can be listed, separated by commas |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Or `KV_REST_API_URL` / `KV_REST_API_TOKEN`, which Vercel adds automatically when you connect Upstash |

No keys are committed. `.env*` files are git-ignored.

## Deploy (Vercel)

Import the GitHub repo in Vercel, add `GEMINI_API_KEY` under Environment Variables, and deploy. For short links, open the project's **Storage** tab, add **Upstash for Redis** (free), connect it to the project, and redeploy.

## Project structure

```
app/page.tsx                 Builder (input → edit → publish)
app/s/[slug]/page.tsx        Public store page (short link)
app/p/page.tsx               Public store page (self-contained link fallback)
app/api/generate             Full store generation
app/api/regenerate           Regenerate the bio or one product
app/api/publish              Save and return a public link
components/                  Builder UI and the public StorePage
lib/prompts.ts               System prompt, user prompts, JSON schemas
lib/llm.ts                   Gemini client: timeout, retry, fallback
lib/guardrails.ts            Price rules, input checks, handle and slug helpers
lib/build-store.ts           Validate and clean the AI output
lib/storage.ts               Upstash Redis and link fallback
tests/                       Unit tests
```

## Built with AI tools

Built with Claude as the AI coding assistant. I made the product decisions and directed Claude, which wrote the code. I verified each change by testing on real phones, reading the server logs, running the automated tests above, and three rounds of independent QA by a separate Claude agent.
