"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ScanLine, Search, ShieldCheck } from "lucide-react";
import { TicketReceipt, type TicketView } from "@/components/tickets/TicketReceipt";
import { BarcodeScanner } from "@/components/tickets/BarcodeScanner";
import { displayCode, normalizeCode } from "@/lib/ticketCode";

/*
 * Public "Check Ticket" — anyone (logged in or not) types a ticket code and
 * sees that ticket: matches, per-match results, stake and status. Shareable
 * as /check?code=T3F9K2A. Owner details are never returned by the API.
 * "Scan ticket" reads the Code 128 barcode on a printed ticket with the phone
 * camera and looks it up the same way. Codes work with or without the hyphen.
 */
function CheckTicket() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("code") ?? "";
  const [code, setCode] = useState(initial);
  const [ticket, setTicket] = useState<TicketView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  const lookup = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setLoading(true); setError(""); setTicket(null);
    const res = await fetch(`/api/tickets/check?code=${encodeURIComponent(value)}`).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) setTicket(d.ticket);
    else if (res?.status === 404) setError(`Ticket ${displayCode(value.toUpperCase())} not found. Check the code and try again, or scan it again.`);
    else setError(d.error ?? "Network error — try again");
    setLoading(false);
  }, []);

  // Shared links (/check?code=…) look the ticket up straight away.
  useEffect(() => {
    if (initial) lookup(initial);
  }, [initial, lookup]);

  function open(raw: string) {
    const value = raw.trim().toUpperCase();
    if (!value) return;
    if (value === initial.toUpperCase()) lookup(value);
    else router.replace(`/check?code=${encodeURIComponent(value)}`);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    open(code);
  }

  // A scan opens the ticket straight away, shown as printed (no hyphen).
  const onScan = useCallback((raw: string) => {
    setScanning(false);
    const value = displayCode(normalizeCode(raw) ?? raw);
    setCode(value);
    setTicket(null);
    open(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  const closeScanner = useCallback(() => setScanning(false), []);

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto print:p-0">
      <div className="print:hidden">
        <h1 className="font-display text-lg font-extrabold text-[color:var(--text-primary)] mb-1">Check Ticket</h1>
        <p className="text-[12px] text-[color:var(--text-secondary)] mb-4">
          Enter a ticket code or scan the barcode on a printed ticket to see its matches and whether it won.
        </p>

        <form onSubmit={submit} className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. T3F9K2A or P7KX2M9QD"
              autoFocus={!initial}
              autoCapitalize="characters"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] font-mono uppercase text-[color:var(--text-primary)]"
            />
          </div>
          <button type="submit" disabled={loading || !code.trim()}
            className="px-4 py-2.5 rounded-xl bg-[var(--gold)] text-black text-[13px] font-bold disabled:opacity-40">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
          </button>
        </form>

        <button type="button" onClick={() => { setError(""); setScanning(true); }}
          className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] font-semibold text-[color:var(--text-primary)]">
          <ScanLine className="w-4 h-4" /> Scan ticket barcode
        </button>

        {loading && (
          <p className="flex items-center gap-2 text-[13px] text-[color:var(--text-secondary)] mb-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Looking up {displayCode(code.trim().toUpperCase())}…
          </p>
        )}

        {error && <p className="text-[13px] text-[color:var(--red)] mb-4">{error}</p>}
      </div>

      {scanning && <BarcodeScanner onScan={onScan} onClose={closeScanner} />}

      {ticket && (
        <>
          <TicketReceipt ticket={ticket} />
          <p className="print:hidden mt-3 flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">
            <ShieldCheck className="w-3.5 h-3.5" /> Ticket details only — the owner&apos;s identity is never shown.
          </p>
        </>
      )}
    </div>
  );
}

export default function CheckTicketPage() {
  return (
    <Suspense>
      <CheckTicket />
    </Suspense>
  );
}
