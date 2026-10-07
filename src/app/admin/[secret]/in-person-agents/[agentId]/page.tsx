"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldOff, ShieldCheck, Save, Receipt, Trash2 } from "lucide-react";
import { useAdminFetch } from "../../useAdmin";

/*
 * In-person agent detail — profile, commission control, their ticket history
 * (the bets they placed for customers) and recent wallet transactions.
 */

interface TicketRow {
  id: string;
  publicId: string;
  status: string;
  totalStake: string;
  totalWin: string;
  createdAt: string;
  paidAt: string | null;
  proofKey: string | null;
  bets: { betAmount: string; winAmount: string; settled: boolean }[];
}

interface TxnRow {
  id: string;
  type: string;
  status: string;
  amount: string;
  balanceAfter: string;
  reference: string;
  createdAt: string;
}

interface Detail {
  agent: {
    id: string; username: string; name: string | null; phone: string;
    isActive: boolean; commissionRate: number; balance: number;
    depositBalance: number; bonusBalance: number;
    commissionEarned: number; createdAt: string;
  };
  tickets: TicketRow[];
  transactions: TxnRow[];
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function InPersonAgentDetailPage() {
  const adminFetch = useAdminFetch();
  const { agentId, secret } = useParams<{ agentId: string; secret: string }>();
  const router = useRouter();

  const [data, setData] = useState<Detail | null>(null);
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch(`/in-person-agents/${agentId}`);
    if (res.ok) {
      const d = await res.json();
      setData(d);
      setRate(String(d.agent.commissionRate));
    }
  }, [adminFetch, agentId]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: object) {
    setSaving(true);
    const res = await adminFetch(`/in-person-agents/${agentId}`, { method: "PATCH", body: JSON.stringify(body) });
    setSaving(false);
    if (!res.ok) { toast.error("Update failed"); return; }
    toast.success("Saved");
    load();
  }
  /** Same delete as the Users page. Refused while money is on the account or
   *  a ticket is still in play / won but unpaid; the toast says which. */
  async function remove() {
    if (!data) return;
    const { username } = data.agent;
    const typed = prompt(
      `Permanently delete in-person agent @${username}, their tickets and history?\n\nType the username to confirm:`
    );
    if (typed?.trim() !== username) {
      if (typed !== null) toast.error("Username didn't match — nothing deleted");
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch(`/users/${agentId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error ?? "Delete failed"); return; }
      toast.success(`@${username} deleted`);
      router.push(`/admin/${secret}/in-person-agents`);
    } finally {
      setSaving(false);
    }
  }

  // Receipts need the x-admin-secret header, so fetch as blob and open an
  // object URL — a plain <a href> wouldn't carry the header.
  async function openReceipt(ticketId: string) {
    const res = await adminFetch(`/tickets/${ticketId}/receipt`);
    if (!res.ok) { toast.error("Receipt not found"); return; }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
  }

  
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;

  const { agent, tickets, transactions } = data;
  const totalStaked = tickets.reduce((s, t) => s + Number(t.totalStake), 0);
  const totalWon = tickets.reduce((s, t) => s + Number(t.totalWin), 0);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header + controls */}
      <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-lg font-extrabold text-[color:var(--text-primary)]">
              {agent.name ?? agent.username}
            </h1>
            <p className="text-[12px] text-[color:var(--text-muted)]">{agent.phone} · @{agent.username}</p>
          </div>
          <div className="flex items-center gap-2">
            <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" min="0" max="100" step="0.5"
              className="px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] w-20" />
            <span className="text-[11px] text-[color:var(--text-muted)]">% comm.</span>
            <button onClick={() => patch({ commissionRate: Number(rate) })} disabled={saving}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[var(--gold)] text-black text-[12px] font-bold disabled:opacity-40">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
            <button onClick={() => patch({ isActive: !agent.isActive })} disabled={saving}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg text-[12px] font-bold ${
                agent.isActive ? "bg-red-950/40 text-[color:var(--red)]" : "bg-emerald-950/40 text-emerald-400"
              }`}>
              {agent.isActive ? <><ShieldOff className="w-3.5 h-3.5" /> Disable</> : <><ShieldCheck className="w-3.5 h-3.5" /> Enable</>}
            </button>
            <button onClick={remove} disabled={saving}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-[#FF3B5C] text-white text-[12px] font-bold disabled:opacity-40">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {[
            ["Balance", agent.balance],
            ["Commission earned", agent.commissionEarned],
            ["Total staked", totalStaked],
            ["Total won (tickets)", totalWon],
          ].map(([label, v]) => (
            <div key={label as string} className="bg-[var(--bg-elevated)] rounded-xl p-3">
              <p className="text-[10px] text-[color:var(--text-muted)]">{label}</p>
              <p className="text-[15px] font-bold text-[color:var(--text-primary)]">{fmt(v as number)} ETB</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tickets */}
      <div>
        <h2 className="text-[13px] font-bold text-[color:var(--text-primary)] mb-2">Tickets ({tickets.length})</h2>
        <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl divide-y divide-[color:var(--border-muted)]">
          {tickets.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-[color:var(--text-muted)]">No tickets yet</p>}
          {tickets.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 text-[12px]">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-[color:var(--text-primary)]">{t.publicId}</p>
                <p className="text-[color:var(--text-muted)]">{t.bets.length} bet{t.bets.length === 1 ? "" : "s"} · {new Date(t.createdAt).toLocaleString()}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-[color:var(--text-primary)]">{fmt(Number(t.totalStake))} ETB</p>
                {Number(t.totalWin) > 0 && <p className="text-emerald-400">won {fmt(Number(t.totalWin))}</p>}
              </div>
              {t.proofKey && (
                <button onClick={() => openReceipt(t.id)}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[11px] text-[color:var(--text-secondary)] hover:text-[color:var(--gold)]">
                  <Receipt className="w-3.5 h-3.5" /> Receipt
                </button>
              )}
              <span className="text-[10px] font-bold uppercase text-[color:var(--text-muted)] w-16 text-right">{t.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Transactions */}
      <div>
        <h2 className="text-[13px] font-bold text-[color:var(--text-primary)] mb-2">Recent transactions</h2>
        <div className="bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl divide-y divide-[color:var(--border-muted)]">
          {transactions.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-[color:var(--text-muted)]">No transactions yet</p>}
          {transactions.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-[12px]">
              <span className={`font-bold w-20 ${t.type === "WIN" || t.type === "COMMISSION" || t.type === "DEPOSIT" ? "text-emerald-400" : "text-[color:var(--text-secondary)]"}`}>
                {t.type}
              </span>
              <span className="flex-1 font-mono text-[color:var(--text-muted)] truncate">{t.reference.slice(0, 18)}</span>
              <span className="text-[color:var(--text-primary)] font-semibold">{fmt(Number(t.amount))} ETB</span>
              <span className="text-[color:var(--text-muted)]">{new Date(t.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
