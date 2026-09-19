"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePayoutFetch } from "../usePayout";
import { SlaBadge, type PayoutRequest } from "../page";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
const fmtDate = (s: string) => new Date(s).toLocaleString();

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "var(--green)",
  REJECTED: "var(--red)",
  CANCELLED: "var(--text-muted)",
};

export default function PayoutHistoryPage() {
  const payoutFetch = usePayoutFetch();
  const [rows, setRows] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    payoutFetch("/queue?view=history")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setRows(d.requests); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">History</h1>
        <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">Your last 50 completed payouts.</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-[13px] text-[color:var(--text-muted)] py-12">Nothing yet.</p>
      ) : (
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] divide-y divide-[color:var(--border-muted)] overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] font-bold text-[color:var(--gold)]">{r.publicId}</span>
                  <SlaBadge sla={r.sla} />
                </div>
                <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
                  {r.method} · {r.account} · @{r.username}
                </p>
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  {fmtDate(r.paidAt ?? r.createdAt)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-[14px] tabular-nums text-[color:var(--text-primary)]">ETB {fmt(r.amount)}</p>
                <p className="text-[11px] font-semibold" style={{ color: STATUS_COLOR[r.status] ?? "var(--text-muted)" }}>
                  {r.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
