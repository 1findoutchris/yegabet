"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminFetch } from "../../useAdmin";
import {
  PeriodPicker, RangeNote, RateForm, TotalsCards, fmt, ggrTone, policyLabel, useRange,
  type Rate, type Totals,
} from "../shared";

type Detail = {
  fromDay: string; toDay: string; tz: string; today: string;
  providerKey: string; providerName: string | null; integration: string; canEdit: boolean;
  currentRate: Rate | null; rateHistory: Rate[];
  currencies: {
    currency: string;
    totals: Totals;
    byGame: (Totals & { gameId: string | null; gameName: string | null })[];
    byDay: (Totals & { day: string; ratePct: number | null })[];
  }[];
};

export default function ProviderDetailPage() {
  return (
    <Suspense>
      <ProviderDetail />
    </Suspense>
  );
}

function ProviderDetail() {
  const { secret, providerKey: raw } = useParams<{ secret: string; providerKey: string }>();
  const providerKey = decodeURIComponent(raw);
  const adminFetch = useAdminFetch();
  const { query, ready } = useRange();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch(`/provider-ggr/${encodeURIComponent(providerKey)}?${query}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load");
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load. Try again.");
    } finally {
      setLoading(false);
    }
  }, [adminFetch, providerKey, query, ready]);

  useEffect(() => { load(); }, [load]);

  const ownRate = data?.currentRate?.providerKey === providerKey;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <Link href={`/admin/${secret}/provider-ggr?${query}`}
        className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
        <ArrowLeft className="w-3.5 h-3.5" /> All providers
      </Link>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">{data?.providerName ?? providerKey}</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">{providerKey}</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[12px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors disabled:opacity-50">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      <PeriodPicker loading={loading} />
      {data && <RangeNote fromDay={data.fromDay} toDay={data.toDay} tz={data.tz} />}

      {loading && !data && (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>
      )}
      {error && (
        <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{error}</p>
      )}

      {data && (
        <>
          {/* Fee */}
          <section className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Provider fee</h2>
                <p className="text-[13px] text-[color:var(--text-secondary)] mt-0.5">
                  {data.currentRate
                    ? <>{data.currentRate.ratePct}% · {policyLabel(data.currentRate.policy)} · since {data.currentRate.effectiveFrom}
                        {!ownRate && <span className="text-[color:var(--text-muted)]"> (integration default)</span>}</>
                    : <span className="text-[color:var(--text-muted)]">No rate configured — fee shows as 0</span>}
                </p>
              </div>
              {data.canEdit && (
                <button onClick={() => setEditing((v) => !v)} className="text-[12px] font-semibold text-[color:var(--gold)]">
                  {editing ? "Cancel" : "Set this provider's rate"}
                </button>
              )}
            </div>
            {editing && (
              <RateForm providerKey={providerKey} current={data.currentRate} today={data.today} compact
                onSaved={() => { setEditing(false); load(); }} />
            )}

            {data.rateHistory.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[color:var(--text-muted)] text-[11px] uppercase tracking-wide border-b border-[color:var(--border-muted)]">
                      <th className="text-left py-1.5 pr-3">Effective from</th>
                      <th className="text-left py-1.5 pr-3">Rate</th>
                      <th className="text-left py-1.5 pr-3">Negative GGR</th>
                      <th className="text-left py-1.5 pr-3">Applies to</th>
                      <th className="text-left py-1.5 pr-3">Changed by</th>
                      <th className="text-left py-1.5 pr-3">Changed at</th>
                      <th className="text-left py-1.5">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rateHistory.map((r) => (
                      <tr key={r.id} className="border-b border-[color:var(--border-muted)] text-[color:var(--text-secondary)]">
                        <td className="py-1.5 pr-3 font-mono">{r.effectiveFrom}</td>
                        <td className="py-1.5 pr-3 font-semibold">{r.ratePct}%</td>
                        <td className="py-1.5 pr-3">{policyLabel(r.policy)}</td>
                        <td className="py-1.5 pr-3">{r.providerKey === providerKey ? "This provider" : "Integration default"}</td>
                        <td className="py-1.5 pr-3">{r.changedBy}</td>
                        <td className="py-1.5 pr-3">{new Date(r.createdAt).toLocaleString()}</td>
                        <td className="py-1.5 text-[color:var(--text-muted)]">{r.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.currencies.length === 0 && (
            <p className="text-center py-10 text-[13px] text-[color:var(--text-muted)] rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)]">
              No activity for this provider in this period
            </p>
          )}

          {data.currencies.map((c) => (
            <section key={c.currency} className="space-y-3">
              {data.currencies.length > 1 && <h2 className="text-[15px] font-bold text-[color:var(--text-primary)]">{c.currency}</h2>}
              <TotalsCards t={c.totals} currency={c.currency} />
              {(c.totals.voidedRounds > 0 || c.totals.mixedRates) && (
                <p className="text-[12px] text-[color:var(--text-muted)]">
                  {c.totals.voidedRounds > 0 && <>{c.totals.voidedRounds} rolled-back round(s), {c.currency} {fmt(c.totals.voidedBet)} staked, excluded. </>}
                  {c.totals.mixedRates && <>The rate changed during this period; each day is charged at its own rate.</>}
                </p>
              )}

              <Table title="By game" head={["Game", "Rounds", "Total Bet", "Total Win", "GGR", "Fee", "Remaining", "Unsettled"]}>
                {c.byGame.map((g) => (
                  <tr key={g.gameId ?? "none"} className="border-b border-[color:var(--border-muted)]">
                    <td className="px-4 py-2">
                      <p className="text-[color:var(--text-primary)]">{g.gameName ?? "Unknown game"}</p>
                      <p className="text-[11px] text-[color:var(--text-muted)] font-mono break-all">{g.gameId ?? "—"}</p>
                    </td>
                    <Num v={g.rounds} plain />
                    <Num v={g.totalBet} />
                    <Num v={g.totalWin} red />
                    <Num v={g.ggr} tone />
                    <Num v={g.fee} purple />
                    <Num v={g.remaining} tone />
                    <Num v={g.unsettledBet} muted />
                  </tr>
                ))}
              </Table>

              <Table title="By day" head={["Date", "Rate", "Rounds", "Total Bet", "Total Win", "GGR", "Fee", "Remaining"]}>
                {c.byDay.filter((d) => d.rounds > 0 || d.unsettledRounds > 0).map((d) => (
                  <tr key={d.day} className="border-b border-[color:var(--border-muted)]">
                    <td className="px-4 py-2 font-mono text-[12px] text-[color:var(--text-secondary)]">{d.day}</td>
                    <td className="px-4 py-2 text-right text-[color:var(--text-secondary)]">{d.ratePct === null ? "—" : `${d.ratePct}%`}</td>
                    <Num v={d.rounds} plain />
                    <Num v={d.totalBet} />
                    <Num v={d.totalWin} red />
                    <Num v={d.ggr} tone />
                    <Num v={d.fee} purple />
                    <Num v={d.remaining} tone />
                  </tr>
                ))}
              </Table>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function Table({ title, head, children }: { title: string; head: string[]; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[color:var(--border-muted)]">
        <h3 className="text-[14px] font-semibold text-[color:var(--text-primary)]">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[color:var(--border-muted)] text-[color:var(--text-muted)] text-[11px] uppercase tracking-wide">
              {head.map((h, i) => <th key={h} className={cn("px-4 py-2", i === 0 ? "text-left" : "text-right")}>{h}</th>)}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Num({ v, tone, red, purple, muted, plain }: { v: number; tone?: boolean; red?: boolean; purple?: boolean; muted?: boolean; plain?: boolean }) {
  return (
    <td className={cn(
      "px-4 py-2 text-right tabular-nums",
      tone ? cn("font-semibold", ggrTone(v)) : red ? "text-[color:var(--red)]" : purple ? "text-[color:var(--purple-2)]" : muted ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-secondary)]",
    )}>
      {plain ? v.toLocaleString() : fmt(v)}
    </td>
  );
}
