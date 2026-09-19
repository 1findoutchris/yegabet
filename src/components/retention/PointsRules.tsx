"use client";

import { POINTS_RULES } from "@/lib/retention";
import { formatCurrency } from "@/lib/utils";

// The "How to earn points" grid.
// `pointsPerEtb` comes from the caller's getRewardConfig() so the spend line
// always states the rate the admin actually configured.
export function PointsRules({ pointsPerEtb }: { pointsPerEtb: number }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {POINTS_RULES.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 bg-[var(--bg-elevated)] border border-[color:var(--border-base)] rounded-lg px-4 py-3">
            <span className="text-[13px] text-[color:var(--text-secondary)]">{r.label}</span>
            <span className="text-[13px] font-bold text-[color:var(--gold)] whitespace-nowrap">{r.value}</span>
          </div>
        ))}
      </div>

      {/* What points are actually for. */}
      <div className="mt-2.5 flex items-center justify-between gap-3 bg-[var(--purple-2)]/10 border border-[color:var(--purple-2)]/30 rounded-lg px-4 py-3">
        <span className="text-[13px] text-[color:var(--text-secondary)]">
          Spend points on bonus credit
        </span>
        <span className="text-[13px] font-bold text-[color:var(--purple-2)] whitespace-nowrap">
          {pointsPerEtb} pts = {formatCurrency(1)}
        </span>
      </div>
    </>
  );
}
