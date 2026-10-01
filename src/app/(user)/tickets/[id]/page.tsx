"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { TicketReceipt, type TicketView } from "@/components/tickets/TicketReceipt";
import { TicketsLoginPrompt } from "@/components/tickets/TicketsLoginPrompt";

/*
 * One of the player's own sports tickets — the same receipt the in-person
 * agent prints (TicketReceipt), read-only. The API only returns the logged-in
 * player's own bets, so editing the id in the URL just gives "not found".
 */
export default function PlayerTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, status } = useSession();
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    let live = true;
    fetch(`/api/user/tickets/${id}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) { setError("Ticket not found"); return; }
        setTicket((await res.json()).ticket);
      })
      .catch(() => live && setError("Network error — try again"));
    return () => { live = false; };
  }, [id, session]);

  if (status === "loading") return null;
  if (!session) return <TicketsLoginPrompt />;
  if (error) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-[color:var(--red)]">{error}</p>
        <Link href="/tickets" className="text-[13px] underline text-[color:var(--text-secondary)]">Back to ticket history</Link>
      </div>
    );
  }
  if (!ticket) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto print:p-0">
      <Link href="/tickets" className="print:hidden inline-flex items-center gap-1.5 mb-3 text-[12px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]">
        <ArrowLeft className="w-4 h-4" /> Ticket history
      </Link>

      <TicketReceipt ticket={ticket} />

      <div className="mt-4 print:hidden">
        <button onClick={() => window.print()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] font-semibold text-[color:var(--text-primary)]">
          <Printer className="w-4 h-4" /> Print ticket
        </button>
      </div>
    </div>
  );
}
