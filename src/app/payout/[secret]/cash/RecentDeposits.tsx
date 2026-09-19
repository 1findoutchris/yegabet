"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Undo2, History } from "lucide-react";
import { usePayoutFetch } from "../usePayout";

interface Row {
  id: string;
  amount: number;
  name: string;
  accountNo: number;
  createdAt: string;
  status: string;
  reversible: boolean;
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

/**
 * Recent counter deposits, each cancellable until its window closes.
 *
 * The countdown is drawn from a ticking clock rather than the server's
 * `reversible` flag alone, so a button doesn't sit there looking live for
 * minutes after it stopped working. The server re-checks regardless.
 */
export default function RecentDeposits({ refreshKey, onReversed }: {
  refreshKey: number;
  onReversed: (float: number) => void;
}) {
  const payoutFetch = usePayoutFetch();
  const [rows, setRows] = useState<Row[]>([]);
  const [windowMs, setWindowMs] = useState(10 * 60 * 1000);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await payoutFetch("/cash/recent");
      if (!res.ok) return;
      const d = await res.json();
      setRows(d.deposits);
      setWindowMs(d.windowMs);
    } catch { /* the list is a convenience; the deposit itself already happened */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Only tick while something is still cancellable.
  const anyLive = rows.some((r) => r.status === "APPROVED");
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyLive]);

  async function reverse(row: Row) {
    if (!confirm(`Cancel the ETB ${fmt(row.amount)} deposit to ${row.name}? Give the cash back to the customer.`)) return;
    setBusy(row.id);
    try {
      const res = await payoutFetch("/cash/reverse", {
        method: "POST",
        body: JSON.stringify({ depositId: row.id }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Could not cancel"); await load(); return; }
      toast.success(`Cancelled — ETB ${fmt(d.amount)} back on your float`);
      onReversed(d.float);
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[color:var(--border-muted)] flex items-center gap-2">
        <History className="w-4 h-4 text-[color:var(--text-muted)]" />
        <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">Recent deposits</h2>
      </div>
      <div className="divide-y divide-[color:var(--border-muted)]">
        {rows.map((r) => {
          const left = windowMs - (now - new Date(r.createdAt).getTime());
          const canCancel = r.status === "APPROVED" && left > 0;
          const secs = Math.max(0, Math.ceil(left / 1000));
          return (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[color:var(--text-primary)] truncate">
                  {r.name}
                  {r.status === "REVERSED" && (
                    <span className="ml-2 text-[10px] font-bold text-[color:var(--red)]">CANCELLED</span>
                  )}
                </p>
                <p className="text-[11px] text-[color:var(--text-muted)] tabular-nums">{r.accountNo}</p>
              </div>
              <p className="text-[13px] font-bold tabular-nums text-[color:var(--text-primary)] shrink-0">
                ETB {fmt(r.amount)}
              </p>
              {canCancel && (
                <button onClick={() => reverse(r)} disabled={busy === r.id}
                  className="shrink-0 h-8 px-2.5 rounded-lg bg-[#FF3B5C18] border border-[#FF3B5C44] text-[color:var(--red)] text-[11px] font-bold disabled:opacity-40 inline-flex items-center gap-1">
                  {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                  {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-4 py-2.5 text-[11px] text-[color:var(--text-muted)] border-t border-[color:var(--border-muted)]">
        A deposit can be cancelled for {Math.round(windowMs / 60000)} minutes, and only while the player
        has not played with the money. Every cancellation is recorded.
      </p>
    </div>
  );
}
