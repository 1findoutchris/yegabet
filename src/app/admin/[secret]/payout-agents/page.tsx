"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, ArrowUpRight, Copy, Check, ShieldOff, ShieldCheck, Wallet } from "lucide-react";
import { useAdminFetch } from "../useAdmin";
import { PAYOUT_METHODS } from "@/lib/payoutRouting";

interface PayoutAgent {
  id: string;
  username: string;
  name: string | null;
  isActive: boolean;
  methods: string[];
  commissionRate: number;
  isCashAgent: boolean;
  slaMinutes: number;
  maxWithdrawalEtb: number | null;
  openRequests: number;
  paidOut: number;
  commission: number;
  outstanding: number;
  float: number;
}

// Methods a payout agent can be assigned. Shared with the agent portal's own
// payout-request form so the two lists can't drift.
const METHOD_OPTIONS = PAYOUT_METHODS;

interface SettlementRequest {
  id: string;
  amount: number;
  method: string;
  account: string;
  accountName: string;
  agentId: string;
  agentName: string;
  agentOutstanding: number;
  createdAt: string;
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

export default function PayoutAgentsPage() {
  const adminFetch = useAdminFetch();
  const { secret } = useParams<{ secret: string }>();
  const router = useRouter();

  const [agents, setAgents] = useState<PayoutAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [settlements, setSettlements] = useState<SettlementRequest[]>([]);
  const [settling, setSettling] = useState<string | null>(null);

  // Form
  const [name, setName] = useState("");
  const [methods, setMethods] = useState<string[]>([]);
  const [commissionRate, setCommissionRate] = useState("3");
  const [slaMinutes, setSlaMinutes] = useState("30");
  const [maxWithdrawal, setMaxWithdrawal] = useState("");
  const [isCashAgent, setIsCashAgent] = useState(false);

  // Float top-up, keyed by agent id so only the open row has an input.
  const [topupFor, setTopupFor] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [toppingUp, setToppingUp] = useState(false);

  // Credentials are returned exactly once, at creation.
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, sRes] = await Promise.all([
        adminFetch("/payout-agents"),
        adminFetch("/payout-agents/settlements"),
      ]);
      if (!res.ok) throw new Error();
      setAgents((await res.json()).agents);
      if (sRes.ok) setSettlements((await sRes.json()).requests);
    } catch {
      toast.error("Failed to load payout agents");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim() || methods.length === 0) {
      toast.error("Name and at least one method are required");
      return;
    }
    // Blank means no ceiling — the field is omitted rather than sent as 0,
    // which the API would reject as a cap nobody could ever satisfy.
    const cap = maxWithdrawal.trim() ? Number(maxWithdrawal) : undefined;
    if (cap !== undefined && (!Number.isFinite(cap) || cap <= 0)) {
      toast.error("Max withdrawal must be a positive amount, or blank for no limit");
      return;
    }

    setCreating(true);
    try {
      const res = await adminFetch("/payout-agents", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          methods,
          commissionRate: Number(commissionRate),
          isCashAgent,
          slaMinutes: Number(slaMinutes),
          ...(cap !== undefined ? { maxWithdrawalEtb: cap } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? "Could not create agent"); return; }
      setIssued({ username: d.username, password: d.password });
      setShowForm(false);
      setName(""); setMethods([]); setMaxWithdrawal(""); setIsCashAgent(false);
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  }

  async function topup(a: PayoutAgent) {
    const amount = Number(topupAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error("Enter an amount — negative takes float back");
      return;
    }
    if (!confirm(
      amount > 0
        ? `Give ${a.name || a.username} ETB ${fmt(amount)} of float? Only do this once their cash is in hand.`
        : `Take ETB ${fmt(-amount)} of float back from ${a.name || a.username}?`
    )) return;

    setToppingUp(true);
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
      setToppingUp(false);
    }
  }

  async function settle(id: string, action: "pay" | "reject") {
    if (settling) return;
    if (!confirm(action === "pay"
      ? "Mark this payout as sent? It clears that amount from what the agent is owed."
      : "Reject this payout request?")) return;
    setSettling(id);
    try {
      const res = await adminFetch("/payout-agents/settlements", {
        method: "POST",
        body: JSON.stringify({ id, action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error ?? "Action failed"); return; }
      toast.success(action === "pay" ? `Settled ETB ${fmt(d.settled)}` : "Request rejected");
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setSettling(null);
    }
  }

  async function toggleActive(a: PayoutAgent) {
    const res = await adminFetch(`/payout-agents/${a.id}`, {
      method: "POST",
      body: JSON.stringify({ action: a.isActive ? "deactivate" : "activate" }),
    });
    if (!res.ok) { toast.error("Action failed"); return; }
    toast.success(a.isActive ? "Agent deactivated" : "Agent activated");
    load();
  }

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)] flex items-center gap-2">
            <ArrowUpRight className="w-5 h-5 text-[color:var(--gold)]" /> Payout agents
          </h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            They settle player withdrawals on the automatic rail. Requests route automatically to whoever
            handles the method and has the least open work.
          </p>
        </div>
        <button onClick={() => setShowForm((v) => !v)}
          className="h-10 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] inline-flex items-center gap-1.5 shrink-0">
          <Plus className="w-4 h-4" /> New agent
        </button>
      </div>

      {/* Credentials — shown once, never recoverable */}
      {issued && (
        <div className="rounded-2xl border border-[color:var(--green)]/40 bg-[var(--green)]/10 p-4">
          <p className="text-[13px] font-bold text-[color:var(--text-primary)]">Agent created — copy these now</p>
          <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 mb-3">
            The password is shown only this once. If it&apos;s lost, reset it from the agent&apos;s page.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[13px] font-mono text-[color:var(--text-primary)]">
              {issued.username}
            </code>
            <code className="px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[13px] font-mono text-[color:var(--text-primary)]">
              {issued.password}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`Username: ${issued.username}\nPassword: ${issued.password}`);
                setCopied(true); setTimeout(() => setCopied(false), 1800);
              }}
              className="h-9 px-3 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[12px] font-semibold inline-flex items-center gap-1.5 text-[color:var(--text-secondary)]"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[color:var(--green)]" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setIssued(null)} className="text-[12px] text-[color:var(--text-muted)] underline ml-auto">
              Done
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
          <p className="text-[14px] font-bold text-[color:var(--text-primary)]">New payout agent</p>
          <p className="text-[11px] text-[color:var(--text-muted)]">Username and password are generated automatically.</p>

          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name"
            className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />

          <div>
            <p className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">
              Methods they process (one or more)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {METHOD_OPTIONS.map((m) => {
                const on = methods.includes(m);
                return (
                  <button key={m}
                    onClick={() => setMethods((p) => on ? p.filter((x) => x !== m) : [...p, m])}
                    className={`h-9 px-3 rounded-lg text-[12px] font-semibold border capitalize transition-colors ${
                      on
                        ? "bg-[var(--bg-accent-dim)] border-[color:var(--border-accent)] text-[color:var(--gold)]"
                        : "bg-[var(--bg-elevated)] border-[color:var(--border-base)] text-[color:var(--text-muted)]"
                    }`}>
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Commission %</label>
              <input value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} inputMode="decimal"
                className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">SLA (minutes)</label>
              <input value={slaMinutes} onChange={(e) => setSlaMinutes(e.target.value)} inputMode="numeric"
                className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">Max withdrawal (ETB)</label>
            <input value={maxWithdrawal} onChange={(e) => setMaxWithdrawal(e.target.value)} inputMode="decimal"
              placeholder="Leave blank for no limit"
              className="w-full h-10 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
            <p className="text-[11px] text-[color:var(--text-muted)] mt-1.5">
              Anything above this routes to another agent instead. The agent never sees this figure.
            </p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={isCashAgent} onChange={(e) => setIsCashAgent(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[color:var(--gold)] shrink-0" />
            <span>
              <span className="block text-[13px] font-semibold text-[color:var(--text-primary)]">Cash agent</span>
              <span className="block text-[11px] text-[color:var(--text-muted)]">
                Takes cash over the counter and credits players from a prepaid float you top up.
                Separate balance from what the payout rail owes them.
              </span>
            </span>
          </label>

          <button onClick={create} disabled={creating}
            className="w-full h-10 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-40">
            {creating && <Loader2 className="w-4 h-4 animate-spin" />} Create agent
          </button>
        </div>
      )}

      {/* Agents asking to be paid what they're owed. Paying one writes the
          settlement that clears it from their balance. */}
      {settlements.length > 0 && (
        <div className="rounded-2xl border border-[color:var(--gold)]/40 bg-[var(--bg-surface)] p-4 space-y-3">
          <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">
            Payout requests ({settlements.length})
          </h2>
          {settlements.map((r) => (
            <div key={r.id} className="flex items-center gap-3 flex-wrap rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">
                  {r.agentName} · <span className="tabular-nums text-[color:var(--gold)]">ETB {fmt(r.amount)}</span>
                </p>
                <p className="text-[11px] text-[color:var(--text-muted)] capitalize">
                  {r.method} · <span className="tabular-nums font-mono">{r.account}</span> · {r.accountName}
                </p>
                {r.amount > r.agentOutstanding && (
                  <p className="text-[11px] text-[color:var(--red)] mt-0.5">
                    Only ETB {fmt(r.agentOutstanding)} is owed now — this request is stale.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => settle(r.id, "pay")} disabled={settling === r.id}
                  className="h-9 px-3 rounded-lg bg-[#2BD97420] border border-[#2BD97444] text-[color:var(--green)] text-[12px] font-bold disabled:opacity-40">
                  Mark paid
                </button>
                <button onClick={() => settle(r.id, "reject")} disabled={settling === r.id}
                  className="h-9 px-3 rounded-lg bg-[#FF3B5C20] border border-[#FF3B5C44] text-[color:var(--red)] text-[12px] font-bold disabled:opacity-40">
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {agents.length === 0 ? (
        <p className="text-center text-[13px] text-[color:var(--text-muted)] py-12">
          No payout agents yet. Withdrawals stay in the admin queue until you add one.
        </p>
      ) : (
        <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] divide-y divide-[color:var(--border-muted)] overflow-hidden">
          {agents.map((a) => (
            <div key={a.id} className="px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors">
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => router.push(`/admin/${secret}/payout-agents/${a.id}`)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-[13px] text-[color:var(--text-primary)]">{a.name || a.username}</p>
                  {a.isCashAgent && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-[color:var(--gold)] bg-[var(--bg-accent-dim)] border border-[color:var(--border-accent)]">CASH</span>
                  )}
                  {!a.isActive && <span className="text-[10px] font-bold text-[color:var(--red)]">DISABLED</span>}
                </div>
                <p className="text-[11px] text-[color:var(--text-muted)] font-mono">{a.username}</p>
                <p className="text-[11px] text-[color:var(--text-muted)] capitalize mt-0.5">
                  {a.methods.join(" · ") || "no methods"} · {a.commissionRate}% · {a.slaMinutes}m SLA
                  {a.maxWithdrawalEtb !== null && ` · max ${fmt(a.maxWithdrawalEtb)}`}
                </p>
              </button>

              <div className="flex items-center gap-4 text-right shrink-0">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">Open</p>
                  <p className="text-[13px] font-bold tabular-nums text-[color:var(--text-primary)]">{a.openRequests}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">Owed</p>
                  <p className="text-[13px] font-bold tabular-nums text-[color:var(--gold)]">{fmt(a.outstanding)}</p>
                </div>
                {a.isCashAgent && (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">Float</p>
                    <p className="text-[13px] font-bold tabular-nums" style={{ color: a.float > 0 ? "var(--green)" : "var(--text-muted)" }}>
                      {fmt(a.float)}
                    </p>
                  </div>
                )}
                {a.isCashAgent && (
                  <button onClick={() => { setTopupFor(topupFor === a.id ? null : a.id); setTopupAmount(""); }}
                    className="p-2 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--gold)]"
                    title="Top up float">
                    <Wallet className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => toggleActive(a)}
                  className="p-2 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
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
                <button onClick={() => topup(a)} disabled={toppingUp}
                  className="h-9 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[12px] disabled:opacity-40 inline-flex items-center gap-1.5">
                  {toppingUp && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Apply
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
