"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, HandCoins, Check, X, Wallet } from "lucide-react";
import { usePayoutFetch } from "../usePayout";
import CashPayout from "./CashPayout";
import RecentDeposits from "./RecentDeposits";

/*
 * Counter deposit: look the customer up by account ID, read their name back to
 * them, then hand over the credit.
 *
 * The lookup is a deliberate step rather than a combined submit — the agent is
 * holding someone else's cash, and confirming the name out loud is the only
 * thing standing between a typo and crediting a stranger.
 */

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

export default function CashDepositPage() {
  const payoutFetch = usePayoutFetch();

  const [float, setFloat] = useState<number | null>(null);
  const [pendingCommission, setPendingCommission] = useState(0);
  const [accountNo, setAccountNo] = useState("");
  const [found, setFound] = useState<{ accountNo: number; name: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [looking, setLooking] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [done, setDone] = useState<{ name: string; amount: number } | null>(null);
  // Bumped after a deposit so the cancellable list picks the new one up.
  const [refreshKey, setRefreshKey] = useState(0);

  const loadFloat = useCallback(async () => {
    try {
      const res = await payoutFetch("/me");
      if (res.ok) {
        const d = await res.json();
        setFloat(d.float ?? 0);
        setPendingCommission(d.pendingCommission ?? 0);
      }
    } catch { /* the balance strip is informational; the API guards the spend */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadFloat(); }, [loadFloat]);

  async function lookup() {
    const n = accountNo.trim();
    if (!n) return;
    setLooking(true);
    setFound(null);
    setDone(null);
    try {
      const res = await payoutFetch(`/cash/lookup?accountNo=${encodeURIComponent(n)}`);
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Lookup failed"); return; }
      setFound(d);
    } catch {
      toast.error("Network error");
    } finally {
      setLooking(false);
    }
  }

  async function deposit() {
    if (!found) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter the amount you received");
      return;
    }
    if (float !== null && value > float) {
      toast.error(`Not enough float — you have ETB ${fmt(float)}`);
      return;
    }
    if (!confirm(`Credit ETB ${fmt(value)} to ${found.name} (${found.accountNo})?`)) return;

    setDepositing(true);
    try {
      const res = await payoutFetch("/cash/deposit", {
        method: "POST",
        body: JSON.stringify({ accountNo: found.accountNo, amount: value }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Deposit failed"); return; }
      setFloat(d.float);
      setDone({ name: d.name, amount: d.amount });
      setFound(null); setAccountNo(""); setAmount("");
      setRefreshKey((k) => k + 1);
    } catch {
      toast.error("Network error");
    } finally {
      setDepositing(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <HandCoins className="w-5 h-5 text-[color:var(--gold)]" />
        <h1 className="text-[18px] font-bold text-[color:var(--text-primary)]">Counter deposit</h1>
      </div>

      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 flex items-center gap-3">
        <Wallet className="w-4 h-4 text-[color:var(--text-muted)]" />
        <div className="flex-1">
          <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Your float</p>
          <p className="text-[18px] font-bold tabular-nums text-[color:var(--text-primary)]">
            {float === null ? "—" : `ETB ${fmt(float)}`}
          </p>
        </div>
        {pendingCommission > 0 && (
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Commission</p>
            <p className="text-[15px] font-bold tabular-nums text-[color:var(--gold)]">{fmt(pendingCommission)}</p>
            <p className="text-[10px] text-[color:var(--text-muted)]">added on the 1st</p>
          </div>
        )}
      </div>

      <CashPayout onPaid={(f) => setFloat(f)} />

      <RecentDeposits refreshKey={refreshKey} onReversed={(f) => setFloat(f)} />

      {done && (
        <div className="rounded-2xl border border-[#2BD97455] bg-[#2BD97412] p-4 flex items-start gap-3">
          <Check className="w-4 h-4 text-[color:var(--green)] mt-0.5 shrink-0" />
          <p className="text-[13px] text-[color:var(--text-primary)]">
            Credited <span className="font-bold tabular-nums">ETB {fmt(done.amount)}</span> to {done.name}.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
        <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Account ID</label>
        <div className="flex gap-2">
          <input
            value={accountNo}
            onChange={(e) => { setAccountNo(e.target.value); setFound(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
            inputMode="numeric"
            placeholder="e.g. 301966735"
            className="flex-1 h-11 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[15px] tabular-nums focus:outline-none focus:border-[color:var(--border-accent)]"
          />
          <button onClick={lookup} disabled={looking || !accountNo.trim()}
            className="h-11 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] font-semibold text-[13px] disabled:opacity-40 inline-flex items-center gap-1.5">
            {looking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Find
          </button>
        </div>

        {found && (
          <>
            <div className="rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-accent)] p-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-[color:var(--text-muted)]">Read this name back before taking the cash</p>
                <p className="text-[16px] font-bold text-[color:var(--text-primary)] truncate">{found.name}</p>
                <p className="text-[11px] text-[color:var(--text-muted)] tabular-nums">{found.accountNo}</p>
              </div>
              <button onClick={() => { setFound(null); setAmount(""); }}
                className="p-2 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" title="Clear">
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)]">Amount received (ETB)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full h-11 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[15px] tabular-nums focus:outline-none focus:border-[color:var(--border-accent)]"
            />

            <button onClick={deposit} disabled={depositing || !amount.trim()}
              className="w-full h-11 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[14px] disabled:opacity-40 inline-flex items-center justify-center gap-2">
              {depositing ? <Loader2 className="w-4 h-4 animate-spin" /> : <HandCoins className="w-4 h-4" />}
              Deposit
            </button>
          </>
        )}
      </div>

      <p className="text-[11px] text-[color:var(--text-muted)] leading-relaxed">
        The amount comes out of your float and lands in the customer&apos;s account straight away.
        Only enter it once the cash is in your hand — a deposit cannot be undone from here.
      </p>
    </div>
  );
}
