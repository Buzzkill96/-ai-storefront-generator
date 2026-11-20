"use client";

import { useState } from "react";

// Checkout is out of scope for this prototype. Instead of a dead button, buyers are sent to the
// creator's Instagram DMs (how many Indian creators sell today). With no handle, we say so honestly.
export function BuyButton({ handle, productTitle, preview, free }: { handle: string; productTitle: string; preview: boolean; free: boolean }) {
  const [note, setNote] = useState("");
  const label = free ? "Get it free" : "Get it";

  function onClick() {
    if (preview) {
      setNote("Buyers tap here to purchase. Payments plug in when this store moves to SuperProfile.");
      return;
    }
    if (handle) {
      window.open(`https://ig.me/m/${handle}`, "_blank", "noopener,noreferrer");
      setNote(`Opening Instagram — send a DM saying you'd like “${productTitle}”.`);
    } else {
      setNote("Payments are coming soon for this store. Check back shortly!");
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button className="sp-buy" onClick={onClick}>{label}</button>
      {note && <div className="sp-note" role="status">{note}</div>}
    </div>
  );
}

export function ShareButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* user cancelled the share sheet */
    }
  }

  return (
    <button className="sp-share" onClick={onShare}>
      {copied ? "Link copied ✓" : "Share this store"}
    </button>
  );
}
