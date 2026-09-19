"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import {
  TrendingUp, TrendingDown, Minus, ArrowDownLeft,
  ArrowUpRight, Loader2, RefreshCw, Calendar, Gift,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Period = "today" | "week" | "month" | "custom";

interface DayEntry {
  date: string;
  deposits: number;
  withdrawals: number;
  bonus: number;
  depositCount: number;
  withdrawalCount: number;
  bonusCount: number;
  net: number;
}

interface TopDepositor {
  userId: string;
  username: string;
  phone: string;
  amount: number;
  count: number;
}

interface ReportData {
  period: string;
  from: string;
  to: string;
  totals: {
    deposited: number;
    depositCount: number;
    withdrawn: number;
    withdrawalCount: number;
    bonus: number;
    bonusCount: number;
    net: number;
  };
  days: DayEntry[];
  topDepositors: TopDepositor[];
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ReportsPage() {
  const { secret } = useParams<{ secret: string }>();
  const [period, setPeriod] = useState<Period>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let url = `/api/admin/reports?period=${period}`;
      if (period === "custom" && customFrom && customTo) {
        url += `&from=${customFrom}&to=${customTo}`;
      }
      const res = await fetch(url, { headers: { "x-admin-secret": secret } });
      if (!res.ok) throw new Error("Failed to load");
      setData(await res.json());
    } catch {
      setError("Failed to load report. Try again.");
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

  // Bar chart max
  const maxVal = data
    ? Math.max(...data.days.map((d) => Math.max(d.deposits, d.withdrawals)), 1)
    : 1;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">Financial Reports</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">Deposits &amp; withdrawals over time</p>
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

      {/* Custom date range */}
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
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              label="Total Deposited"
              value={`ETB ${fmt(data.totals.deposited)}`}
              sub={`${data.totals.depositCount} deposits`}
              icon={ArrowDownLeft}
              color="green"
            />
            <StatCard
              label="Total Withdrawn"
              value={`ETB ${fmt(data.totals.withdrawn)}`}
              sub={`${data.totals.withdrawalCount} withdrawals`}
              icon={ArrowUpRight}
              color="red"
            />
            <StatCard
              label="Bonus Given"
              value={`ETB ${fmt(data.totals.bonus)}`}
              sub={`${data.totals.bonusCount} grants`}
              icon={Gift}
              color="purple"
            />
            <StatCard
              label="Net Revenue"
              value={`ETB ${fmt(data.totals.net)}`}
              sub={data.totals.net >= 0 ? "Positive" : "Negative"}
              icon={data.totals.net >= 0 ? TrendingUp : TrendingDown}
              color={data.totals.net >= 0 ? "gold" : "red"}
            />
            <StatCard
              label="Avg Deposit"
              value={data.totals.depositCount > 0
                ? `ETB ${fmt(data.totals.deposited / data.totals.depositCount)}`
                : "—"}
              sub="Per transaction"
              icon={Minus}
              color="purple"
            />
          </div>

          {/* Bar chart */}
          {data.days.length > 0 && (
            <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
              <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)] mb-4">
                Daily Breakdown
              </h2>
              <div className="overflow-x-auto">
                <div className="min-w-[400px]">
                  {/* Chart */}
                  <div className="flex items-end gap-1.5 h-40 mb-1">
                    {data.days.map((d) => {
                      const depH = Math.round((d.deposits / maxVal) * 100);
                      const wdH = Math.round((d.withdrawals / maxVal) * 100);
                      return (
                        <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                          {/* Tooltip */}
                          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap">
                            <div className="bg-[var(--bg-elevated)] border border-[color:var(--border-base)] rounded-lg px-2.5 py-1.5 text-[11px] shadow-lg">
                              <p className="text-[color:var(--text-muted)] mb-1">{fmtDate(d.date)}</p>
                              <p className="text-[color:var(--green)]">+ETB {fmt(d.deposits)}</p>
                              <p className="text-[color:var(--red)]">-ETB {fmt(d.withdrawals)}</p>
                              {d.bonus > 0 && (
                                <p className="text-[color:var(--purple-2)]">Bonus ETB {fmt(d.bonus)}</p>
                              )}
                              <p className={cn("font-semibold", d.net >= 0 ? "text-[color:var(--gold)]" : "text-[color:var(--red)]")}>
                                Net: {d.net >= 0 ? "+" : ""}ETB {fmt(d.net)}
                              </p>
                            </div>
                          </div>
                          <div className="w-full flex items-end gap-px h-40">
                            <div
                              className="flex-1 rounded-t-sm transition-all"
                              style={{
                                height: `${depH}%`,
                                background: "var(--green)",
                                opacity: 0.85,
                                minHeight: d.deposits > 0 ? 2 : 0,
                              }}
                            />
                            <div
                              className="flex-1 rounded-t-sm transition-all"
                              style={{
                                height: `${wdH}%`,
                                background: "var(--red)",
                                opacity: 0.75,
                                minHeight: d.withdrawals > 0 ? 2 : 0,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* X-axis labels — show only if ≤14 days */}
                  {data.days.length <= 14 && (
                    <div className="flex gap-1.5">
                      {data.days.map((d) => (
                        <p key={d.date} className="flex-1 text-center text-[9px] text-[color:var(--text-muted)]">
                          {fmtDate(d.date)}
                        </p>
                      ))}
                    </div>
                  )}
                  {/* Legend */}
                  <div className="flex gap-4 mt-3">
                    <span className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">
                      <span className="w-3 h-2 rounded-sm inline-block" style={{ background: "var(--green)" }} />
                      Deposits
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">
                      <span className="w-3 h-2 rounded-sm inline-block" style={{ background: "var(--red)" }} />
                      Withdrawals
                    </span>
                  </div>
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
                    <th className="text-right px-4 py-2">Deposits</th>
                    <th className="text-right px-4 py-2">Count</th>
                    <th className="text-right px-4 py-2">Withdrawals</th>
                    <th className="text-right px-4 py-2">Count</th>
                    <th className="text-right px-4 py-2">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.filter((d) => d.deposits > 0 || d.withdrawals > 0).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-[color:var(--text-muted)]">No transactions in this period</td>
                    </tr>
                  ) : (
                    data.days
                      .filter((d) => d.deposits > 0 || d.withdrawals > 0)
                      .map((d) => (
                        <tr key={d.date} className="border-b border-[color:var(--border-muted)] hover:bg-[var(--bg-elevated)] transition-colors">
                          <td className="px-4 py-2.5 text-[color:var(--text-secondary)] font-mono text-[12px]">{d.date}</td>
                          <td className="px-4 py-2.5 text-right text-[color:var(--green)] font-medium">ETB {fmt(d.deposits)}</td>
                          <td className="px-4 py-2.5 text-right text-[color:var(--text-muted)]">{d.depositCount}</td>
                          <td className="px-4 py-2.5 text-right text-[color:var(--red)]">ETB {fmt(d.withdrawals)}</td>
                          <td className="px-4 py-2.5 text-right text-[color:var(--text-muted)]">{d.withdrawalCount}</td>
                          <td className={cn(
                            "px-4 py-2.5 text-right font-semibold",
                            d.net >= 0 ? "text-[color:var(--gold)]" : "text-[color:var(--red)]"
                          )}>
                            {d.net >= 0 ? "+" : ""}ETB {fmt(d.net)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
                {data.days.some((d) => d.deposits > 0 || d.withdrawals > 0) && (
                  <tfoot>
                    <tr className="bg-[var(--bg-elevated)] font-semibold text-[13px]">
                      <td className="px-4 py-2.5 text-[color:var(--text-muted)]">Total</td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--green)]">ETB {fmt(data.totals.deposited)}</td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--text-muted)]">{data.totals.depositCount}</td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--red)]">ETB {fmt(data.totals.withdrawn)}</td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--text-muted)]">{data.totals.withdrawalCount}</td>
                      <td className={cn(
                        "px-4 py-2.5 text-right",
                        data.totals.net >= 0 ? "text-[color:var(--gold)]" : "text-[color:var(--red)]"
                      )}>
                        {data.totals.net >= 0 ? "+" : ""}ETB {fmt(data.totals.net)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Top depositors */}
          {data.topDepositors.length > 0 && (
            <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[color:var(--border-muted)]">
                <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Top Depositors</h2>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[color:var(--border-muted)] text-[color:var(--text-muted)] text-[11px] uppercase tracking-wide">
                    <th className="text-left px-4 py-2">#</th>
                    <th className="text-left px-4 py-2">User</th>
                    <th className="text-right px-4 py-2">Total Deposited</th>
                    <th className="text-right px-4 py-2">Deposits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topDepositors.map((d, i) => (
                    <tr key={d.userId} className="border-b border-[color:var(--border-muted)] hover:bg-[var(--bg-elevated)] transition-colors">
                      <td className="px-4 py-2.5 text-[color:var(--text-muted)] text-[12px] font-mono">
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-[color:var(--text-primary)] font-medium">{d.username || "—"}</p>
                        <p className="text-[11px] text-[color:var(--text-muted)]">{d.phone}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--green)] font-semibold">
                        ETB {fmt(d.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[color:var(--text-muted)]">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
    purple: { bg: "#8B5CF618", border: "#8B5CF633", icon: "var(--purple-2)" },
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
