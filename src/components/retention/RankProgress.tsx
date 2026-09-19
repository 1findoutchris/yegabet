import { TrendingUp } from "lucide-react";
import { getRankState, TIERS, type Tier } from "@/lib/retention";
import { RankBadge } from "./RankBadge";
import { CountUp } from "./CountUp";

interface Props {
  points?: number;
  avgPerDay?: number;
  /** Compact omits the perk row (used in tighter contexts). */
  compact?: boolean;
  /** Tier ladder — server pages pass the admin-configured tiers; defaults to the built-in ladder. */
  tiers?: Tier[];
}

/**
 * The rank progress card. Per the spec it only ever shows the NEXT tier ahead,
 * the exact points remaining, and an estimate of days to reach it.
 */
export function RankProgress({
  points = 0,
  avgPerDay = 0,
  compact = false,
  tiers = TIERS,
}: Props) {
  const s = getRankState(points, avgPerDay, tiers);

  return (
    <section className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <RankBadge tier={s.tier} size={52} shine />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Your rank</p>
          <p className="font-display text-[20px] font-bold tracking-[-0.02em]" style={{ color: s.tier.color }}>
            {s.tier.name}
          </p>
        </div>
        <div className="ml-auto text-right">
          <CountUp
            value={s.points}
            className="font-display block text-[22px] font-extrabold text-gold-grad tabular-nums leading-none"
          />
          <p className="text-[11px] text-[color:var(--text-muted)] mt-1">loyalty points</p>
        </div>
      </div>

      {/* Progress toward next tier */}
      <div className="mt-5">
        <div className="flex items-end justify-between mb-2">
          {s.nextTier ? (
            <span className="text-[12px] text-[color:var(--text-secondary)]">
              <span className="font-bold text-[color:var(--text-primary)]">{s.pointsToNext.toLocaleString()} pts</span>
              {" to "}
              <span className="font-semibold" style={{ color: s.nextTier.color }}>{s.nextTier.name}</span>
            </span>
          ) : (
            <span className="text-[12px] font-semibold" style={{ color: s.tier.color }}>
              Top tier reached — VIP
            </span>
          )}
          {s.estDaysToNext != null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--text-muted)]">
              <TrendingUp className="w-3 h-3" />
              ~{s.estDaysToNext} days at your pace
            </span>
          )}
        </div>
        <div className="h-1.5 rounded bg-[var(--bg-elevated)] overflow-hidden">
          <div
            className="h-full rounded bg-gold-grad transition-all duration-700"
            style={{ width: `${s.progressPct}%`, boxShadow: "0 0 10px var(--gold-dim)" }}
          />
        </div>
      </div>

      {/* Tier perk — weekly cashback on net losses */}
      {!compact && (
        <div className="mt-5 bg-[var(--bg-elevated)] border border-[color:var(--border-base)] rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Weekly cashback on net losses</p>
          <p className="text-[15px] font-bold text-[color:var(--green)]">{s.tier.cashback}</p>
        </div>
      )}
    </section>
  );
}
