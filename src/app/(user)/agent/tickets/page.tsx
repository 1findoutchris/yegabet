"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, Ticket, Loader2 } from "lucide-react";

/*
 * Ticket history + lookup. The search bar is what the agent uses when a
 * customer walks back in: type the ticket code, name, or phone and the row
 * surfaces. Clicking a row opens the detail/print view.
 */

interface TicketRow {
  id: string;
  publicId: string;
  customerName: string;
  customerPhone: string;
  status: string;
  totalStake: string;
  totalWin: string;
  createdAt: string;
  paidAt: string | null;
  bets: { id: string }[];
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: "text-[color:var(--text-muted)]",
  PLACED: "text-[color:var(--gold)]",
  WON: "text-emerald-400",
  LOST: "text-[color:var(--text-muted)]",
  PAID: "text-sky-400",
  CANCELLED: "text-[color:var(--red)]",
};

export default function AgentTicketsPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    const res = await fetch(`/api/agent/tickets${q ? `?search=${encodeURIComponent(q)}` : ""}`);
    if (res.ok) {
      const d = await res.json();
      setTickets(d.tickets ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <h1 className="font-display text-lg font-extrabold text-[color:var(--text-primary)] mb-4">Tickets</h1>

      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticket code, customer name or phone…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] text-[color:var(--text-primary)]"
        />
      </div>

      {loading && tickets.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 text-[color:var(--text-muted)]">
          <Ticket className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-[13px]">No tickets yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <Link key={t.id} href={`/agent/tickets/${t.id}`}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[color:var(--border-muted)] hover:border-[color:var(--border-accent)] transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-[color:var(--text-primary)]">
                  {t.publicId} <span className="font-normal text-[color:var(--text-secondary)]">· {t.customerName}</span>
                </p>
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  {t.customerPhone} · {t.bets.length} bet{t.bets.length === 1 ? "" : "s"} · {new Date(t.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] font-bold text-[color:var(--text-primary)]">{Number(t.totalStake).toLocaleString()} ETB</p>
                {Number(t.totalWin) > 0 && (
                  <p className="text-[11px] text-emerald-400">won {Number(t.totalWin).toLocaleString()}</p>
                )}
              </div>
              <span className={`text-[11px] font-bold uppercase ${STATUS_STYLE[t.status] ?? ""}`}>{t.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
