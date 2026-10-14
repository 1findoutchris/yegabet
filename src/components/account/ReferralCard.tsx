"use client";

import { useState, useEffect } from "react";
import { Disc3, Copy, Check, Share2 } from "lucide-react";
import { toast } from "sonner";

export function ReferralCard({ code }: { code: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const link = origin ? `${origin}/?ref=${code}` : `/?ref=${code}`;

  async function copy(value: string, which: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Couldn’t copy", { description: "Copy it manually." });
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on YegaBet", text: `Use my code ${code}`, url: link });
      } catch { /* user cancelled */ }
    } else {
      copy(link, "link");
    }
  }

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-[color:var(--border-royal)] p-5"
      style={{ background: "linear-gradient(135deg,#0A0A0A 0%,#0A0A0A 55%,#0A0A0A 100%)" }}
    >
      <span aria-hidden className="pointer-events-none absolute -top-16 right-8 w-48 h-48 rounded-full"
        style={{ background: "radial-gradient(circle,rgba(245,184,61,0.22),transparent 65%)" }} />

      <div className="relative z-10">
        <div className="flex items-center gap-2">
          <Disc3 className="w-[18px] h-[18px] text-[color:var(--purple-2)]" />
          <h3 className="text-[15px] font-bold text-[color:var(--text-primary)]">Refer &amp; earn</h3>
        </div>
        <p className="text-[12px] text-[color:var(--text-secondary)] mt-1">
          Share your code — earn a <span className="font-bold text-[color:var(--gold)]">free spin</span> on the prize
          wheel for every friend who signs up.
        </p>

        {/* Code */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 min-w-0 rounded-xl bg-[var(--bg-base)]/60 border border-[color:var(--border-base)] px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Your code</p>
            <p className="font-display text-[20px] font-extrabold tracking-[0.12em] text-[color:var(--text-primary)] truncate">{code}</p>
          </div>
          <button
            onClick={() => copy(code, "code")}
            className="shrink-0 inline-flex items-center gap-1.5 px-3.5 h-[52px] rounded-xl bg-royal-grad text-white text-[13px] font-bold transition-transform hover:scale-[1.03]"
          >
            {copied === "code" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied === "code" ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Share link */}
        <div className="mt-2.5 flex items-center gap-2">
          <button
            onClick={share}
            className="flex-1 inline-flex items-center justify-center gap-2 h-10 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] font-semibold hover:border-[color:var(--border-accent)] transition-colors"
          >
            <Share2 className="w-4 h-4" /> Share invite link
          </button>
          <button
            onClick={() => copy(link, "link")}
            className="shrink-0 inline-flex items-center gap-1.5 px-3.5 h-10 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] text-[13px] font-semibold hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)] transition-colors"
          >
            {copied === "link" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied === "link" ? "Copied" : "Link"}
          </button>
        </div>
      </div>
    </section>
  );
}
