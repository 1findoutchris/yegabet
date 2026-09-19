"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, Printer, CheckCircle2, Upload } from "lucide-react";

/*
 * Ticket detail — doubles as the printable receipt the customer carries.
 * ?print=1 auto-opens the browser print dialog (thermal printers just work —
 * they print the page). When the customer returns to collect a win, the agent
 * verifies name/phone against this view, pays cash, attaches the receipt
 * photo, and marks it paid.
 */

interface TicketDetail {
  id: string;
  publicId: string;
  customerName: string;
  customerPhone: string;
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
    transaction: { reference: string; createdAt: string };
  }[];
}

export default function AgentTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const printed = useRef(false);

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

  if (error && !ticket) return <div className="p-8 text-center text-[color:var(--red)]">{error}</div>;
  if (!ticket) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto">
      {/* Printable ticket body */}
      <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-5 print:border-black print:bg-white print:text-black">
        <div className="text-center border-b border-dashed border-[color:var(--border-muted)] pb-3 mb-3">
          <p className="font-display text-[15px] font-extrabold">Vinna<span className="text-gold-grad print:text-black">Bet</span></p>
          <p className="text-[11px] text-[color:var(--text-muted)]">Bet Ticket</p>
        </div>

        <p className="text-center font-mono text-xl font-bold tracking-widest mb-3">{ticket.publicId}</p>

        <div className="text-[12px] space-y-1 mb-3">
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Customer</span><span className="font-semibold">{ticket.customerName}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Phone</span><span>{ticket.customerPhone}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Placed</span><span>{new Date(ticket.createdAt).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--text-muted)]">Status</span><span className="font-bold uppercase">{ticket.status}</span></div>
        </div>

        <div className="border-t border-dashed border-[color:var(--border-muted)] pt-3 space-y-1.5 mb-3">
          {ticket.bets.map((b, i) => (
            <div key={b.id} className="flex justify-between text-[12px]">
              <span className="text-[color:var(--text-muted)]">Bet {i + 1} · {b.transaction.reference.slice(0, 10)}</span>
              <span>
                {Number(b.betAmount).toLocaleString()} ETB
                {b.settled && Number(b.winAmount) > 0 && (
                  <span className="text-emerald-500"> → {Number(b.winAmount).toLocaleString()}</span>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-[color:var(--border-muted)] pt-3 flex justify-between text-[13px] font-bold">
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
        {error && <p className="text-[12px] text-[color:var(--red)]">{error}</p>}

        <button onClick={() => window.print()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] font-semibold text-[color:var(--text-primary)]">
          <Printer className="w-4 h-4" /> Print ticket
        </button>

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
