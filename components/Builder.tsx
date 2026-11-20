"use client";

import { useEffect, useRef, useState } from "react";
import { formatINR, normalizeHandle } from "@/lib/guardrails";
import {
  AUDIENCES,
  AUDIENCE_LABELS,
  FORMATS,
  FORMAT_LABELS,
  THEMES,
  type CreatorInput,
  type GenerateResponse,
  type Product,
  type Store,
} from "@/lib/types";
import { StorePage } from "./StorePage";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NICHES = ["Fitness", "Finance", "Cooking", "Design", "Exam prep", "Astrology", "Fashion", "Career", "Other"];

const EXAMPLES: { label: string; input: CreatorInput }[] = [
  {
    label: "Fitness coach",
    input: {
      name: "Priya Sharma", handle: "fitwithpriya", niche: "Fitness", audience: "5k_25k", language: "english",
      description: "Certified trainer and mom of two. I post 15-minute home workouts for busy moms who can't make it to a gym.",
    },
  },
  {
    label: "CA topper (Hinglish)",
    input: {
      name: "Rohit Jain", handle: "", niche: "Exam prep", audience: "25k_100k", language: "hinglish",
      description: "CA Final first attempt mein clear kiya. Reels pe CA Inter students ke liye study plans aur tips share karta hu.",
    },
  },
  {
    label: "Home baker",
    input: { name: "", handle: "", niche: "Cooking", audience: "under_5k", language: "english", description: "I bake eggless cakes at home in Pune" },
  },
];

const LOADING_LINES = [
  "Reading what you do…",
  "Finding products your audience would pay for…",
  "Pricing them for Indian buyers…",
  "Writing your bio and descriptions…",
  "Putting your store together…",
];

const THEME_COLORS: Record<Store["theme"], string> = {
  sunset: "linear-gradient(135deg,#ff8a4c,#ee3f78)",
  ocean: "linear-gradient(135deg,#2c6bff,#19b4c9)",
  forest: "linear-gradient(135deg,#138a5c,#7cc35a)",
  midnight: "linear-gradient(135deg,#4b2fd6,#141026)",
};

const DRAFT_KEY = "sf-draft-v1";

const EMPTY_INPUT: CreatorInput = { name: "", handle: "", description: "", niche: "", audience: "not_sure", language: "english" };

type Step = "input" | "loading" | "clarify" | "edit" | "published";
type Published = { url: string; slug?: string; editKey?: string };

// ---------------------------------------------------------------------------
// Network helper: always resolves, never throws, with a client-side timeout.
// ---------------------------------------------------------------------------

async function postJSON<T>(url: string, body: unknown, timeoutMs = 70_000): Promise<T | { status: "error"; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!data) return { status: "error", message: "The server sent an unexpected reply. Please try again." };
    return data as T;
  } catch (err) {
    const timedOut = (err as Error).name === "AbortError";
    return {
      status: "error",
      message: timedOut
        ? "This is taking too long. Please check your connection and try again — your details are saved."
        : "Couldn't reach the server. Please check your internet and try again — your details are saved.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Builder() {
  const [step, setStep] = useState<Step>("input");
  const [input, setInput] = useState<CreatorInput>(EMPTY_INPUT);
  const [store, setStore] = useState<Store | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [clarifyReason, setClarifyReason] = useState("");
  const [clarifyText, setClarifyText] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // which part is regenerating
  const [partError, setPartError] = useState<{ key: string; message: string } | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [published, setPublished] = useState<Published | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [confirmRegenAll, setConfirmRegenAll] = useState(false);
  const [loadingLine, setLoadingLine] = useState(0);
  const [slow, setSlow] = useState(false);
  const loaded = useRef(false);

  // Restore a saved draft so a refresh or a dropped connection never loses work.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.input) setInput({ ...EMPTY_INPUT, ...d.input });
        if (d.store) {
          setStore(d.store);
          setAssumptions(d.assumptions ?? []);
          setPublished(d.published ?? null);
          setStep("edit");
        }
      }
    } catch {
      /* ignore broken drafts */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ input, store, assumptions, published }));
    } catch {
      /* storage full or blocked: not critical */
    }
  }, [input, store, assumptions, published]);

  // Rotating loading messages + "taking longer" notice
  useEffect(() => {
    if (step !== "loading") return;
    setLoadingLine(0);
    setSlow(false);
    const rotate = setInterval(() => setLoadingLine((n) => Math.min(n + 1, LOADING_LINES.length - 1)), 2500);
    const slowTimer = setTimeout(() => setSlow(true), 15_000);
    return () => {
      clearInterval(rotate);
      clearTimeout(slowTimer);
    };
  }, [step]);

  const handleCheck = normalizeHandle(input.handle);
  const canGenerate = input.description.trim().length >= 2 || (!!handleCheck.handle && handleCheck.valid);

  // ----- Actions -----

  async function generate(override?: CreatorInput) {
    const payload = override ?? input;
    setError("");
    setPublishErrors([]);
    setConfirmRegenAll(false);
    setStep("loading");
    window.scrollTo(0, 0);
    const res = await postJSON<GenerateResponse>("/api/generate", payload);
    if (res.status === "ok") {
      setStore(res.store);
      setAssumptions(res.assumptions);
      setTab("edit");
      setDirty(true);
      setStep("edit");
    } else if (res.status === "needs_more_info") {
      setClarifyReason(res.reason);
      setClarifyText("");
      setStep("clarify");
    } else {
      setError(res.message);
      setStep(store ? "edit" : "input");
    }
  }

  async function regenerate(target: { type: "profile" } | { type: "product"; index: number } | { type: "new_product" }, key: string) {
    if (!store) return;
    setBusy(key);
    setPartError(null);
    const res = await postJSON<{ status: "ok"; profile?: { tagline: string; bio: string }; product?: Product }>(
      "/api/regenerate",
      { input, store, target },
    );
    setBusy(null);
    if (res.status !== "ok") {
      setPartError({ key, message: `${res.message} Your current text is kept.` });
      return;
    }
    setDirty(true);
    setStore((s) => {
      if (!s) return s;
      if (target.type === "profile" && res.profile) return { ...s, ...res.profile };
      if (target.type === "product" && res.product) {
        const products = [...s.products];
        products[target.index] = res.product;
        return { ...s, products };
      }
      if (target.type === "new_product" && res.product) return { ...s, products: [...s.products, res.product].slice(0, 4) };
      return s;
    });
  }

  function patchStore(patch: Partial<Store>) {
    setDirty(true);
    setStore((s) => (s ? { ...s, ...patch } : s));
  }

  function patchProduct(id: string, patch: Partial<Product>) {
    setDirty(true);
    setStore((s) => (s ? { ...s, products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : s));
  }

  function removeProduct(id: string) {
    setDirty(true);
    setStore((s) => (s && s.products.length > 1 ? { ...s, products: s.products.filter((p) => p.id !== id) } : s));
  }

  async function publish() {
    if (!store) return;
    const problems: string[] = [];
    if (!store.name.trim()) problems.push("Add your name or store name.");
    store.products.forEach((p, i) => {
      if (!p.title.trim()) problems.push(`Product ${i + 1} needs a title.`);
    });
    setPublishErrors(problems);
    if (problems.length) {
      setTab("edit");
      return;
    }
    setPublishing(true);
    const res = await postJSON<{ status: "ok"; path: string; slug?: string; editKey?: string }>("/api/publish", {
      store: { ...store, handle: normalizeHandle(store.handle).valid ? normalizeHandle(store.handle).handle : "" },
      slug: published?.slug,
      editKey: published?.editKey,
    });
    setPublishing(false);
    if (res.status !== "ok") {
      setPublishErrors([res.message]);
      return;
    }
    setPublished({ url: window.location.origin + res.path, slug: res.slug, editKey: res.editKey });
    setDirty(false);
    setStep("published");
    window.scrollTo(0, 0);
  }

  /** keepDetails: go back to the form with the creator's details filled in (to tweak and retry). */
  function startOver(keepDetails: boolean) {
    if (!keepDetails) setInput(EMPTY_INPUT);
    setStore(null);
    setAssumptions([]);
    setPublished(null);
    setError("");
    setPublishErrors([]);
    setStep("input");
    window.scrollTo(0, 0);
  }

  // ----- Screens -----

  if (step === "loading") {
    return (
      <div className="wrap loading" aria-live="polite">
        <div className="spinner" />
        <h1 className="h1" style={{ fontSize: 22 }}>Building your store</h1>
        <p className="sub">{LOADING_LINES[loadingLine]}</p>
        <div className="skeleton" style={{ width: "70%" }} />
        <div className="skeleton" style={{ width: "85%" }} />
        <div className="skeleton" style={{ width: "60%" }} />
        {slow && <p className="hint" style={{ marginTop: 24 }}>Taking a little longer than usual. Hang tight — we&apos;ll retry automatically if needed.</p>}
      </div>
    );
  }

  if (step === "clarify") {
    return (
      <div className="wrap">
        <button className="btn link" onClick={() => setStep("input")}>← Back</button>
        <h1 className="h1">Help us understand you</h1>
        <p className="sub">{clarifyReason}</p>

        <label className="label">What do you post about?</label>
        <div className="chips">
          {NICHES.map((n) => (
            <button key={n} className={`chip ${input.niche === n ? "on" : ""}`} onClick={() => setInput({ ...input, niche: input.niche === n ? "" : n })}>
              {n}
            </button>
          ))}
        </div>

        <label className="label" htmlFor="clarify">In one line, what could you teach someone?</label>
        <input
          id="clarify"
          className="input"
          value={clarifyText}
          maxLength={300}
          onChange={(e) => setClarifyText(e.target.value)}
          placeholder="e.g. I help beginners cook healthy Indian meals in 20 minutes"
        />

        <div className="sticky-bottom">
          <div className="inner">
            <button
              className="btn block"
              disabled={clarifyText.trim().length < 3 && !input.niche}
              onClick={() => {
                const next = { ...input, description: clarifyText.trim() || input.description };
                setInput(next);
                generate(next);
              }}
            >
              ✨ Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "published" && published && store) {
    const shareText = `Check out my store: ${published.url}`;
    return (
      <div className="wrap">
        <div className="success">
          <div className="big">🎉</div>
          <h1 className="h1">Your store is live!</h1>
          <p className="sub">Put this link in your Instagram bio or share it on WhatsApp.</p>
        </div>
        <div className="linkbox">
          <code>{published.url}</code>
          <button
            className="btn small"
            onClick={async (e) => {
              const btn = e.currentTarget;
              try {
                await navigator.clipboard.writeText(published.url);
                btn.textContent = "Copied ✓";
              } catch {
                btn.textContent = "Select & copy";
              }
              setTimeout(() => (btn.textContent = "Copy"), 2000);
            }}
          >
            Copy
          </button>
        </div>
        <div className="stack">
          <a className="btn block" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
            Share on WhatsApp
          </a>
          <a className="btn secondary block" href={published.url} target="_blank" rel="noopener noreferrer">Open my store</a>
          <button className="btn secondary block" onClick={() => setStep("edit")}>Keep editing</button>
          <button className="btn link" onClick={() => startOver(false)}>Start a new store</button>
        </div>
      </div>
    );
  }

  if (step === "edit" && store) {
    return (
      <>
        <div className="topbar">
          <div className="inner">
            <button className="btn link" onClick={() => startOver(true)} style={{ whiteSpace: "nowrap" }}>← Back</button>
            <div className="seg" role="tablist">
              <button className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>Edit</button>
              <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>Preview</button>
            </div>
            <span style={{ width: 60 }} />
          </div>
        </div>

        <div className="wrap" style={{ paddingTop: 8 }}>
          {error && <div className="notice error">{error}</div>}
          {publishErrors.length > 0 && (
            <div className="notice error">
              {publishErrors.map((p) => <div key={p}>{p}</div>)}
            </div>
          )}

          {tab === "preview" ? (
            <div className="preview-frame">
              <StorePage store={store} preview />
            </div>
          ) : (
            <>
              {assumptions.length > 0 && (
                <div className="notice">
                  <strong>We filled in some gaps.</strong> Edit anything that isn&apos;t right:
                  <ul>{assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}

              {/* Profile */}
              <section className={`card ${busy === "profile" ? "busy" : ""}`}>
                <div className="card-head">
                  <span className="card-title">Your profile</span>
                  <button className="iconbtn" disabled={!!busy} onClick={() => regenerate({ type: "profile" }, "profile")}>
                    {busy === "profile" ? "Writing…" : "↻ Rewrite bio"}
                  </button>
                </div>
                <label className="label">Name</label>
                <input className="input" value={store.name} maxLength={60} onChange={(e) => patchStore({ name: e.target.value })} />
                <label className="label">Instagram handle <small>(optional)</small></label>
                <input
                  className={`input ${normalizeHandle(store.handle).valid ? "" : "bad"}`}
                  value={store.handle ? "@" + store.handle : ""}
                  maxLength={31}
                  placeholder="@yourhandle"
                  onChange={(e) => patchStore({ handle: e.target.value.replace(/^@+/, "").replace(/\s/g, "").slice(0, 30) })}
                />
                {!normalizeHandle(store.handle).valid && <div className="err">This handle has characters Instagram doesn&apos;t allow. It won&apos;t be shown.</div>}
                <label className="label">Tagline</label>
                <input className="input" value={store.tagline} maxLength={120} onChange={(e) => patchStore({ tagline: e.target.value })} />
                <label className="label">Bio</label>
                <textarea className="textarea" value={store.bio} maxLength={600} onChange={(e) => patchStore({ bio: e.target.value })} />
                {partError?.key === "profile" && <div className="err">{partError.message}</div>}
              </section>

              {/* Theme */}
              <section className="card">
                <div className="card-title" style={{ marginBottom: 10 }}>Page colour</div>
                <div className="themes">
                  {THEMES.map((t) => (
                    <button
                      key={t}
                      aria-label={t}
                      className={`swatch ${store.theme === t ? "on" : ""}`}
                      style={{ background: THEME_COLORS[t] }}
                      onClick={() => patchStore({ theme: t })}
                    />
                  ))}
                </div>
              </section>

              {/* Products */}
              {store.products.map((p, i) => {
                const key = `product-${p.id}`;
                return (
                  <section key={p.id} className={`card ${busy === key ? "busy" : ""}`}>
                    <div className="card-head">
                      <span className="card-title">Product {i + 1}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="iconbtn" disabled={!!busy} onClick={() => regenerate({ type: "product", index: i }, key)}>
                          {busy === key ? "Thinking…" : "↻ New idea"}
                        </button>
                        <button className="iconbtn" disabled={!!busy || store.products.length <= 1} onClick={() => removeProduct(p.id)} aria-label="Remove product">
                          ✕
                        </button>
                      </div>
                    </div>
                    <label className="label">Title</label>
                    <textarea className="textarea title-field" rows={2} value={p.title} maxLength={100} onChange={(e) => patchProduct(p.id, { title: e.target.value.replace(/\n/g, " ") })} />
                    <div className="row format-price">
                      <div>
                        <label className="label">Format</label>
                        <select className="select" value={p.format} onChange={(e) => patchProduct(p.id, { format: e.target.value as Product["format"] })}>
                          {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Price</label>
                        <div className="price-wrap">
                          <span>₹</span>
                          <input
                            className="input"
                            inputMode="numeric"
                            value={String(p.price)}
                            onChange={(e) => {
                              const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
                              patchProduct(p.id, { price: Math.min(100000, n) });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    {p.priceReason && (
                      <div className="why">
                        💡 <strong>Why {formatINR(p.suggestedPrice ?? p.price)}?</strong> {p.priceReason}
                        {p.suggestedPrice !== undefined && p.suggestedPrice !== p.price && (
                          <div style={{ marginTop: 4 }}>
                            You changed it to {formatINR(p.price)}.{" "}
                            <button className="btn link" style={{ padding: 0, fontSize: 13 }} onClick={() => patchProduct(p.id, { price: p.suggestedPrice! })}>
                              Use suggestion
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <label className="label">Description</label>
                    <textarea className="textarea" value={p.description} maxLength={800} onChange={(e) => patchProduct(p.id, { description: e.target.value })} />
                    {partError?.key === key && <div className="err">{partError.message}</div>}
                  </section>
                );
              })}

              {store.products.length < 4 && (
                <button className="btn secondary block" style={{ marginTop: 14 }} disabled={!!busy} onClick={() => regenerate({ type: "new_product" }, "new")}>
                  {busy === "new" ? "Thinking of another idea…" : "+ Add another product idea"}
                </button>
              )}
              {partError?.key === "new" && <div className="err">{partError.message}</div>}

              <div style={{ textAlign: "center", marginTop: 22 }}>
                <button
                  className="btn link"
                  disabled={!!busy}
                  onClick={() => (confirmRegenAll ? generate() : setConfirmRegenAll(true))}
                >
                  {confirmRegenAll ? "Tap again to replace everything (your edits will be lost)" : "↻ Regenerate the whole store"}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="sticky-bottom">
          <div className="inner">
            {tab === "edit" && (
              <button className="btn secondary" onClick={() => { setTab("preview"); window.scrollTo(0, 0); }}>Preview</button>
            )}
            <button className="btn block" disabled={publishing || !!busy} onClick={publish}>
              {publishing ? "Publishing…" : published && !dirty ? "Published ✓" : published ? "Update my page" : "Publish my store"}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ----- Input screen (default) -----
  return (
    <div className="wrap">
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand)", letterSpacing: "0.04em" }}>AI STOREFRONT</div>
      <h1 className="h1">Turn what you know into a store in 2 minutes</h1>
      <p className="sub">Tell us what you do. We&apos;ll suggest what to sell, how to price it in ₹, and write your page. You can edit everything.</p>

      {error && <div className="notice error" style={{ marginBottom: 8 }}>{error}</div>}

      <label className="label" htmlFor="desc">What do you do, and who do you help?</label>
      <textarea
        id="desc"
        className="textarea"
        value={input.description}
        maxLength={1200}
        onChange={(e) => setInput({ ...input, description: e.target.value })}
        placeholder="e.g. I'm a yoga teacher in Jaipur. I post morning routines for working women with back pain."
      />
      <div className="hint">English, Hindi or Hinglish — whatever is easiest. One line is enough.</div>
      <div className="chips" style={{ marginTop: 10 }}>
        <span className="hint" style={{ marginTop: 6 }}>Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex.label} className="chip ghost" onClick={() => setInput(ex.input)}>{ex.label}</button>
        ))}
      </div>

      <label className="label">Your niche <small>(optional)</small></label>
      <div className="chips">
        {NICHES.map((n) => (
          <button key={n} className={`chip ${input.niche === n ? "on" : ""}`} onClick={() => setInput({ ...input, niche: input.niche === n ? "" : n })}>
            {n}
          </button>
        ))}
      </div>

      <label className="label">Followers <small>(helps us price right)</small></label>
      <div className="chips">
        {AUDIENCES.map((a) => (
          <button key={a} className={`chip ${input.audience === a ? "on" : ""}`} onClick={() => setInput({ ...input, audience: a })}>
            {AUDIENCE_LABELS[a]}
          </button>
        ))}
      </div>

      <div className="row">
        <div>
          <label className="label" htmlFor="name">Your name <small>(optional)</small></label>
          <input id="name" className="input" value={input.name} maxLength={60} onChange={(e) => setInput({ ...input, name: e.target.value })} placeholder="Priya Sharma" />
        </div>
        <div>
          <label className="label" htmlFor="handle">Instagram <small>(optional)</small></label>
          <input
            id="handle"
            className={`input ${handleCheck.valid ? "" : "bad"}`}
            value={input.handle}
            maxLength={100}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => setInput({ ...input, handle: e.target.value })}
            placeholder="@yourhandle"
          />
        </div>
      </div>
      {!handleCheck.valid ? (
        <div className="err">Instagram handles only use letters, numbers, dots and underscores.</div>
      ) : (
        <div className="hint">We don&apos;t read your Instagram. Your own words above matter more.</div>
      )}

      <label className="label">Language for your page</label>
      <div className="seg">
        <button className={input.language === "english" ? "on" : ""} onClick={() => setInput({ ...input, language: "english" })}>English</button>
        <button className={input.language === "hinglish" ? "on" : ""} onClick={() => setInput({ ...input, language: "hinglish" })}>Hinglish</button>
      </div>

      <div className="sticky-bottom">
        <div className="inner">
          <button className="btn block" disabled={!canGenerate} onClick={() => generate()}>
            ✨ Build my store
          </button>
        </div>
      </div>
      {!canGenerate && input.description.length === 0 && (
        <p className="hint" style={{ textAlign: "center", marginTop: 20 }}>Write a line about yourself (or add your Instagram handle) to start.</p>
      )}
    </div>
  );
}
