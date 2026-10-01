"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { Ticket, Plus, Printer, Loader2 } from "lucide-react";
import type { RebetComparison } from "@/lib/ticketSlip";
import { RebetChecklist } from "./RebetChecklist";

/*
 * The open-ticket draft bar + ticket gate. Lives on /sports for in-person
 * agents.
 *
 * GATE: with no OPEN ticket the whole sportsbook is covered by a blocking
 * create-ticket form — an agent cannot reach the betslip without a customer
 * ticket, so no bet can ever land unticketed. The iframe stays mounted behind
 * the overlay (no reload when the gate lifts).
 *
 * BAR: with an OPEN ticket it shrinks to the bottom bar — watch BET
 * transactions attach as the wallet callback lands them, then issue + print
 * or cancel. Polls while on /sports since attaches are asynchronous.
 *
 * COPY: when the draft came from "Bet this ticket" the same poll also pulls
 * the original-vs-new comparison and shows RebetChecklist above the bar.
 */

interface OpenTicket {
  id: string;
  publicId: string;
  totalStake: string;
  bets: { id: string; betAmount: string; settled: boolean }[];
  copiedFromTicketId: string | null;
}

interface CopyState {
  originalCode: string;
  previousStake: number;
  rebet: RebetComparison;
}

export function AgentTicketPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState<OpenTicket | null>(null);
  const [copy, setCopy] = useState<CopyState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isSports = pathname === "/sports" || pathname.startsWith("/sports/");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/agent/tickets?status=OPEN").catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      const draft: OpenTicket | null = data.tickets?.[0] ?? null;
      setOpen(draft);
      if (draft?.copiedFromTicketId) {
        // Keep the last good checklist on a failed poll rather than flicker it away.
        const d = await fetch(`/api/agent/tickets/${draft.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (d?.ticket?.rebet && d.ticket.copiedFrom) {
          setCopy({
            originalCode: d.ticket.copiedFrom.publicId,
            previousStake: Number(d.ticket.copiedFrom.totalStake),
            rebet: d.ticket.rebet,
          });
        }
      } else {
        setCopy(null);
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!isSports) return;
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [isSports, refresh]);

  if (!isSports) return null;

  async function start() {
    setBusy(true); setError("");
    const res = await fetch("/api/agent/tickets", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not open ticket");
      return;
    }
    refresh();
  }

  async function issue() {
    if (!open) return;
    setBusy(true);
    const res = await fetch(`/api/agent/tickets/${open.id}/issue`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Could not issue");
      return;
    }
    router.push(`/agent/tickets/${open.id}?print=1`);
  }

  async function cancel() {
    if (!open) return;
    setBusy(true);
    await fetch(`/api/agent/tickets/${open.id}/cancel`, { method: "POST" });
    setBusy(false);
    setOpen(null);
    setCopy(null);
  }

  // Gate — no open ticket: cover the sportsbook until one is created.
  // `loaded` avoids flashing the gate before the first poll returns.
  if (!open) {
    if (!loaded) return null;
    return (
      <div className="fixed inset-0 md:left-56 z-30 bg-[var(--bg-base)] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--bg-accent-dim)] flex items-center justify-center">
              <Ticket className="w-5 h-5 text-[color:var(--gold)]" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[color:var(--text-primary)]">Open a ticket first</h2>
              <p className="text-[12px] text-[color:var(--text-secondary)]">Every bet must go on a customer ticket.</p>
            </div>
          </div>
          {error && <p className="text-[12px] text-[color:var(--red)]">{error}</p>}
          <button onClick={start} disabled={busy} autoFocus
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--gold)] text-black text-[13px] font-bold disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Open ticket & continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    {copy && <RebetChecklist {...copy} />}
    <div className="fixed bottom-0 left-0 right-0 md:left-56 z-20 bg-[var(--bg-surface)] border-t border-[color:var(--border-muted)] px-4 py-3">
      {error && <p className="text-[12px] text-[color:var(--red)] mb-2">{error}</p>}

      {open && (
        <div className="flex flex-wrap items-center gap-3">
          <Ticket className="w-4 h-4 text-[color:var(--gold)]" />
          <div className="text-[13px]">
            <span className="font-bold text-[color:var(--text-primary)]">{open.publicId}</span>
          </div>
          <div className="text-[12px] text-[color:var(--text-muted)]">
            {open.bets.length} bet{open.bets.length === 1 ? "" : "s"} · {Number(open.totalStake).toLocaleString()} ETB
          </div>
          <div className="flex-1" />
          <button onClick={issue} disabled={busy || open.bets.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--gold)] text-black text-[13px] font-bold disabled:opacity-40">
            <Printer className="w-4 h-4" /> Issue & print
          </button>
          <button onClick={cancel} disabled={busy || open.bets.length > 0}
            className="px-3 py-2 rounded-lg text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--red)] disabled:opacity-40">
            Cancel
          </button>
        </div>
      )}
    </div>
    </>
  );
}
