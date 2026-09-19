"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Banknote, Clock, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePayoutFetch } from "./usePayout";
import { PAYOUT_METHODS } from "@/lib/payoutRouting";

/* The agent asking to be paid what they're owed. Nothing here moves money —
   an admin marking the request PAID is what writes the settlement. */

interface SettlementRequest {
  id: string;
  amount: number;
  method: string;
  account: string;
  accountName: string;
  status: string;
  adminNote: string | null;
  createdAt: string;
  paidAt: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "var(--gold)",
  PAID: "var(--green)",
  REJECTED: "var(--red)",
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
const FIELD =
  "w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]";

export function SettlementCard() {
  const payoutFetch = usePayoutFetch();
  const [outstanding, setOutstanding] = useState(0);
  const [requests, setRequests] = useState<SettlementRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>(PAYOUT_METHODS[0]);
  const [account, setAccount] = useState("");
  const [accountName, setAccountName] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await payoutFetch("/settlements");
      if (!res.ok) throw new Error();
      const d = await res.json();
      setOutstanding(d.outstanding);
      setRequests(d.requests);
    } catch {
      // Non-fatal: the queue is the agent's real job, this panel is secondary.
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = requests.find((r) => r.status === "PENDING");

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error("Enter an amount"); return; }
    if (!account.trim() || !accountName.trim()) { toast.error("Account number and name are required"); return; }

    setSaving(true);
    try {
      const res = await payoutFetch("/settlements", {
        method: "POST",
        body: JSON.stringify({
          amount: amt, method,
          account: account.trim(),
          accountName: accountName.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error ?? "Could not send the request"); return; }
      toast.success("Payout requested — the admin will settle it");
      setAmount(""); setAccount(""); setAccountName("");
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-[14px] font-bold text-[color:var(--text-primary)] flex items-center gap-2">
          <Banknote className="w-4 h-4 text-[color:var(--gold)]" /> Request a payout
        </h2>
        <span className="text-[12px] text-[color:var(--text-muted)]">
          owed <b className="text-[color:var(--gold)] tabular-nums">ETB {fmt(outstanding)}</b>
        </span>
      </div>

      {pending ? (
        <p className="text-[12px] text-[color:var(--text-secondary)] bg-[var(--bg-elevated)] border border-[color:var(--border-base)] rounded-xl px-3 py-2.5">
          <Clock className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5 text-[color:var(--gold)]" />
          ETB {fmt(pending.amount)} requested to {pending.method} · {pending.account}. Waiting for the
          admin to settle it — you can send another once this one is done.
        </p>
      ) : outstanding <= 0 ? (
        <p className="text-[12px] text-[color:var(--text-muted)]">
          Nothing is owed to you right now. Pay out some withdrawals and it builds up here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={amount} onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal" placeholder={`Amount (max ${fmt(outstanding)})`}
              className={FIELD}
            />
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(FIELD, "capitalize")}>
              {PAYOUT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <input
            value={account} onChange={(e) => setAccount(e.target.value)}
            placeholder="Account number" inputMode="numeric" className={FIELD}
          />
          <input
            value={accountName} onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account name" className={FIELD}
          />
          <button
            onClick={submit} disabled={saving}
            className="w-full h-10 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Request payout
          </button>
        </>
      )}

      {requests.length > 0 && (
        <div className="pt-3 border-t border-[color:var(--border-muted)] space-y-1.5">
          {requests.slice(0, 5).map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-[11px]">
              <span className="tabular-nums text-[color:var(--text-secondary)] font-semibold">ETB {fmt(r.amount)}</span>
              <span className="text-[color:var(--text-muted)] capitalize">{r.method}</span>
              <span className="font-semibold ml-auto inline-flex items-center gap-1" style={{ color: STATUS_COLOR[r.status] ?? "var(--text-muted)" }}>
                {r.status === "PAID" ? <Check className="w-3 h-3" /> : r.status === "REJECTED" ? <X className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                {r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
