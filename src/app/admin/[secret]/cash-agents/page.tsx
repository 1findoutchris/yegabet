"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Plus, Copy, Check, ShieldOff, ShieldCheck, Wallet, HandCoins,
} from "lucide-react";
import { useAdminFetch } from "../useAdmin";

/*
 * The cash rail's own screen.
 *
 * Cash agents are WithdrawalAgent rows with `isCashAgent` set, so this reads the
 * same endpoint as Payout Agents and filters — one list, one source of truth,
 * two views of it. What differs is what's on screen: float and commission
 * matter here, SLA and queue depth do not.
 */

interface CashAgent {
  id: string;
  username: string;
  name: string | null;
  isActive: boolean;
  isCashAgent: boolean;
  commissionRate: number;
  float: number;
  pendingCommission: number;
  cashIn: number;
  cashOut: number;
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

export default function CashAgentsPage() {
  const adminFetch = useAdminFetch();
  const { secret } = useParams<{ secret: string }>();
  const router = useRouter();

  const [agents, setAgents] = useState<CashAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [commissionRate, setCommissionRate] = useState("3");
  const [openingFloat, setOpeningFloat] = useState("");

  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [topupFor, setTopupFor] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch("/payout-agents");
      if (!res.ok) throw new Error();
      const all: CashAgent[] = (await res.json()).agents;
      setAgents(all.filter((a) => a.isCashAgent));
    } catch {
      toast.error("Failed to load cash agents");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim()) { toast.error("Give the agent a name"); return; }
    const opening = openingFloat.trim() ? Number(openingFloat) : 0;
    if (openingFloat.trim() && (!Number.isFinite(opening) || opening <= 0)) {
      toast.error("Opening float must be a positive amount, or blank");
      return;
    }

    setCreating(true);
    try {
      const res = await adminFetch("/payout-agents", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          // A pure cash agent handles no payout rail, so they are never routed a
          // telebirr/CBE withdrawal. Tick them as a payout agent too from the
          // Payout Agents screen if they should do both.
          methods: ["cash"],
          commissionRate: Number(commissionRate),
          isCashAgent: true,
          slaMinutes: 30,
        }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Could not create agent"); return; }

      // Opening float is a convenience — the same TOPUP row the wallet button
      // writes, just done at creation so the agent can start immediately.
      if (opening > 0) {
        const t = await adminFetch(`/payout-agents/${d.id}`, {
          method: "POST",
          body: JSON.stringify({ action: "topup", amount: opening, note: "Opening float" }),
        });
        if (!t.ok) toast.error("Agent created, but the opening float failed — top up manually");
      }

      setIssued({ username: d.username, password: d.password });
      setShowForm(false);
      setName(""); setOpeningFloat("");
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function topup(a: CashAgent) {
    const amount = Number(topupAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("Enter an amount — negative takes float back");
      return;
    }
    if (!confirm(
      amount > 0
        ? `Give ${a.name || a.username} ETB ${fmt(amount)} of float? Only once their cash is in hand.`
        : `Take ETB ${fmt(-amount)} of float back from ${a.name || a.username}?`
    )) return;

    setBusy(true);
    try {
      const res = await adminFetch(`/payout-agents/${a.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "topup", amount }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Top-up failed"); return; }
      toast.success(`Float now ETB ${fmt(d.float)}`);
      setTopupFor(null); setTopupAmount("");
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: CashAgent) {
    const action = a.isActive ? "deactivate" : "activate";
    if (a.isActive && !confirm(
      `Deactivate ${a.name || a.username}? They stop taking deposits, and any player bound to them is freed to use another counter.`
    )) return;

    setBusy(true);
    try {
      const res = await adminFetch(`/payout-agents/${a.id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      if (!res.ok) { toast.error("Could not update agent"); return; }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const totalFloat = agents.reduce((s, a) => s + a.float, 0);
  const totalDue = agents.reduce((s, a) => s + a.pendingCommission, 0);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <HandCoins className="w-5 h-5 text-[color:var(--gold)]" />
        <div className="flex-1">
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">Cash Agents</h1>
          <p className="text-[12px] text-[color:var(--text-muted)]">Counter deposits and cash payouts</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)}
          className="h-10 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> New agent
        </button>
      </div>

      {agents.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4">
            <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">Float in the field</p>
            <p className="font-display text-[20px] font-extrabold tabular-nums text-[color:var(--green)] mt-0.5">ETB {fmt(totalFloat)}</p>
          </div>
          <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4">
            <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">Commission due on the 1st</p>
            <p className="font-display text-[20px] font-extrabold tabular-nums text-[color:var(--gold)] mt-0.5">ETB {fmt(totalDue)}</p>
          </div>
        </div>
      )}

      {issued && (
        <div className="rounded-2xl border border-[color:var(--border-accent)] bg-[var(--bg-accent-dim)] p-4 space-y-2">
          <p className="text-[13px] font-bold text-[color:var(--text-primary)]">
            Give these to the agent now — the password is not shown again.
          </p>
          <div className="flex items-center gap-2 font-mono text-[13px] text-[color:var(--text-primary)]">
            <span>{issued.username}</span>
            <span className="text-[color:var(--text-muted)]">/</span>
            <span>{issued.password}</span>
            <button onClick={() => {
              navigator.clipboard.writeText(`${issued.username} / ${issued.password}`);
              setCopied(true); setTimeout(() => setCopied(false), 1500);
            }} className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
              {copied ? <Check className="w-3.5 h-3.5 text-[color:var(--green)]" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button onClick={() => setIssued(null)} className="text-[12px] text-[color:var(--text-muted)] underline">Done</button>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Agent name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Commission %</label>
              <input value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} inputMode="decimal"
                className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Opening float (ETB)</label>
              <input value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} inputMode="decimal"
                placeholder="Optional"
                className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
            </div>
          </div>
          <p className="text-[11px] text-[color:var(--text-muted)]">
            Only add opening float once the agent has actually paid it in. They can never credit
            players beyond it.
          </p>
          <button onClick={create} disabled={creating}
            className="w-full h-10 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-40">
            {creating && <Loader2 className="w-4 h-4 animate-spin" />} Create cash agent
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-[color:var(--gold)]" /></div>
      ) : agents.length === 0 ? (
        <p className="text-center text-[13px] text-[color:var(--text-muted)] py-12">
          No cash agents yet. Add one to start taking counter deposits.
        </p>
      ) : (
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] divide-y divide-[color:var(--border-muted)] overflow-hidden">
          {agents.map((a) => (
            <div key={a.id} className="px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => router.push(`/admin/${secret}/payout-agents/${a.id}`)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-[13px] text-[color:var(--text-primary)]">{a.name || a.username}</p>
                    {!a.isActive && <span className="text-[10px] font-bold text-[color:var(--red)]">DISABLED</span>}
                  </div>
                  <p className="text-[11px] text-[color:var(--text-muted)] font-mono">{a.username} · {a.commissionRate}%</p>
                  <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 tabular-nums">
                    in {fmt(a.cashIn)} · out {fmt(a.cashOut)}
                  </p>
                </button>

                <div className="flex items-center gap-4 text-right shrink-0">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">Float</p>
                    <p className="text-[14px] font-bold tabular-nums"
                      style={{ color: a.float > 0 ? "var(--green)" : "var(--text-muted)" }}>{fmt(a.float)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">Commission</p>
                    <p className="text-[14px] font-bold tabular-nums text-[color:var(--gold)]">{fmt(a.pendingCommission)}</p>
                  </div>
                  <button onClick={() => { setTopupFor(topupFor === a.id ? null : a.id); setTopupAmount(""); }}
                    className="p-2 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--gold)]" title="Top up float">
                    <Wallet className="w-4 h-4" />
                  </button>
                  <button onClick={() => toggleActive(a)} disabled={busy}
                    className="p-2 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] disabled:opacity-40"
                    title={a.isActive ? "Deactivate" : "Activate"}>
                    {a.isActive ? <ShieldCheck className="w-4 h-4 text-[color:var(--green)]" /> : <ShieldOff className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {topupFor === a.id && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[color:var(--border-muted)]">
                  <input value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} inputMode="decimal"
                    placeholder="Amount — negative takes float back"
                    className="flex-1 h-9 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
                  <button onClick={() => topup(a)} disabled={busy}
                    className="h-9 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[12px] disabled:opacity-40 inline-flex items-center gap-1.5">
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Apply
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
