import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getRankState, TIERS, type Tier } from "@/lib/retention";
import { cn } from "@/lib/utils";

/**
 * Level + XP progress. `ring` is the rewards header: a circular track around
 * the tier, XP, and how much is left to the next tier. `strip` is the compact
 * one-line version used on the lobby. XP is the lifetime points total that
 * drives the tier ladder.
 */
export function RewardProgress({
  points = 0,
  tiers = TIERS,
  variant = "ring",
  avgPerDay = 0,
  className,
}: {
  points?: number;
  tiers?: Tier[];
  variant?: "ring" | "strip";
  avgPerDay?: number;
  className?: string;
}) {
  const s = getRankState(points, avgPerDay, tiers);
  const pct = s.progressPct;

  if (variant === "strip") {
    return (
      <Link
        href="/rewards"
        className={cn("group flex items-center gap-4 v-surface px-4 py-3.5 hover:border-[color:var(--v-line-2)] transition-colors", className)}
      >
        <Ring pct={pct} size={44} stroke={4} color={s.tier.color}>
          <span className="text-[10px] font-extrabold" style={{ color: s.tier.color }}>{pct}%</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-white">
            <span style={{ color: s.tier.color }}>{s.tier.name.toUpperCase()}</span>
            <span className="text-[color:var(--v-text-3)] font-semibold"> · {s.points.toLocaleString()} XP</span>
          </p>
          <p className="text-[12px] text-[color:var(--v-text-3)] truncate">
            {s.nextTier ? `${s.pointsToNext.toLocaleString()} XP to ${s.nextTier.name}` : "Top tier reached"}
          </p>
        </div>
        <span className="text-[12px] font-semibold text-[color:var(--v-teal)] flex items-center">
          Rewards <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    );
  }

  return (
    <section className={cn("relative overflow-hidden v-surface p-5 sm:p-6", className)}>
      <div aria-hidden className="absolute -top-24 -right-20 w-72 h-72 rounded-full" style={{ background: `radial-gradient(circle, ${s.tier.color}22, transparent 65%)` }} />
      <div className="relative flex items-center gap-5 sm:gap-7">
        <Ring pct={pct} size={116} stroke={8} color={s.tier.color}>
          <div className="text-center leading-none">
            <p className="text-[22px] font-extrabold text-white tabular-nums">{pct}%</p>
            <p className="mt-1 text-[10px] font-semibold text-[color:var(--v-text-3)] uppercase tracking-[0.1em]">progress</p>
          </div>
        </Ring>
        <div className="min-w-0">
          <p className="v-eyebrow">Level</p>
          <p className="mt-1 text-[28px] sm:text-[32px] font-extrabold tracking-[0.04em] leading-none" style={{ color: s.tier.color }}>
            {s.tier.name.toUpperCase()}
          </p>
          <p className="mt-2 text-[15px] font-bold text-white tabular-nums">{s.points.toLocaleString()} XP</p>
          {s.nextTier ? (
            <p className="mt-2 text-[13px] text-[color:var(--v-text-2)]">
              Next: <span className="font-bold" style={{ color: s.nextTier.color }}>{s.nextTier.name}</span>
              <span className="text-[color:var(--v-text-3)]"> · {s.pointsToNext.toLocaleString()} XP remaining</span>
            </p>
          ) : (
            <p className="mt-2 text-[13px] font-semibold text-[color:var(--v-amber)]">Top tier reached</p>
          )}
          {s.estDaysToNext != null && (
            <p className="mt-1 text-[12px] text-[color:var(--v-text-3)]">About {s.estDaysToNext} days at your pace</p>
          )}
        </div>
      </div>

      {/* Tier track */}
      <div className="relative mt-6 flex items-center gap-1.5">
        {tiers.map((t, i) => {
          const reached = points >= t.min;
          const current = t.name === s.tier.name;
          return (
            <div key={t.name} className="flex-1 min-w-0">
              <div className="h-1.5 rounded-full overflow-hidden bg-[var(--v-bg-3)]">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: current ? `${pct}%` : reached ? "100%" : "0%", background: t.color }}
                />
              </div>
              <p className={cn("mt-1.5 text-[10px] font-semibold truncate", current ? "text-white" : "text-[color:var(--v-text-3)]")}>
                {t.name}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Ring({
  pct, size, stroke, color, children,
}: { pct: number; size: number; stroke: number; color: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0 grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--v-bg-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.2,0.8,0.2,1)" }}
        />
      </svg>
      {children}
    </div>
  );
}
