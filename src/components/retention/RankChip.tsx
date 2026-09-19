import Link from "next/link";
import { getRankState } from "@/lib/retention";
import { RankBadge } from "./RankBadge";

/**
 * Compact rank widget for the global nav so progress toward the next tier is
 * visible on every page (per the spec's "always visible" requirement).
 * Renders nothing until the real points total is known.
 */
export function RankChip({ points }: { points: number | null }) {
  if (points === null) return null;
  // ponytail: nav chip uses the default tier ladder, not admin-configured tiers —
  // it's a pure client nav widget with no server parent to inject config. Wire it
  // to a public config endpoint only if tier boundaries get edited in practice.
  const s = getRankState(points);

  return (
    <Link
      href="/rewards"
      title={s.nextTier ? `${s.pointsToNext.toLocaleString()} pts to ${s.nextTier.name}` : "VIP — top tier"}
      className="hidden lg:flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] hover:border-[color:var(--border-accent)] transition-colors"
    >
      <RankBadge tier={s.tier} size={20} />
      <div className="flex flex-col justify-center leading-none">
        <span className="text-[11px] font-bold" style={{ color: s.tier.color }}>{s.tier.name}</span>
        <div className="mt-1 w-16 h-1 rounded bg-[var(--bg-base)] overflow-hidden">
          <div className="h-full rounded bg-[var(--gold)]" style={{ width: `${s.progressPct}%` }} />
        </div>
      </div>
    </Link>
  );
}
