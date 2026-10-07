"use client";

import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { betTotal, parseSlip, rawInfoText, ticketTotal, withResults, type LegResult } from "@/lib/ticketSlip";
import { PrintTicket } from "./PrintTicket";
import { displayCode } from "@/lib/ticketCode";

/*
 * The ticket body — games, odds, stake, potential win, status.
 * Shared by the in-person agent's ticket page and a player's own ticket
 * history; both APIs return this same shape. This is the screen version
 * only: printing switches to PrintTicket, a plain thermal receipt built from
 * the same data.
 *
 * Each match shows its own result (Won / Lost / Open) when the provider has
 * reported it — `resultInfo` is the settle payload that carries the legs'
 * outcomes. Labels are text, not just colour, so they survive a mono print.
 */

const RESULT: Record<LegResult, { label: string; icon: typeof Clock; tone: string }> = {
  won: { label: "Won", icon: CheckCircle2, tone: "text-emerald-500" },
  lost: { label: "Lost", icon: XCircle, tone: "text-[color:var(--red)]" },
  open: { label: "Open", icon: Clock, tone: "text-[color:var(--text-muted)]" },
};

export interface TicketView {
  id: string;
  publicId: string;
  status: string;
  totalStake: string;
  totalWin: string;
  createdAt: string;
  paidAt: string | null;
  bets: {
    id: string;
    betAmount: string;
    winAmount: string;
    settled: boolean;
    gameName: string | null;
    info: unknown;
    /** Settle payload with per-match results, once the ticket is decided. */
    resultInfo?: unknown;
    transaction: { createdAt: string };
  }[];
}

export function TicketReceipt({ ticket }: { ticket: TicketView }) {
  return (
    <>
    <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-5 print:hidden">
      <div className="border-b border-dashed border-[color:var(--border-muted)] pb-3 mb-3">
        <p className="font-display text-4xl font-extrabold leading-none text-center">
          Vinna<span className="text-gold-grad">Bet</span>
        </p>
      </div>

      <p className="text-center font-mono text-xl font-bold tracking-widest mb-3 break-all">{displayCode(ticket.publicId)}</p>

      <div className="text-[12px] space-y-1 mb-3">
        <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Placed</span><span>{new Date(ticket.createdAt).toLocaleString()}</span></div>
        <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Status</span><span className="font-bold uppercase">{ticket.status}</span></div>
      </div>

      <div className="border-t border-dashed border-[color:var(--border-muted)] pt-3 mb-3">
        {ticket.bets.map((b, i) => {
          const slip = parseSlip(b.info);
          const selections = withResults(slip, b.resultInfo, b.settled);
          const potential = betTotal(b.betAmount, slip.totalOdds);
          return (
            <div key={b.id} className="text-[12px] mb-3 last:mb-0">
              {slip.selections.length > 0 ? (
                <>
                  {selections.map((s, j) => (
                    // Same order as the paper receipt: match, then market + pick
                    // with the odds right-aligned, then kickoff on the left.
                    // The per-match result stays on screen, beside the match.
                    <div key={j} className="py-2 border-b border-[color:var(--border-muted)]">
                      <div className="flex justify-between items-start gap-3">
                        <p className="font-semibold min-w-0">{s.match}</p>
                        {s.result && (() => {
                          const r = RESULT[s.result];
                          const Icon = r.icon;
                          return (
                            <span className={`shrink-0 inline-flex items-center gap-1 font-bold uppercase text-[11px] leading-[18px] ${r.tone}`}>
                              <Icon className="w-3.5 h-3.5" /> {r.label}
                            </span>
                          );
                        })()}
                      </div>
                      {(s.marketPick || s.odds) && (
                        <div className="flex justify-between items-start gap-3">
                          <p className="min-w-0">{s.marketPick}</p>
                          {s.odds && <p className="shrink-0 font-bold tabular-nums text-[color:var(--text-primary)]">{s.odds}</p>}
                        </div>
                      )}
                      {s.kickoff && <p className="text-[color:var(--text-muted)]">{s.kickoff}</p>}
                    </div>
                  ))}
                  {(slip.totalOdds || slip.betType) && (
                    <div className="flex justify-between py-2 border-b border-[color:var(--border-muted)]">
                      {slip.totalOdds && <span>Total Odds: {Number(slip.totalOdds).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
                      {slip.betType && <span className="ml-auto">{slip.betType}</span>}
                    </div>
                  )}
                  <div className="py-2 text-right space-y-0.5 break-inside-avoid">
                    <p>Stake: {Number(b.betAmount).toLocaleString()} ETB</p>
                    {potential !== null && !b.settled && (
                      <p>Potential Win: {potential.toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB</p>
                    )}
                    {b.settled && Number(b.winAmount) > 0 && (
                      <p className="text-emerald-500 font-semibold">Won: {Number(b.winAmount).toLocaleString()} ETB</p>
                    )}
                    <p className="text-[color:var(--text-muted)]">{new Date(b.transaction.createdAt).toLocaleString()}</p>
                  </div>
                </>
              ) : (
                <div className="py-1">
                  <div className="flex justify-between">
                    <span className="font-semibold">{b.gameName ?? `Bet ${i + 1}`}</span>
                    <span>
                      {Number(b.betAmount).toLocaleString()} ETB
                      {b.settled && Number(b.winAmount) > 0 && (
                        <span className="text-emerald-500"> → {Number(b.winAmount).toLocaleString()}</span>
                      )}
                    </span>
                  </div>
                  {/* Never print a blank bet: if the provider payload has an
                      unrecognized shape, dump it so the slip still shows what
                      was bet (and the failure is visible, not silent). */}
                  {b.info != null && (
                    <pre className="mt-1 text-[10px] leading-tight text-[color:var(--text-muted)] whitespace-pre-wrap break-all font-mono">
                      {rawInfoText(b.info)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-dashed border-[color:var(--border-muted)] pt-3 flex justify-between text-[13px] font-bold break-inside-avoid">
        <span>Total stake</span><span>{Number(ticket.totalStake).toLocaleString()} ETB</span>
      </div>
      {/* Possible payout of the whole ticket: each bet's stake × total odds. */}
      {(() => {
        const total = ticketTotal(ticket.bets);
        return total !== null && (
          <div className="flex justify-between text-[14px] font-extrabold text-[color:var(--text-primary)] mt-1">
            <span>Total:</span><span>{total.toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB</span>
          </div>
        );
      })()}
      {Number(ticket.totalWin) > 0 && (
        <div className="flex justify-between text-[13px] font-bold text-emerald-500 mt-1">
          <span>Win</span><span>{Number(ticket.totalWin).toLocaleString()} ETB</span>
        </div>
      )}
      {ticket.paidAt && (
        <p className="text-[11px] text-[color:var(--text-muted)] mt-2">Paid {new Date(ticket.paidAt).toLocaleString()}</p>
      )}
    </div>
    <PrintTicket ticket={ticket} />
    </>
  );
}
