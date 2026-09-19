"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Copy, Check, Store } from "lucide-react";
import { useAdminFetch } from "../useAdmin";

/*
 * In-person betting agents — retail cashiers who place sportsbook bets for
 * walk-in customers against printed tickets. They're normal User rows with
 * role IN_PERSON_AGENT; created here, credentials shown once.
 */

interface AgentRow {
  id: string;
  username: string;
  name: string | null;
  phone: string;
  isActive: boolean;
  commissionRate: number;
  balance: number;
  commissionEarned: number;
  pendingWithdrawal: number;
  tickets: number;
  staked: number;
  won: number;
  paid: number;
  createdAt: string;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function InPersonAgentsPage() {
  const adminFetch = useAdminFetch();
  const router = useRouter();

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [rate, setRate] = useState("3");

  // One-shot credentials reveal after create
  const [created, setCreated] = useState<{ username: string; password: string; phone: string } | null>(null);

  const load = useCallback(async () => {
    const res = await adminFetch("/in-person-agents");
    if (res.ok) {
      const d = await res.json();
      setAgents(d.agents ?? []);
    }
    setLoading(false);
  }, [adminFetch]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setCreating(true);
    const res = await adminFetch("/in-person-agents", {
      method: "POST",
      body: JSON.stringify({ name, phone, commissionRate: Number(rate) }),
    });
    setCreating(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Could not create agent");
      return;
    }
    const d = await res.json();
    setCreated({ username: d.agent.username, password: d.password, phone: d.agent.phone });
    setShowForm(false); setName(""); setPhone(""); setRate("3");
    load();
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-lg font-extrabold text-[color:var(--text-primary)]">In-Person Agents</h1>
        <button onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--gold)] text-black text-[13px] font-bold">
          <Plus className="w-4 h-4" /> New agent
        </button>
      </div>

      {created && (
        <div className="mb-4 bg-emerald-950/40 border border-emerald-700/50 rounded-2xl p-4">
          <p className="text-[13px] font-bold text-emerald-400 mb-2">Agent created — hand these over, they won't be shown again</p>
          <div className="font-mono text-[13px] text-[color:var(--text-primary)] space-y-1">
            <p>Phone (login): {created.phone}</p>
            <p>Username: {created.username}</p>
            <p>Password: {created.password}</p>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`phone: ${created.phone}\npassword: ${created.password}`);
              setCopied(true); setTimeout(() => setCopied(false), 1500);
            }}
            className="mt-2 flex items-center gap-1.5 text-[12px] text-emerald-400">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy credentials
          </button>
        </div>
      )}

      {showForm && (
        <div className="mb-4 bg-[var(--bg-surface)] border border-[color:var(--border-muted)] rounded-2xl p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] text-[color:var(--text-muted)] block mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] w-44" />
          </div>
          <div>
            <label className="text-[11px] text-[color:var(--text-muted)] block mb-1">Phone (login)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09…"
              className="px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] w-40" />
          </div>
          <div>
            <label className="text-[11px] text-[color:var(--text-muted)] block mb-1">Commission %</label>
            <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" min="0" max="100" step="0.5"
              className="px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-muted)] text-[13px] w-24" />
          </div>
          <button onClick={create} disabled={creating || name.trim().length < 2 || phone.trim().length < 7}
            className="px-4 py-2 rounded-lg bg-[var(--gold)] text-black text-[13px] font-bold disabled:opacity-40">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>
      ) : agents.length === 0 ? (
        <div className="text-center py-16 text-[color:var(--text-muted)]">
          <Store className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-[13px]">No in-person agents yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => (
            <button key={a.id} onClick={() => router.push(`in-person-agents/${a.id}`)}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[color:var(--border-muted)] hover:border-[color:var(--border-accent)] transition-colors text-left">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-[color:var(--text-primary)]">
                  {a.name ?? a.username}
                  {!a.isActive && <span className="ml-2 text-[10px] text-[color:var(--red)] uppercase">disabled</span>}
                </p>
                <p className="text-[11px] text-[color:var(--text-muted)]">{a.phone} · {a.commissionRate}% · {a.tickets} tickets · {fmt(a.staked)} staked</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] font-bold text-[color:var(--text-primary)]">{fmt(a.balance)} ETB</p>
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  commission {fmt(a.commissionEarned)}
                  {a.pendingWithdrawal > 0 && ` · pending ${fmt(a.pendingWithdrawal)}`}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
