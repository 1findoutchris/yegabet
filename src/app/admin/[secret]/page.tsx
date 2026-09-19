"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminFetch } from "./useAdmin";
import { ArrowDownLeft, ArrowUpRight, Users, Clock, TrendingUp, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const POLL_MS = 10_000; // auto-refresh the overview every 10s

interface Stats {
  pendingDeposits: number;
  pendingWithdrawals: number;
  totalUsers: number;
  activeToday: number;
  depositToday: { amount: number; count: number };
  depositWeek: { amount: number; count: number };
  withdrawalWeek: { amount: number; count: number };
  recentDeposits: { id: string; username: string; name: string | null; amount: number; method: string; createdAt: string }[];
  recentWithdrawals: { id: string; username: string; name: string | null; amount: number; method: string; account: string; createdAt: string }[];
}

function fmtETB(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function AdminOverview() {
  const { secret } = useParams<{ secret: string }>();
  const adminFetch = useAdminFetch();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await adminFetch("/stats");
      if (!res.ok) throw new Error();
      setStats(await res.json());
      setError(false);
      setLastUpdated(new Date());
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial load + auto-refresh poll so new deposit/withdrawal requests appear
  // without a manual reload.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  if (error || !stats) return <div className="p-8 text-[color:var(--red)] text-sm">Failed to load — check the admin secret.</div>;

  const base = `/admin/${secret}`;

  const statCards = [
    { label: "Pending deposits",    value: stats.pendingDeposits,    href: `${base}/deposits`,    icon: ArrowDownLeft, color: "var(--green)",  urgent: stats.pendingDeposits > 0 },
    { label: "Pending withdrawals", value: stats.pendingWithdrawals, href: `${base}/withdrawals`, icon: ArrowUpRight,  color: "var(--red)",   urgent: stats.pendingWithdrawals > 0 },
    { label: "Total users",         value: stats.totalUsers,         href: `${base}/users`,       icon: Users,         color: "var(--purple-2)", urgent: false },
    { label: "Active today",        value: stats.activeToday,        href: `${base}/users`,       icon: Clock,         color: "var(--gold)",  urgent: false },
  ];

  return (
    <div className="p-5 sm:p-7 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-[22px] font-extrabold text-[color:var(--text-primary)]">Overview</h1>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--green)]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[color:var(--green)] opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[color:var(--green)]" />
          </span>
          Live
        </span>
        <button
          onClick={load}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] text-[12px] font-semibold text-[color:var(--text-secondary)] hover:border-[color:var(--border-accent)] hover:text-[color:var(--text-primary)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>
      {lastUpdated && (
        <p className="text-[11px] text-[color:var(--text-muted)] -mt-4 mb-6">
          Updated {lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {statCards.map(({ label, value, href, icon: Icon, color, urgent }) => (
          <Link key={label} href={href}
            className={cn(
              "rounded-2xl border p-4 flex flex-col gap-2 transition-colors hover:border-[color:var(--border-accent)]",
              urgent ? "border-[color:var(--border-accent)] bg-[var(--bg-accent-dim)]" : "border-[color:var(--border-base)] bg-[var(--bg-surface)]"
            )}>
            <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: `${color}1A` }}>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <p className="font-display text-[26px] font-extrabold text-[color:var(--text-primary)] tabular-nums leading-none">{value.toLocaleString()}</p>
            <p className="text-[11px] text-[color:var(--text-muted)] uppercase tracking-[0.05em]">{label}</p>
          </Link>
        ))}
      </div>

      {/* Revenue strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        {[
          { label: "Deposits today",    amount: stats.depositToday.amount,    count: stats.depositToday.count },
          { label: "Deposits this week", amount: stats.depositWeek.amount,     count: stats.depositWeek.count },
          { label: "Withdrawals this week", amount: stats.withdrawalWeek.amount, count: stats.withdrawalWeek.count },
        ].map(({ label, amount, count }) => (
          <div key={label} className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 flex items-center gap-3">
            <TrendingUp className="w-4 h-4 text-[color:var(--gold)] shrink-0" />
            <div>
              <p className="text-[11px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">{label}</p>
              <p className="font-display text-[18px] font-extrabold text-[color:var(--text-primary)] tabular-nums leading-none mt-0.5">
                ETB {fmtETB(amount)}
              </p>
              <p className="text-[11px] text-[color:var(--text-muted)]">{count} transactions</p>
            </div>
          </div>
        ))}
      </div>

      {/* Recent pending */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PendingList title="Pending deposits" items={stats.recentDeposits.map((d) => ({ id: d.id, username: d.name || d.username, amount: d.amount, sub: d.method, date: d.createdAt }))} href={`${base}/deposits`} color="var(--green)" />
        <PendingList title="Pending withdrawals" items={stats.recentWithdrawals.map((w) => ({ id: w.id, username: w.name || w.username, amount: w.amount, sub: `${w.method} · ${w.account}`, date: w.createdAt }))} href={`${base}/withdrawals`} color="var(--red)" />
      </div>
    </div>
  );
}

function PendingList({ title, items, href, color }: {
  title: string;
  items: { id: string; username: string; amount: number; sub: string; date: string }[];
  href: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-muted)]">
        <p className="text-[13px] font-bold text-[color:var(--text-primary)]">{title}</p>
        <Link href={href} className="text-[12px] text-[color:var(--gold)]">View all →</Link>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-[12px] text-[color:var(--text-muted)] text-center">All clear</p>
      ) : (
        <div className="divide-y divide-[color:var(--border-muted)]">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `${color}1A` }}>
                <span className="text-[11px] font-bold" style={{ color }}>{item.username.slice(0, 2).toUpperCase()}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[color:var(--text-primary)] truncate">{item.username}</p>
                <p className="text-[11px] text-[color:var(--text-muted)] truncate">{item.sub} · {fmtDate(item.date)}</p>
              </div>
              <p className="font-bold text-[13px] tabular-nums shrink-0" style={{ color }}>
                ETB {fmtETB(item.amount)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
