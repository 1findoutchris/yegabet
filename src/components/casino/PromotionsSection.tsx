"use client";

import Link from "next/link";
import { Gift, ArrowRight } from "lucide-react";

export interface Promo {
  id: string;
  emoji: string;
  title: string;
  /** Display copy, e.g. "20% bonus up to ETB 500". */
  desc: string;
  href: string;
  cta: string;
}

/**
 * Live promotions. Every card is built from real config by the caller, so this
 * renders nothing rather than advertising an offer that doesn't exist — the
 * previous hardcoded list promised a welcome bonus and a reload bonus for
 * months before either was implemented.
 */
export function PromotionsSection({ promos }: { promos: Promo[] }) {
  if (promos.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Gift className="w-[18px] h-[18px] text-[color:var(--gold)]" />
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">Promotions</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {promos.map((p) => (
          <Link
            key={p.id}
            href={p.href}
            className="group relative overflow-hidden cursor-pointer rounded-[14px] p-5 bg-[var(--bg-surface)] border border-[color:var(--border-base)] hover:border-[color:var(--border-accent)] transition-colors duration-200"
          >
            {/* Decorative corner accent */}
            <span
              className="pointer-events-none absolute top-0 right-0 w-[60px] h-[60px] bg-[var(--bg-accent-dim)]"
              style={{ borderRadius: "0 14px 0 60px" }}
            />

            <div className="relative">
              <div className="text-[28px] mb-3 leading-none">{p.emoji}</div>
              <h3 className="text-[15px] font-semibold text-[color:var(--text-primary)] mb-1.5">{p.title}</h3>
              <p className="text-[12px] leading-relaxed text-[color:var(--text-secondary)] mb-4">{p.desc}</p>

              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[color:var(--gold)]">{p.cta}</span>
                <ArrowRight className="w-3.5 h-3.5 text-[color:var(--gold)]" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
