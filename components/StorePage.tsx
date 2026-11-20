import { formatINR } from "@/lib/guardrails";
import { FORMAT_LABELS, type Store } from "@/lib/types";
import { BuyButton, ShareButton } from "./StoreActions";

// The public storefront. Used both for the live page and for the preview inside the editor.

function initials(name: string): string {
  const clean = name.replace(/^@/, "").trim();
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const letters = (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)) || "★";
  return letters.toUpperCase();
}

export function StorePage({ store, preview = false }: { store: Store; preview?: boolean }) {
  return (
    <div className={`sp theme-${store.theme}`}>
      <div className="sp-inner">
        <header className="sp-hero">
          <div className="sp-avatar" aria-hidden>{initials(store.name)}</div>
          <h1 className="sp-name">{store.name || "Your name"}</h1>
          {store.handle && (
            <a className="sp-handle" href={`https://instagram.com/${store.handle}`} target="_blank" rel="noopener noreferrer">
              @{store.handle}
            </a>
          )}
          {store.tagline && <p className="sp-tagline">{store.tagline}</p>}
        </header>

        <main className="sp-body">
          {store.bio && <div className="sp-bio">{store.bio}</div>}

          <div className="sp-section">{store.language === "hinglish" ? "Mere products" : "My products"}</div>
          {store.products.map((p) => (
            <article className="sp-card" key={p.id}>
              <span className="sp-badge">{FORMAT_LABELS[p.format]}</span>
              <h2 className="sp-title">{p.title || "Untitled product"}</h2>
              {p.description && <p className="sp-desc">{p.description}</p>}
              <div className="sp-foot">
                <span className="sp-price">
                  {formatINR(p.price)}
                  {p.format === "community" && p.price > 0 ? <small style={{ fontSize: 13, fontWeight: 500 }}> /month</small> : null}
                </span>
                <BuyButton handle={store.handle} productTitle={p.title} preview={preview} free={p.price === 0} />
              </div>
            </article>
          ))}

          {!preview && <ShareButton name={store.name} />}
          <div className="sp-made">Built in minutes with the AI Storefront Generator</div>
        </main>
      </div>
    </div>
  );
}
