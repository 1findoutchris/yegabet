"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Printer, CheckCircle2, Upload, Copy } from "lucide-react";
import { parseSlip, rawInfoText } from "@/lib/ticketSlip";

/*
 * Ticket detail — doubles as the printable receipt the customer carries.
 * ?print=1 auto-opens the browser print dialog (thermal printers just work —
 * they print the page). When the customer returns to collect a win, the agent
 * verifies the ticket code, pays cash, attaches the receipt photo, and marks
 * it paid.
 *
 * "Bet this ticket" opens a new draft using this ticket's selections as a
 * template and sends the agent to /sports to rebuild the slip in BetBy — see
 * /api/agent/tickets/[id]/rebet. Nothing is placed by the click itself.
 */

// Only issued tickets can be copied — mirrors COPYABLE in the rebet route.
const COPYABLE = new Set(["PLACED", "WON", "LOST", "PAID"]);

interface TicketDetail {
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
    gameRound: string | null;
    gameId: string | null;
    gameName: string | null;
    info: unknown;
    transaction: { reference: string; createdAt: string };
  }[];
  copiedFrom: { id: string; publicId: string } | null;
}

export default function AgentTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [openDraftConflict, setOpenDraftConflict] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const printed = useRef(false);

  // Browser print headers show the document title — keep it short so the
  // long site title doesn't print at the top of the ticket.
  useEffect(() => {
    const prev = document.title;
    document.title = "VinnaBet";
    return () => { document.title = prev; };
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/agent/tickets/${id}`);
    if (!res.ok) { setError("Ticket not found"); return; }
    const d = await res.json();
    setTicket(d.ticket);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Auto-print once when arriving from "Issue & print"
  useEffect(() => {
    if (ticket && searchParams.get("print") === "1" && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 400);
    }
  }, [ticket, searchParams]);

  async function markPaid() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Attach the payment receipt first"); return; }
    setBusy(true); setError("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/agent/tickets/${id}/pay`, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not mark paid");
      return;
    }
    load();
  }

  async function betThisTicket() {
    if (copying) return;
    setCopying(true); setError(""); setOpenDraftConflict(false);
    const res = await fetch(`/api/agent/tickets/${id}/rebet`, { method: "POST" }).catch(() => null);
    if (res?.ok) {
      router.push("/sports");
      return; // keep the button disabled through the navigation
    }
    const d = res ? await res.json().catch(() => ({})) : {};
    setError(d.error ?? "Network error — try again");
    setOpenDraftConflict(res?.status === 409 && !!d.ticket);
    setCopying(false);
  }

  if (error && !ticket) return <div className="p-8 text-center text-[color:var(--red)]">{error}</div>;
  if (!ticket) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto print:p-0">
      {/* Printable ticket body */}
      <div className="ticket-print bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-5 print:rounded-none print:border-0 print:p-0 print:bg-white print:text-black print:[&_*]:!text-black print:[&_*]:!border-black">
        <div className="border-b border-dashed border-[color:var(--border-muted)] pb-3 mb-3">
          <p className="font-display text-4xl font-extrabold leading-none text-center">
            Vinna<span className="text-gold-grad print:[background:none]">Bet</span>
          </p>
        </div>

        <p className="text-center font-mono text-xl font-bold tracking-widest mb-3">{ticket.publicId}</p>

        <div className="text-[12px] space-y-1 mb-3">
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Placed</span><span>{new Date(ticket.createdAt).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Status</span><span className="font-bold uppercase">{ticket.status}</span></div>
          {ticket.copiedFrom && (
            <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Copy of</span>
              <Link href={`/agent/tickets/${ticket.copiedFrom.id}`} className="font-mono print:no-underline underline">{ticket.copiedFrom.publicId}</Link>
            </div>
          )}
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

      {/* Actions — hidden when printing */}
      <div className="mt-4 space-y-3 print:hidden">
        {error && (
          <p className="text-[12px] text-[color:var(--red)]">
            {error}
            {openDraftConflict && <> — <Link href="/sports" className="underline">go to the open ticket</Link></>}
          </p>
        )}

        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] font-semibold text-[color:var(--text-primary)]">
            <Printer className="w-4 h-4" /> Print ticket
          </button>
          {COPYABLE.has(ticket.status) && ticket.bets.some((b) => parseSlip(b.info).selections.length > 0) && (
            <button onClick={betThisTicket} disabled={copying}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--gold)] text-black text-[13px] font-bold disabled:opacity-40">
              {copying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
              Bet this ticket
            </button>
          )}
        </div>

        {ticket.status === "WON" && (
          <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-4 space-y-3">
            <p className="text-[12px] text-[color:var(--text-secondary)]">
              Verify the customer&apos;s name and phone above, hand over{" "}
              <span className="font-bold text-emerald-400">{Number(ticket.totalWin).toLocaleString()} ETB</span>,
              then attach the receipt.
            </p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-dashed border-[color:var(--border-muted)] text-[13px] text-[color:var(--text-secondary)]">
              <Upload className="w-4 h-4" /> Attach payment receipt
            </button>
            <button onClick={markPaid} disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[13px] font-bold disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Mark as paid
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
