import { Check, Loader2, Gamepad2, Trophy, Coins, Target, Dices } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Mission {
  id: string; title: string; segment: string; unit: string;
  target: number; progress: number; points: number;
  complete: boolean; claimed: boolean; claimable: boolean;
}

const fmt = (n: number, unit: string) => (unit === "ETB" ? `ETB ${n.toLocaleString()}` : `${n.toLocaleString()}`);

function MissionIcon({ m }: { m: Mission }) {
  const s = `${m.segment} ${m.unit}`.toLowerCase();
  const cls = "w-5 h-5";
  if (s.includes("sport")) return <Trophy className={cls} />;
  if (m.unit === "ETB") return <Coins className={cls} />;
  if (s.includes("casino") || s.includes("slot")) return <Gamepad2 className={cls} />;
  if (s.includes("spin") || s.includes("round") || s.includes("bet")) return <Dices className={cls} />;
  return <Target className={cls} />;
}

/**
 * One mission: icon, title, a segmented progress track with the count, the
 * XP reward, and Claim once it is done. Purely presentational: the caller
 * owns fetching and the claim call.
 */
export function MissionCard({
  mission: m,
  onClaim,
  claiming,
  disabled,
}: {
  mission: Mission;
  onClaim: (id: string) => void;
  claiming: boolean;
  disabled: boolean;
}) {
  const pct = Math.min(100, Math.round((m.progress / Math.max(1, m.target)) * 100));
  const segments = 10;
  const filled = Math.round((pct / 100) * segments);

  return (
    <div
      className={cn(
        "v-surface p-4 flex items-start gap-3.5 transition-colors",
        m.complete && !m.claimed && "border-[color:var(--v-teal-a24)]"
      )}
    >
      <span
        className={cn(
          "shrink-0 w-10 h-10 rounded-[12px] grid place-items-center",
          m.claimed ? "bg-[rgba(52,211,153,0.12)] text-[color:var(--v-green)]" : "bg-[var(--v-bg-3)] text-[color:var(--v-teal)]"
        )}
      >
        {m.claimed ? <Check className="w-5 h-5" /> : <MissionIcon m={m} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[14px] font-semibold text-white leading-snug">{m.title}</p>
          <span className="shrink-0 text-[12px] font-extrabold text-[color:var(--v-amber)] tabular-nums">+{m.points} XP</span>
        </div>

        <div className="mt-2.5 flex items-center gap-[3px]" aria-hidden>
          {Array.from({ length: segments }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full transition-colors duration-500"
              style={{ background: i < filled ? (m.complete ? "var(--v-green)" : "var(--v-teal)") : "var(--v-bg-3)", transitionDelay: `${i * 30}ms` }}
            />
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[12px] text-[color:var(--v-text-3)] tabular-nums" aria-label={`${pct}% complete`}>
            {fmt(Math.min(m.progress, m.target), m.unit)} / {fmt(m.target, m.unit)}
            {m.unit !== "ETB" && <span> {m.unit}</span>}
          </span>
          {m.claimed ? (
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--v-green)]">Claimed</span>
          ) : m.claimable ? (
            <button
              onClick={() => onClaim(m.id)}
              disabled={disabled}
              className="v-btn v-btn-primary h-8 px-3.5 text-[12px] rounded-full"
            >
              {claiming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Claim
            </button>
          ) : (
            <span className="text-[11px] font-semibold text-[color:var(--v-text-3)] tabular-nums">{pct}%</span>
          )}
        </div>
      </div>
    </div>
  );
}
