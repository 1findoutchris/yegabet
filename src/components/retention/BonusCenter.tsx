"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Gift, Info, ArrowRight, Loader2, Lock } from "lucide-react";
import { AVAILABLE_OFFERS } from "@/lib/retention";
import { RedeemPoints } from "./RedeemPoints";
import { formatCurrency } from "@/lib/utils";

interface BonusState {
  balance: number;
  depositBalance: number;
  bonusBalance: number;
  withdrawable: number;
}

function MyBonuses() {
  const { status } = useSession();
  const [state, setState] = useState<BonusState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== "authenticated") { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/bonus")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BonusState | null) => { if (!cancelled) { setState(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  if (status !== "authenticated") {
    return <p className="text-[13px] text-[color:var(--text-muted)]">Log in to see your bonuses.</p>;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[color:var(--text-muted)] text-[13px]">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your bonuses…
      </div>
    );
  }
  if (!state || state.bonusBalance <= 0) {
    return (
      <div className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-xl p-5 text-center">
        <p className="text-[13px] text-[color:var(--text-secondary)]">No bonus funds right now.</p>
        <p className="text-[12px] text-[color:var(--text-muted)] mt-1">
          Claim <Link href="/rewards/streak" className="text-[color:var(--gold)]">streak milestones</Link> or weekly cashback above to earn bonus credit.
        </p>
      </div>
    );
  }

  const playOnly = state.depositBalance + state.bonusBalance;
  return (
    <div className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-xl p-4 max-w-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-[color:var(--purple-2)]" />
          <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">Bonus funds</p>
        </div>
        <span className="text-[15px] font-bold text-[color:var(--purple-2)]">{formatCurrency(state.bonusBalance)}</span>
      </div>

      <dl className="mt-3 space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between">
          <dt className="text-[color:var(--text-secondary)]">Ready to play</dt>
          <dd className="font-semibold tabular-nums text-[color:var(--text-primary)]">
            {Number(state.balance).toLocaleString()} ETB
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[color:var(--text-secondary)]">Of which play-only</dt>
          <dd className="font-semibold tabular-nums text-[#F59E0B]">
            {Number(playOnly).toLocaleString()} ETB
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[color:var(--text-secondary)]">Withdrawable</dt>
          <dd className="font-semibold tabular-nums text-[color:var(--green)]">
            {Number(state.withdrawable).toLocaleString()} ETB
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] text-[color:var(--text-muted)]">
        Bonus funds are yours to play with straight away. They can&apos;t be withdrawn
        directly — but everything you win with them can.
      </p>
    </div>
  );
}

export function BonusCenter() {
  return (
    <div className="flex flex-col gap-8">
      {/* Spend points for bonus credit */}
      <RedeemPoints />

      {/* My bonuses — real locked-bonus position */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Gift className="w-[18px] h-[18px] text-[color:var(--gold)]" />
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">My bonuses</h3>
        </div>
        <MyBonuses />
        <div className="mt-3 flex items-start gap-2 text-[11px] text-[color:var(--text-muted)] bg-[var(--bg-elevated)] border border-[color:var(--border-base)] rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px text-[color:var(--text-secondary)]" />
          <span>Bonus credit is playable the moment it lands. It can&apos;t be withdrawn directly — win with it and the winnings are withdrawable. Loyalty points are credited instantly and never expire.</span>
        </div>
      </section>

      {/* Available offers — all link to real features */}
      <section>
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)] mb-4">Available offers</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {AVAILABLE_OFFERS.map((o) => (
            <div key={o.id} className="group relative overflow-hidden rounded-[14px] p-5 bg-[var(--bg-surface)] border border-[color:var(--border-base)] hover:border-[color:var(--border-accent)] transition-colors">
              <span className="pointer-events-none absolute top-0 right-0 w-[60px] h-[60px] bg-[var(--bg-accent-dim)]" style={{ borderRadius: "0 14px 0 60px" }} />
              <div className="relative">
                <div className="text-[28px] mb-3 leading-none">{o.emoji}</div>
                <h4 className="text-[15px] font-semibold text-[color:var(--text-primary)] mb-1.5">{o.title}</h4>
                <p className="text-[12px] leading-relaxed text-[color:var(--text-secondary)]">{o.desc}</p>
                <p className="text-[11px] text-[color:var(--text-muted)] mt-2">{o.meta}</p>
                <Link
                  href={o.href}
                  className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[color:var(--gold)] hover:text-[color:var(--gold-hover)] transition-colors"
                >
                  {o.cta} <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
