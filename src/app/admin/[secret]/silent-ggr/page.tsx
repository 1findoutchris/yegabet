"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import {
  Loader2, RefreshCw, Calendar, Percent, Coins, TrendingDown, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Period = "today" | "week" | "month" | "custom";

interface Totals {
  ggr: number;
  staked: number;
  payout: number;
  silentCut: number;
  billable: number;
  rounds: number;
}

interface GgrData {
  period: string;
  from: string;
  to: string;
  rate: number;
  totals: Totals;
  days: ({ date: string } & Totals)[];
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function SilentGgrPage() {
  const { secret } = useParams<{ secret: string }>();
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<GgrData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let url = `/api/admin/silent-ggr?period=${period}`;
      if (period === "custom" && customFrom && customTo) {
        url += `&from=${customFrom}&to=${customTo}`;
      }
      const res = await fetch(url, { headers: { "x-admin-secret": secret } });
      if (!res.ok) throw new Error("Failed to load");
      setData(await res.json());
    } catch {
      setError("Failed to load GGR. Try again.");
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo, secret]);

  useEffect(() => {
    if (period !== "custom") load();
  }, [period, load]);

  const tabs: { id: Period; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "custom", label: "Custom" },
  ];

  const pct = data ? Math.round(data.rate * 100) : 10;
  const activeDays = data?.days.filter((d) => d.rounds > 0) ?? [];
  const maxAbs = Math.max(...activeDays.map((d) => Math.abs(d.ggr)), 1);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">Silent API GGR</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            Gaming revenue over the provider rails and its {pct}% share
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[12px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors disabled:opacity-50">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Period tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setPeriod(t.id)}
            className={cn(
              "px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors border",
              period === t.id
                ? "bg-[var(--bg-accent-dim)] text-[color:var(--gold)] border-[color:var(--border-accent)]"
                : "bg-[var(--bg-elevated)] text-[color:var(--text-secondary)] border-[color:var(--border-base)] hover:text-[color:var(--text-primary)]"
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <div className="flex flex-wrap gap-3 items-end p-4 rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-base)]">
          <div>
            <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">From</label>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="h-9 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
          </div>
          <div>
            <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">To</label>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="h-9 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
          </div>
          <button onClick={load} disabled={!customFrom || !customTo || loading}
            className="h-9 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] disabled:opacity-50 flex items-center gap-2">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
            Apply
          </button>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
        </div>
      )}

      {error && (
        <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{error}</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Played With"
              value={`ETB ${fmt(data.totals.staked)}`}
              sub={`${data.totals.rounds.toLocaleString()} settled rounds`}
              icon={Coins}
              color="gold"
            />
            <StatCard
              label="Players Won"
              value={`ETB ${fmt(data.totals.payout)}`}
              sub="Paid back out to players"
              icon={TrendingUp}
              color="red"
            />
            <StatCard
              label="Players Lost (GGR)"
              value={`ETB ${fmt(data.totals.ggr)}`}
              sub="Played with minus won"
              icon={TrendingDown}
              color={data.totals.ggr >= 0 ? "green" : "red"}
            />
            <StatCard
              label={`Silent API cut (${pct}%)`}
              value={`ETB ${fmt(data.totals.silentCut)}`}
              sub={`On ETB ${fmt(data.totals.billable)} of rounds the house won`}
              icon={Percent}
              color="purple"
            />
          </div>

          <p className="text-[12px] text-[color:var(--text-muted)] bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-xl px-4 py-3">
            The {pct}% is charged <strong className="text-[color:var(--text-secondary)]">per round</strong>, not
            on the period: 10% of every round the house won, and 0 on a round the player won. A won round is
            not a credit, so it never pays down a lost one — this is owed even when the period as a whole ends
            down, and it is why the cut can exceed the GGR beside it. Matches Silent API&apos;s Game Transactions
            export exactly. One spin reaches us as two or three callbacks; they are netted into a round first.
          </p>

          {/* Daily GGR chart */}
          {activeDays.length > 0 && (
            <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
              <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)] mb-4">Daily GGR</h2>
              <div className="overflow-x-auto">
                <div className="min-w-[400px]">
                  <div className="flex items-end gap-1.5 h-40 mb-1">
                    {data.days.map((d) => (
                      <div key={d.date} className="flex-1 flex flex-col items-center group relative h-40 justify-end">
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap">
                          <div className="bg-[var(--bg-elevated)] border border-[color:var(--border-base)] rounded-lg px-2.5 py-1.5 text-[11px] shadow-lg">
                            <p className="text-[color:var(--text-muted)] mb-1">{fmtDate(d.date)}</p>
                            <p className={d.ggr >= 0 ? "text-[color:var(--gold)]" : "text-[color:var(--red)]"}>
                              GGR ETB {fmt(d.ggr)}
                            </p>
                            <p className="text-[color:var(--purple-2)]">Cut ETB {fmt(d.silentCut)}</p>
                            <p className="text-[color:var(--text-muted)]">Played ETB {fmt(d.staked)}</p>
                            <p className="text-[color:var(--text-muted)]">Won ETB {fmt(d.payout)}</p>
                            <p className="text-[color:var(--text-muted)]">{d.rounds} rounds</p>
                          </div>
                        </div>
                        <div
                          className="w-full rounded-t-sm transition-all"
                          style={{
                            height: `${Math.round((Math.abs(d.ggr) / maxAbs) * 100)}%`,
                            background: d.ggr >= 0 ? "var(--gold)" : "var(--red)",
                            opacity: 0.85,
                            minHeight: d.rounds > 0 ? 2 : 0,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  {data.days.length <= 14 && (
                    <div className="flex gap-1.5">
                      {data.days.map((d) => (
                        <p key={d.date} className="flex-1 text-center text-[9px] text-[color:var(--text-muted)]">
                          {fmtDate(d.date)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Day-by-day table */}
          <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[color:var(--border-muted)]">
              <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Day-by-Day Table</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[color:var(--border-muted)] text-[color:var(--text-muted)] text-[11px] uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-right px-4 py-2">Rounds</th>
                    <th className="text-right px-4 py-2">Played With</th>
                    <th className="text-right px-4 py-2">Players Won</th>
                    <th className="text-right px-4 py-2">Players Lost</th>
                    <th className="text-right px-4 py-2">Silent {pct}%</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDays.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-[color:var(--text-muted)]">No gameplay in this period</td>
                    </tr>
                  ) : (
                    activeDays.map((d) => (
                      <tr key={d.date} className="border-b border-[color:var(--border-muted)] hover:bg-[var(--bg-elevated)] transition-colors">
                        <td className="px-4 py-2.5 text-[color:var(--text-secondary)] font-mono text-[12px]">{d.date}</td>
                        <td className="px-4 py-2.5 text-right text-[color:var(--text-muted)]">{d.rounds}</td>
                        <td className="px-4 py-2.5 text-right text-[color:var(--text-secondary)]">ETB {fmt(d.staked)}</td>
                        <td className="px-4 py-2.5 text-right text-[color:var(--red)]">ETB {fmt(d.payout)}</td>
                        <td className={cn("px-4 py-2.5 text-right font-semibold",
                          d.ggr >= 0 ? "text-[color:var(--gold)]" : "text-[color:var(--red)]")}>
                          ETB {fmt(d.ggr)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[color:var(--purple-2)]">ETB {fmt(d.silentCut)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {activeDays.length > 0 && (
                  <tfoot>
                    <tr className="bg-[var(--bg-elevated)] font-semibold text-[13px]">
                      <td className="px-4 py-2.5 text-[color:var(--text-muted)]">Total</td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--text-muted)]">{data.totals.rounds}</td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--text-secondary)]">ETB {fmt(data.totals.staked)}</td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--red)]">ETB {fmt(data.totals.payout)}</td>
                      <td className={cn("px-4 py-2.5 text-right",
                        data.totals.ggr >= 0 ? "text-[color:var(--gold)]" : "text-[color:var(--red)]")}>
                        ETB {fmt(data.totals.ggr)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--purple-2)]">ETB {fmt(data.totals.silentCut)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string; sub: string;
  icon: React.ElementType;
  color: "green" | "red" | "gold" | "purple";
}) {
  const colorMap = {
    green: { bg: "#10B98118", border: "#10B98133", icon: "var(--green)" },
    red: { bg: "#FF3B5C18", border: "#FF3B5C33", icon: "var(--red)" },
    gold: { bg: "var(--bg-accent-dim)", border: "var(--border-accent)", icon: "var(--gold)" },
    purple: { bg: "#C07AFF18", border: "#C07AFF33", icon: "var(--purple-2)" },
  };
  const c = colorMap[color];
  return (
    <div className="rounded-2xl border p-4" style={{ background: c.bg, borderColor: c.border }}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-[11px] text-[color:var(--text-muted)] uppercase tracking-wide">{label}</p>
        <span className="w-7 h-7 rounded-lg grid place-items-center"
          style={{ background: c.bg, border: `1px solid ${c.border}` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: c.icon }} />
        </span>
      </div>
      <p className="text-[17px] font-bold text-[color:var(--text-primary)] leading-tight">{value}</p>
      <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">{sub}</p>
    </div>
  );
}
