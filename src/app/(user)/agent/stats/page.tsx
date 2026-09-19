"use client";

import { useState, useEffect } from "react";
import { Loader2, Wallet, Percent, Ticket, TrendingUp } from "lucide-react";

/*
 * Agent stats — commission earned, wallet position, ticket totals.
 * Commission accrues as COMMISSION transactions on every bet placed, so the
 * "earned" figure is just the ledger sum.
 */

interface Stats {
  username: string;
  name: string | null;
  commissionRate: number;
  balance: number;
  withdrawable: number;
  commissionEarned: number;
  commissionCount: number;
  tickets: Record<string, { count: number; stake: number; win: number }>;
}

export default function AgentStatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/agent/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStats(d));
  }, []);

  if (!stats) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;

  const totalStaked = Object.values(stats.tickets).reduce((s, t) => s + t.stake, 0);
  const totalPaid = stats.tickets.PAID?.win ?? 0;

  const cards = [
    { label: "Balance", value: stats.balance, icon: Wallet },
    { label: "Withdrawable", value: stats.withdrawable, icon: TrendingUp },
    { label: "Commission earned", value: stats.commissionEarned, icon: Percent },
    { label: "Total staked", value: totalStaked, icon: Ticket },
  ];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <h1 className="font-display text-lg font-extrabold text-[color:var(--text-primary)] mb-1">Stats</h1>
      <p className="text-[12px] text-[color:var(--text-muted)] mb-4">
        {stats.name ?? stats.username} · {stats.commissionRate}% commission per bet
      </p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-4">
            <div className="flex items-center gap-2 text-[color:var(--text-muted)] mb-1">
              <Icon className="w-3.5 h-3.5" />
              <p className="text-[11px]">{label}</p>
            </div>
            <p className="text-lg font-bold text-[color:var(--text-primary)]">{value.toLocaleString()} <span className="text-[11px] font-normal">ETB</span></p>
          </div>
        ))}
      </div>

      <h2 className="text-[13px] font-bold text-[color:var(--text-primary)] mb-2">Tickets</h2>
      <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl divide-y divide-[color:var(--border-muted)]">
        {["PLACED", "WON", "PAID", "LOST"].map((s) => {
          const t = stats.tickets[s];
          return (
            <div key={s} className="flex items-center justify-between px-4 py-3 text-[13px]">
              <span className="text-[color:var(--text-secondary)] font-semibold">{s}</span>
              <span className="text-[color:var(--text-primary)]">
                {t?.count ?? 0} ticket{t?.count === 1 ? "" : "s"}
                {s === "PAID" && totalPaid > 0 && (
                  <span className="text-[color:var(--text-muted)]"> · {totalPaid.toLocaleString()} ETB paid out</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
