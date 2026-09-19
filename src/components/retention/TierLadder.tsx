import { TIERS, getRankState, type Tier } from "@/lib/retention";
import { RankBadge } from "./RankBadge";

/** The full tier ladder with thresholds and unlocked privileges. `tiers` defaults
 *  to the built-in ladder; server pages pass the admin-configured ladder. */
export function TierLadder({ points = 0, tiers = TIERS }: { points?: number; tiers?: Tier[] }) {
  const current = getRankState(points, 0, tiers).tier;

  return (
    <section className="bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-[14px] overflow-hidden">
      <div className="px-5 py-4 border-b border-[color:var(--border-muted)]">
        <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--text-primary)]">Tier ladder</h3>
        <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">Six progressive tiers, each with richer weekly cashback.</p>
      </div>

      <div className="divide-y divide-[color:var(--border-muted)]">
        {tiers.map((t) => {
          const isCurrent = t.id === current.id;
          const range = t.max == null ? `${t.min.toLocaleString()}+ pts` : `${t.min.toLocaleString()}–${t.max.toLocaleString()} pts`;
          return (
            <div
              key={t.id}
              className="flex items-center gap-4 px-5 py-3"
              style={isCurrent ? { background: "var(--bg-accent-dim)" } : undefined}
            >
              <RankBadge tier={t} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-bold" style={{ color: t.color }}>{t.name}</span>
                  {isCurrent && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-[#09090B] bg-[var(--gold)] rounded px-1.5 py-0.5">You</span>
                  )}
                </div>
                <p className="text-[11px] text-[color:var(--text-muted)]">{range}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] font-bold text-[color:var(--green)]">{t.cashback}</p>
                <p className="text-[11px] text-[color:var(--text-muted)]">weekly cashback</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
