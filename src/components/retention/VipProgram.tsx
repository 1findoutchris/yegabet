"use client";

import { Check, Crown, Gem } from "lucide-react";
import { VIP_CRITERIA, VIP_STANDARD, VIP_ELITE } from "@/lib/retention";

function BenefitList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((b) => (
        <li key={b} className="flex items-start gap-2.5 text-[13px] text-[color:var(--text-secondary)]">
          <Check className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--gold)]" />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

export function VipProgram() {
  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <section
        className="rounded-2xl border border-[color:var(--border-accent)] p-6 sm:p-8"
        style={{ background: "linear-gradient(135deg, #150B26, var(--bg-surface))" }}
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--purple)] bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)] rounded-md px-2.5 py-1">
          <Crown className="w-3 h-3 fill-current" /> Invitation only
        </span>
        <h2 className="mt-4 text-[28px] sm:text-[32px] font-bold tracking-[-0.03em] text-[color:var(--text-primary)] leading-tight">
          The Vinna VIP Club
        </h2>
        <p className="mt-2 text-[14px] text-[color:var(--text-secondary)] max-w-2xl">
          Our top players get a dedicated account manager, the highest cashback, priority withdrawals, and access to real-world events. VIP status is reviewed monthly with a 60-day grace period before any demotion.
        </p>
      </section>

      {/* Qualification */}
      <section className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] overflow-hidden">
        <div className="px-5 py-4 border-b border-[color:var(--border-muted)]">
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">Qualification criteria</h3>
        </div>
        <div className="divide-y divide-[color:var(--border-muted)]">
          {VIP_CRITERIA.map((c) => (
            <div key={c.label} className="flex items-center justify-between px-5 py-3">
              <span className="text-[13px] text-[color:var(--text-secondary)]">{c.label}</span>
              <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">{c.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Tiers */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Gem className="w-5 h-5 text-[color:var(--gold)]" />
            <h3 className="text-[17px] font-bold text-[color:var(--text-primary)]">VIP Standard</h3>
          </div>
          <BenefitList items={VIP_STANDARD} />
        </div>
        <div className="rounded-[14px] p-6 border border-[color:var(--border-accent)]" style={{ background: "linear-gradient(135deg, #150B26, var(--bg-surface))" }}>
          <div className="flex items-center gap-2 mb-4">
            <Crown className="w-5 h-5 text-[color:var(--purple)]" />
            <h3 className="text-[17px] font-bold text-[color:var(--text-primary)]">VIP Elite</h3>
            <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--purple)] bg-[var(--bg-accent-dim)] rounded px-1.5 py-0.5">Top 1%</span>
          </div>
          <BenefitList items={VIP_ELITE} />
        </div>
      </section>
    </div>
  );
}
