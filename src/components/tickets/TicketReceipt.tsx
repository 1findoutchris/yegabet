"use client";

import { parseSlip, rawInfoText } from "@/lib/ticketSlip";

/*
 * The printable ticket body — games, odds, stake, potential win, status.
 * Shared by the in-person agent's ticket page and a player's own ticket
 * history; both APIs return this same shape. Print styles flatten it to
 * black-on-white for thermal printers.
 */

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
    transaction: { createdAt: string };
  }[];
}

export function TicketReceipt({ ticket }: { ticket: TicketView }) {
  return (
    <div className="ticket-print bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-5 print:rounded-none print:border-0 print:p-0 print:bg-white print:text-black print:[&_*]:!text-black print:[&_*]:!border-black">
      <div className="border-b border-dashed border-[color:var(--border-muted)] pb-3 mb-3">
        <p className="font-display text-4xl font-extrabold leading-none text-center">
          Vinna<span className="text-gold-grad print:[background:none]">Bet</span>
        </p>
      </div>

      <p className="text-center font-mono text-xl font-bold tracking-widest mb-3 break-all">{ticket.publicId}</p>

      <div className="text-[12px] space-y-1 mb-3">
        <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Placed</span><span>{new Date(ticket.createdAt).toLocaleString()}</span></div>
        <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Status</span><span className="font-bold uppercase">{ticket.status}</span></div>
      </div>

      <div className="border-t border-dashed border-[color:var(--border-muted)] pt-3 mb-3">
        {ticket.bets.map((b, i) => {
          const slip = parseSlip(b.info);
          const potential = slip.totalOdds ? Number(b.betAmount) * Number(slip.totalOdds) : null;
          return (
            <div key={b.id} className="text-[12px] mb-3 last:mb-0">
              {slip.selections.length > 0 ? (
                <>
                  {slip.selections.map((s, j) => (
                    <div key={j} className="py-2 border-b border-[color:var(--border-muted)] break-inside-avoid">
                      <div className="flex justify-between items-baseline gap-3">
                        <p className="font-semibold min-w-0">{s.match}</p>
                        {s.kickoff && <p className="shrink-0 whitespace-nowrap text-right text-[color:var(--text-muted)]">{s.kickoff}</p>}
                      </div>
                      {s.marketPick && <p>{s.marketPick}</p>}
                      {s.odds && <p>Odds: {s.odds}</p>}
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
      {Number(ticket.totalWin) > 0 && (
        <div className="flex justify-between text-[13px] font-bold text-emerald-500 mt-1">
          <span>Win</span><span>{Number(ticket.totalWin).toLocaleString()} ETB</span>
        </div>
      )}
      {ticket.paidAt && (
        <p className="text-[11px] text-[color:var(--text-muted)] mt-2">Paid {new Date(ticket.paidAt).toLocaleString()}</p>
      )}
    </div>
  );
}
