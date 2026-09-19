"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, Banknote, Check, X } from "lucide-react";
import { usePayoutFetch } from "../usePayout";

interface Found {
  id: string;
  code: string;
  amount: number;
  name: string;
  accountNo: number;
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

/**
 * Pay a withdrawal code out in cash.
 *
 * Two steps on purpose: the agent sees the amount and the name, hands the notes
 * over, and only then confirms. Confirming is what kills the code, so the order
 * matters — a code consumed before the cash is counted cannot be un-consumed.
 */
export default function CashPayout({ onPaid }: { onPaid: (float: number) => void }) {
  const payoutFetch = usePayoutFetch();

  const [code, setCode] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [looking, setLooking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<{ name: string; amount: number } | null>(null);

  async function lookup() {
    if (!code.trim()) return;
    setLooking(true);
    setFound(null);
    setDone(null);
    try {
      const res = await payoutFetch(`/cash/code?code=${encodeURIComponent(code.trim())}`);
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Lookup failed"); return; }
      setFound(d);
    } catch {
      toast.error("Network error");
    } finally {
      setLooking(false);
    }
  }

  async function pay() {
    if (!found) return;
    if (!confirm(`Confirm you have handed ETB ${fmt(found.amount)} to ${found.name}. This cannot be undone.`)) return;

    setPaying(true);
    try {
      const res = await payoutFetch("/cash/code", {
        method: "POST",
        body: JSON.stringify({ code: found.code }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Payout failed"); return; }
      onPaid(d.float);
      setDone({ name: d.name, amount: d.amount });
      setFound(null); setCode("");
    } catch {
      toast.error("Network error");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Banknote className="w-4 h-4 text-[color:var(--gold)]" />
        <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">Pay a withdrawal code</h2>
      </div>

      {done && (
        <div className="rounded-xl border border-[#2BD97455] bg-[#2BD97412] p-3 flex items-start gap-2">
          <Check className="w-4 h-4 text-[color:var(--green)] mt-0.5 shrink-0" />
          <p className="text-[13px] text-[color:var(--text-primary)]">
            Paid <span className="font-bold tabular-nums">ETB {fmt(done.amount)}</span> to {done.name}.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setFound(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
          placeholder="W-3F9K2A"
          autoCapitalize="characters"
          className="flex-1 h-11 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[15px] font-mono tracking-wide focus:outline-none focus:border-[color:var(--border-accent)]"
        />
        <button onClick={lookup} disabled={looking || !code.trim()}
          className="h-11 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] font-semibold text-[13px] disabled:opacity-40 inline-flex items-center gap-1.5">
          {looking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Check
        </button>
      </div>

      {found && (
        <>
          <div className="rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-accent)] p-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[22px] font-extrabold tabular-nums text-[color:var(--gold)]">ETB {fmt(found.amount)}</p>
              <p className="text-[14px] font-semibold text-[color:var(--text-primary)] truncate">{found.name}</p>
              <p className="text-[11px] text-[color:var(--text-muted)] tabular-nums">{found.accountNo} · {found.code}</p>
            </div>
            <button onClick={() => setFound(null)}
              className="p-2 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" title="Clear">
              <X className="w-4 h-4" />
            </button>
          </div>

          <button onClick={pay} disabled={paying}
            className="w-full h-11 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[14px] disabled:opacity-40 inline-flex items-center justify-center gap-2">
            {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            I have paid the cash
          </button>
          <p className="text-[11px] text-[color:var(--text-muted)]">
            Hand the cash over first. Confirming here uses the code up and adds the amount to your float.
          </p>
        </>
      )}
    </div>
  );
}
