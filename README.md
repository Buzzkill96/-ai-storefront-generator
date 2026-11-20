# AI Storefront Generator

Turns a creator's short self-description (and optionally their Instagram handle) into a ready-to-share storefront: an AI-written bio, 2–4 product ideas with India-appropriate INR pricing and a "why this price" line, a description for each product, and a mobile-first public page.

Built for the SuperProfile PM take-home assignment.

## Flow

1. **Describe yourself:** one line in English, Hindi or Hinglish, plus optional niche, follower range, name, Instagram handle and page language.
2. **Review & edit:** edit any field, regenerate the bio or any single product, add a product idea, change the page colour, preview the page.
3. **Publish:** get a public link (`/s/your-name-x7k2`) to share on Instagram or WhatsApp. Re-publishing updates the same link.

## How the AI part works

- **Models (a chain across two providers):** Google Gemini (`gemini-3.8-flash`, minimal "thinking" for speed) → Groq (`llama-3.3-70b-versatile`, if `GROQ_API_KEY` is set) → Gemini fallback (`gemini-3.5-flash-lite`). If Google's free tier is overloaded, the next attempt goes to a different provider instead of waiting. Every model name is an environment variable, so a retired model can be swapped without a code change.
- **Structured output:** Gemini gets a strict JSON response schema (`lib/prompts.ts`). Groq gets JSON mode plus the same schema in its instructions.
- **Validation:** every response is checked with Zod (`lib/types.ts`, `lib/build-store.ts`). Missing fields, fewer than 2 products, or an empty bio count as failures.
- **Retries:** an answer that fails validation is retried once on the same model, with feedback about what was wrong. An overload, timeout (15 s), rate limit or retired model moves straight to the next model in the chain. If every model fails, the creator sees a friendly message and keeps their input (`lib/llm.ts`).
- **Guardrails in code** (`lib/guardrails.ts`): prices are clamped to a sane INR range per format and snapped to familiar price points (₹199, ₹499, ₹999…), duplicate products are dropped, and text is trimmed.
- **Messy input:**
  - Empty input, an invalid handle or keyboard-mash text is caught before any AI call.
  - The model can also mark input "unusable" (gibberish, or a disallowed offer such as guaranteed returns). Either way, the creator gets a short follow-up question, not an error.
  - Thin input ("fitness") still produces a store, with the AI's assumptions shown so the creator can correct them.
- **Instagram:** not scraped (blocked and against platform terms). The handle is used only as a hint, and the model must say when it relied on it.
- **Prompt injection:** the creator's text is passed as quoted data, and the model is told to ignore instructions inside it.

## Storage

Published stores are saved in Upstash Redis (free tier) under a short link. If Redis isn't configured, publishing still works: the whole store is compressed into a self-contained `/p?d=...` link.

## Run locally

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # then add your GEMINI_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # guardrail unit tests
```

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Free from https://aistudio.google.com |
| `GEMINI_MODEL` | No | Default `gemini-3.8-flash` |
| `GROQ_API_KEY` | Recommended | Free from https://console.groq.com (no card). Adds a second provider as backup |
| `GROQ_MODEL` | No | Default `llama-3.3-70b-versatile` |
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

Built with Claude as the AI coding assistant. I defined the scope, flow, pricing rules and edge cases, then reviewed and tested the generated code. That testing included a local simulated AI to check the retry, fallback and timeout paths, plus phone-sized browser runs.
