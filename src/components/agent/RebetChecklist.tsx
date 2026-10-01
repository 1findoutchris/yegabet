"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Clock, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RebetComparison, RebetLeg } from "@/lib/ticketSlip";

/*
 * "Bet this ticket" checklist — floats above the draft bar on /sports while
 * the open draft is a copy. Lists the original's selections so the agent can
 * rebuild the slip in BetBy, then ticks each one off as the new bet attaches.
 *
 * BetBy owns the bet slip: it shows current odds, refuses closed or suspended
 * markets, takes the new stake and asks for confirmation. This panel never
 * places anything — it only reports what the new ticket holds vs the original.
 */

const STATE: Record<RebetLeg["state"], { icon: typeof Clock; tone: string; label: (l: RebetLeg) => string }> = {
  pending: {
    icon: Clock,
    tone: "text-[color:var(--text-muted)]",
    label: (l) => `Add in sportsbook${l.oldOdds ? ` · was ${l.oldOdds}` : ""}`,
  },
  placed: {
    icon: CheckCircle2,
    tone: "text-emerald-400",
    label: (l) => `On new bet · ${l.newOdds ?? "—"}`,
  },
  odds_changed: {
    icon: AlertTriangle,
    tone: "text-amber-400",
    label: (l) => `Odds changed ${l.oldOdds ?? "—"} → ${l.newOdds ?? "—"}`,
  },
  started: {
    icon: XCircle,
    tone: "text-[color:var(--red)]",
    label: () => "Already started — skip",
  },
};

export function RebetChecklist({
  originalCode,
  previousStake,
  rebet,
}: {
  originalCode: string;
  previousStake: number;
  rebet: RebetComparison;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const available = rebet.legs.filter((l) => l.state !== "started").length;
  const onBet = rebet.legs.filter((l) => l.state === "placed" || l.state === "odds_changed").length;
  const changed = rebet.legs.some((l) => l.state === "odds_changed");

  return (
    <div className="fixed right-3 bottom-[4.5rem] z-20 w-[min(22rem,calc(100vw-1.5rem))] max-h-[55vh] flex flex-col bg-[var(--bg-surface)] border border-[color:var(--border-accent)] rounded-2xl shadow-2xl print:hidden">
      <button onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 px-4 py-3 text-left border-b border-[color:var(--border-muted)]">
        <Copy className="w-4 h-4 text-[color:var(--gold)] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-[color:var(--text-primary)]">
            Copy of <span className="font-mono">{originalCode}</span>
          </p>
          <p className="text-[11px] text-[color:var(--text-muted)]">
            {rebet.legs.length} selection{rebet.legs.length === 1 ? "" : "s"} · {available} available · {onBet} on new bet
          </p>
        </div>
        {collapsed ? <ChevronUp className="w-4 h-4 text-[color:var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[color:var(--text-muted)]" />}
      </button>

      {!collapsed && (
        <div className="overflow-auto px-4 py-2 text-[12px]">
          {rebet.legs.map((l, i) => {
            const s = STATE[l.state];
            const Icon = s.icon;
            return (
              <div key={i} className="flex gap-2 py-2 border-b border-[color:var(--border-muted)] last:border-0">
                <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", s.tone)} />
                <div className="min-w-0">
                  <p className={cn("font-semibold text-[color:var(--text-primary)]", l.state === "started" && "line-through opacity-60")}>{l.match}</p>
                  {l.marketPick && <p className="text-[color:var(--text-secondary)]">{l.marketPick}</p>}
                  {l.kickoff && <p className="text-[11px] text-[color:var(--text-muted)]">{l.kickoff}</p>}
                  <p className={cn("text-[11px] font-semibold", s.tone)}>{s.label(l)}</p>
                </div>
              </div>
            );
          })}

          {rebet.duplicatesMerged > 0 && (
            <p className="pt-2 text-[11px] text-[color:var(--text-muted)]">
              {rebet.duplicatesMerged} duplicate selection{rebet.duplicatesMerged === 1 ? "" : "s"} on the original merged.
            </p>
          )}
          {rebet.extraPlaced > 0 && (
            <p className="pt-2 text-[11px] text-[color:var(--text-muted)]">
              +{rebet.extraPlaced} selection{rebet.extraPlaced === 1 ? "" : "s"} on the new bet not on the original.
            </p>
          )}
          {changed && (
            <p className="pt-2 text-[11px] text-amber-400">
              Odds moved since the original — the new ticket pays at the new odds. Tell the customer before issuing.
            </p>
          )}

          <div className="mt-2 p-2.5 rounded-xl bg-[var(--bg-elevated)] text-[11px] text-[color:var(--text-secondary)] space-y-1">
            <p>Previous stake: <span className="font-semibold text-[color:var(--text-primary)]">{previousStake.toLocaleString()} ETB</span> (reference only)</p>
            <p>Add the selections in the sportsbook, enter the customer&apos;s <span className="font-semibold">new stake</span> and confirm there. The bet slip shows current odds and potential payout, and refuses closed markets. Nothing is placed until you confirm.</p>
          </div>
        </div>
      )}
    </div>
  );
}
