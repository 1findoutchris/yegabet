"use client";

import { Loader2 } from "lucide-react";
import { useSpin } from "../shared";

/* Physical wins tab — read-only. Nothing is credited automatically here, so
   this list is the only prompt to actually hand the item over. */

export default function SpinWinsPage() {
  const { wins, loading, error } = useSpin();

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{error}</p>}

      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
        <h2 className="text-[15px] font-bold text-[color:var(--text-primary)] mb-1">Physical prize wins</h2>
        <p className="text-[12px] text-[color:var(--text-muted)] mb-3">
          Physical prizes are not credited automatically — contact the winner and hand over the item.
        </p>
        {wins.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-muted)] py-6 text-center">No physical wins yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] text-left">
                  <th className="pb-2 pr-3">When</th>
                  <th className="pb-2 pr-3">Prize</th>
                  <th className="pb-2 pr-3">Player</th>
                  <th className="pb-2 pr-3">Account ID</th>
                  <th className="pb-2">Phone</th>
                </tr>
              </thead>
              <tbody>
                {wins.map((wn) => (
                  <tr key={wn.id} className="border-t border-[color:var(--border-muted)]">
                    <td className="py-2 pr-3 text-[color:var(--text-muted)]">{new Date(wn.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-semibold text-[color:var(--text-primary)]">{wn.label}</td>
                    <td className="py-2 pr-3">{wn.username}</td>
                    <td className="py-2 pr-3 tabular-nums text-[color:var(--text-secondary)]">{wn.accountNo ?? "—"}</td>
                    <td className="py-2 font-mono">{wn.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
