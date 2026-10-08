"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminFetch } from "../useAdmin";
import {
  PeriodPicker, RangeNote, RateForm, TotalsCards, fmt, ggrTone, policyLabel, useRange,
  type Rate, type Totals,
} from "./shared";

type Line = Totals & { providerKey: string; providerName: string; integration: string; currency: string };
type Data = {
  fromDay: string; toDay: string; tz: string; today: string; canEdit: boolean;
  currencies: { currency: string; lines: Line[]; totals: Pick<Totals, "totalBet" | "totalWin" | "ggr" | "fee" | "remaining" | "unsettledBet" | "voidedBet"> }[];
  defaults: { integration: string; name: string; providerKey: string; rate: Rate | null }[];
};

const INTEGRATION_NAME: Record<string, string> = { octhera: "Octhera", silent: "Silent API", gregmorn: "Gregmorn" };

export default function ProviderGgrPage() {
  return (
    <Suspense>
      <ProviderGgr />
    </Suspense>
  );
}

function ProviderGgr() {
  const { secret } = useParams<{ secret: string }>();
  const adminFetch = useAdminFetch();
  const { query, ready } = useRange();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch(`/provider-ggr?${query}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load");
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load. Try again.");
    } finally {
      setLoading(false);
    }
  }, [adminFetch, query, ready]);

  useEffect(() => { load(); }, [load]);

  const hasUnattributed = data?.currencies.some((c) => c.lines.some((l) => l.providerKey.endsWith(":unattributed")));
  const hasUnrated = data?.currencies.some((c) => c.lines.some((l) => l.unratedGgr !== 0));

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">Provider GGR</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            Gaming revenue per game provider, from our own wallet records, and each provider&apos;s fee
          </p>
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
          {data.currencies.length === 0 && (
            <p className="text-center py-10 text-[13px] text-[color:var(--text-muted)] rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)]">
              No game activity in this period
            </p>
          )}

          {data.currencies.map((c) => (
            <section key={c.currency} className="space-y-3">
              {data.currencies.length > 1 && (
                <h2 className="text-[15px] font-bold text-[color:var(--text-primary)]">{c.currency}</h2>
              )}
              <TotalsCards t={c.totals} currency={c.currency} />

              <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-[color:var(--border-muted)] text-[color:var(--text-muted)] text-[11px] uppercase tracking-wide">
                        <th className="text-left px-4 py-2">Provider</th>
                        <th className="text-right px-4 py-2">Total Bet</th>
                        <th className="text-right px-4 py-2">Total Win</th>
                        <th className="text-right px-4 py-2">GGR</th>
                        <th className="text-right px-4 py-2">Fee %</th>
                        <th className="text-right px-4 py-2">Fee</th>
                        <th className="text-right px-4 py-2">Remaining</th>
                        <th className="text-right px-4 py-2">Unsettled</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {c.lines.map((l) => (
                        <tr key={l.providerKey} className="border-b border-[color:var(--border-muted)] hover:bg-[var(--bg-elevated)] transition-colors">
                          <td className="px-4 py-2.5">
                            <Link href={`/admin/${secret}/provider-ggr/${encodeURIComponent(l.providerKey)}?${query}`} className="block">
                              <p className="font-semibold text-[color:var(--text-primary)]">{l.providerName}</p>
                              <p className="text-[11px] text-[color:var(--text-muted)]">{INTEGRATION_NAME[l.integration] ?? l.integration} · {l.providerKey}</p>
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--text-secondary)]">{fmt(l.totalBet)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--red)]">{fmt(l.totalWin)}</td>
                          <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", ggrTone(l.ggr))}>{fmt(l.ggr)}</td>
                          <td className="px-4 py-2.5 text-right text-[color:var(--text-secondary)]">
                            {l.rate ? `${l.rate.ratePct}%` : <span className="text-[color:var(--text-muted)]">—</span>}
                            {l.mixedRates && <span className="block text-[10px] text-[color:var(--text-muted)]">changed in period</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--purple-2)]">{fmt(l.fee)}</td>
                          <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", ggrTone(l.remaining))}>{fmt(l.remaining)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--text-muted)]">
                            {l.unsettledBet > 0 ? `${fmt(l.unsettledBet)} (${l.unsettledRounds})` : "—"}
                          </td>
                          <td className="px-2">
                            <Link href={`/admin/${secret}/provider-ggr/${encodeURIComponent(l.providerKey)}?${query}`} aria-label="Details">
                              <ChevronRight className="w-4 h-4 text-[color:var(--text-muted)]" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--bg-elevated)] font-semibold">
                        <td className="px-4 py-2.5 text-[color:var(--text-muted)]">Total ({c.currency})</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.totals.totalBet)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--red)]">{fmt(c.totals.totalWin)}</td>
                        <td className={cn("px-4 py-2.5 text-right tabular-nums", ggrTone(c.totals.ggr))}>{fmt(c.totals.ggr)}</td>
                        <td />
                        <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--purple-2)]">{fmt(c.totals.fee)}</td>
                        <td className={cn("px-4 py-2.5 text-right tabular-nums", ggrTone(c.totals.remaining))}>{fmt(c.totals.remaining)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--text-muted)]">{fmt(c.totals.unsettledBet)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </section>
          ))}

          {/* Integration-wide defaults */}
          <section className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
            <div>
              <h2 className="text-[14px] font-semibold text-[color:var(--text-primary)]">Default fee per integration</h2>
              <p className="text-[12px] text-[color:var(--text-muted)]">
                Applies to every provider of the integration that has no rate of its own. Set a provider&apos;s own rate from its page.
                {!data.canEdit && " Your admin account can view rates but not change them."}
              </p>
            </div>
            {data.defaults.map((d) => (
              <div key={d.providerKey} className="border-t border-[color:var(--border-muted)] pt-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-[13px] text-[color:var(--text-primary)] font-semibold">{d.name}</p>
                  <p className="text-[12px] text-[color:var(--text-secondary)]">
                    {d.rate
                      ? <>{d.rate.ratePct}% · {policyLabel(d.rate.policy)} · since {d.rate.effectiveFrom} · by {d.rate.changedBy}</>
                      : <span className="text-[color:var(--text-muted)]">No default — providers without their own rate show no fee</span>}
                  </p>
                  {data.canEdit && (
                    <button onClick={() => setEditing(editing === d.providerKey ? null : d.providerKey)}
                      className="text-[12px] font-semibold text-[color:var(--gold)]">
                      {editing === d.providerKey ? "Cancel" : "Change"}
                    </button>
                  )}
                </div>
                {editing === d.providerKey && (
                  <div className="mt-3">
                    <RateForm providerKey={d.providerKey} current={d.rate} today={data.today} compact
                      onSaved={() => { setEditing(null); load(); }} />
                  </div>
                )}
              </div>
            ))}
          </section>

          <Notes unattributed={!!hasUnattributed} unrated={!!hasUnrated} />
        </>
      )}
    </div>
  );
}

function Notes({ unattributed, unrated }: { unattributed: boolean; unrated: boolean }) {
  return (
    <div className="text-[12px] text-[color:var(--text-muted)] bg-[var(--bg-surface)] border border-[color:var(--border-base)] rounded-xl px-4 py-3 space-y-1.5">
      <p><strong className="text-[color:var(--text-secondary)]">How this is counted.</strong> Rounds are built from our own wallet
        callbacks and dated by when they started. Rolled-back bets are left out entirely; refunded stakes count as a payout,
        so the round nets to zero. Fees apply to settled rounds only — open sportsbook bets show under Unsettled. A casino round
        with no settlement event is treated as settled after 24 hours.</p>
      <p>Each day is charged at the rate in force that day, so changing a rate never alters earlier periods.
        Net-GGR agreements are netted within the selected range.</p>
      {unattributed && (
        <p className="text-[color:var(--red)]">“Unattributed” rows are games our catalogs can&apos;t place under a provider. They are shown
          on their own rather than split across providers.</p>
      )}
      {unrated && <p className="text-[color:var(--red)]">Some providers have no fee configured for part of the period — their fee is shown as 0 there.</p>}
    </div>
  );
}
