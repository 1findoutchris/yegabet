"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2, ChevronLeft, AlertTriangle, Clock, KeyRound, Copy, Check, Banknote,
  ShieldOff, ShieldCheck, Trash2,
} from "lucide-react";
import { useAdminFetch } from "../../useAdmin";

interface Sla { elapsedMinutes: number; breached: boolean; remainingMinutes: number }

interface Detail {
  id: string;
  username: string;
  name: string | null;
  isActive: boolean;
  methods: string[];
  commissionRate: number;
  slaMinutes: number;
  maxWithdrawalEtb: number | null;
  isCashAgent: boolean;
  stats: {
    open: number; completed: number; rejected: number; breaches: number;
    avgMinutes: number | null; slowestMinutes: number | null;
    paidOut: number; commission: number; outstanding: number;
    toppedUp: number; cashIn: number; cashOut: number;
    float: number; pendingCommission: number;
  };
  floatLedger: {
    id: string; type: string; amount: number;
    note: string | null; refId: string | null; createdAt: string;
  }[];
  requests: {
    id: string; publicId: string | null; amount: number; method: string;
    status: string; username: string; createdAt: string; paidAt: string | null;
    adminNote: string | null; sla: Sla | null;
  }[];
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });
const fmtDate = (s: string) => new Date(s).toLocaleString();

/** Which cash-rail rows put money on the float vs. take it off. Mirrors
 *  FLOAT_CREDIT in src/lib/agentLedger.ts — that module is server-only. */
const FLOAT_CREDIT_TYPES = new Set(["TOPUP", "CASH_PAYOUT", "COMMISSION_PAYOUT", "CASH_REVERSAL"]);

const LEDGER_LABEL: Record<string, string> = {
  TOPUP: "Float top-up",
  FLOAT_RETURN: "Float returned",
  CASH_DEPOSIT: "Counter deposit",
  CASH_PAYOUT: "Cash paid to player",
  CASH_REVERSAL: "Deposit cancelled",
  COMMISSION_PAYOUT: "Commission released",
};

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "var(--green)",
  REJECTED: "var(--red)",
  CANCELLED: "var(--text-muted)",
  PENDING: "var(--gold)",
  PROCESSING: "#F59E0B",
};

export default function PayoutAgentDetailPage() {
  const adminFetch = useAdminFetch();
  const { secret, agentId } = useParams<{ secret: string; agentId: string }>();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch(`/payout-agents/${agentId}`);
      if (!res.ok) throw new Error();
      setD(await res.json());
    } catch {
      toast.error("Failed to load agent");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  async function post(body: object, ok: string) {
    setActing(true);
    try {
      const res = await adminFetch(`/payout-agents/${agentId}`, { method: "POST", body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error ?? "Action failed"); return null; }
      toast.success(ok);
      await load();
      return j;
    } catch {
      toast.error("Network error");
      return null;
    } finally {
      setActing(false);
    }
  }

  async function remove() {
    if (!d) return;
    const typed = prompt(
      `Permanently delete ${d.name || d.username}? This can't be undone — deactivate instead if they might come back.\n\nType their username (${d.username}) to confirm:`
    );
    if (typed?.trim() !== d.username) {
      if (typed !== null) toast.error("Username didn't match — nothing deleted");
      return;
    }
    setActing(true);
    try {
      const res = await adminFetch(`/payout-agents/${agentId}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error ?? "Delete failed"); return; }
      toast.success("Agent deleted");
      router.push(`/admin/${secret}/payout-agents`);
    } catch {
      toast.error("Network error");
    } finally {
      setActing(false);
    }
  }

  if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" /></div>;
  if (!d) return <div className="p-8 text-[color:var(--red)] text-sm">Agent not found.</div>;

  const s = d.stats;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/admin/${secret}/payout-agents`} className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-elevated)]">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-[20px] font-bold text-[color:var(--text-primary)]">{d.name || d.username}</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] font-mono">
            {d.username} · <span className="capitalize font-sans">{d.methods.join(" · ")}</span> · {d.commissionRate}% · {d.slaMinutes}m SLA
            {d.maxWithdrawalEtb !== null && ` · max ${fmt(d.maxWithdrawalEtb)} per withdrawal`}
          </p>
        </div>
      </div>

      {issued && (
        <div className="rounded-2xl border border-[color:var(--green)]/40 bg-[var(--green)]/10 p-4">
          <p className="text-[13px] font-bold text-[color:var(--text-primary)]">New password — copy it now</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <code className="px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[13px] font-mono">{issued.password}</code>
            <button onClick={() => { navigator.clipboard.writeText(issued.password); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
              className="h-9 px-3 rounded-lg bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[12px] font-semibold inline-flex items-center gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5 text-[color:var(--green)]" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setIssued(null)} className="text-[12px] text-[color:var(--text-muted)] underline ml-auto">Done</button>
          </div>
        </div>
      )}

      {/* Performance */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Open", value: String(s.open), color: "var(--gold)" },
          { label: "Completed", value: String(s.completed), color: "var(--green)" },
          { label: "Rejected", value: String(s.rejected), color: "var(--text-secondary)" },
          { label: "SLA breaches", value: String(s.breaches), color: s.breaches > 0 ? "var(--red)" : "var(--text-muted)" },
          { label: "Avg time", value: s.avgMinutes === null ? "—" : `${s.avgMinutes}m`, color: "var(--text-primary)" },
          { label: "Slowest", value: s.slowestMinutes === null ? "—" : `${s.slowestMinutes}m`, color: "var(--text-primary)" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl bg-[var(--bg-surface)] border border-[color:var(--border-base)] p-3">
            <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">{label}</p>
            <p className="font-display text-[18px] font-extrabold tabular-nums mt-0.5" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Cash rail — a separate balance from what the payout rail owes them.
          The ledger below is the audit trail: every top-up, counter deposit,
          cash payout and cancellation, in order. */}
      {d.isCashAgent && (
        <div className="rounded-2xl border border-[color:var(--border-accent)] bg-[var(--bg-surface)] p-4">
          <h2 className="text-[14px] font-bold text-[color:var(--text-primary)] mb-3">Cash rail</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Float", value: s.float, color: "var(--green)" },
              { label: "Topped up", value: s.toppedUp, color: "var(--text-primary)" },
              { label: "Deposited out", value: s.cashIn, color: "var(--text-primary)" },
              { label: "Commission due", value: s.pendingCommission, color: "var(--gold)" },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">{label}</p>
                <p className="font-display text-[16px] font-extrabold tabular-nums mt-0.5" style={{ color }}>ETB {fmt(value)}</p>
              </div>
            ))}
          </div>

          {d.floatLedger.length > 0 && (
            <div className="mt-4 rounded-xl border border-[color:var(--border-muted)] overflow-hidden">
              <div className="max-h-72 overflow-y-auto divide-y divide-[color:var(--border-muted)]">
                {d.floatLedger.map((row) => {
                  const credit = FLOAT_CREDIT_TYPES.has(row.type);
                  return (
                    <div key={row.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[color:var(--text-primary)]">{LEDGER_LABEL[row.type] ?? row.type}</p>
                        <p className="text-[11px] text-[color:var(--text-muted)] truncate">
                          {fmtDate(row.createdAt)}{row.note ? ` · ${row.note}` : ""}
                        </p>
                      </div>
                      <p className="tabular-nums font-bold shrink-0"
                        style={{ color: credit ? "var(--green)" : "var(--red)" }}>
                        {credit ? "+" : "−"}ETB {fmt(row.amount)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Money owed — no float, so this is what the platform must pay back */}
      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Paid out", value: s.paidOut, color: "var(--text-primary)" },
            { label: "Commission", value: s.commission, color: "var(--green)" },
            { label: "Outstanding", value: s.outstanding, color: "var(--gold)" },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-[0.05em] text-[color:var(--text-muted)]">{label}</p>
              <p className="font-display text-[16px] font-extrabold tabular-nums mt-0.5" style={{ color }}>ETB {fmt(value)}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          <button
            onClick={() => { if (confirm(`Settle ETB ${fmt(s.outstanding)} with this agent?`)) post({ action: "settle" }, "Settled"); }}
            disabled={acting || s.outstanding <= 0}
            className="h-10 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] inline-flex items-center gap-2 disabled:opacity-40">
            <Banknote className="w-4 h-4" /> Settle outstanding
          </button>
          <button
            onClick={async () => {
              if (!confirm("Reset this agent's password? Their current one stops working.")) return;
              const j = await post({ action: "reset-password" }, "Password reset");
              if (j?.password) setIssued({ username: j.username, password: j.password });
            }}
            disabled={acting}
            className="h-10 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-secondary)] font-bold text-[13px] inline-flex items-center gap-2 disabled:opacity-40">
            <KeyRound className="w-4 h-4" /> Reset password
          </button>
        </div>
      </div>

      {/* Account actions. Deactivating is the reversible one: it stops new
          routing but leaves whatever is already assigned in place. */}
      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 space-y-3">
        <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">Account actions</h2>

        {d.isActive ? (
          <button
            onClick={() => { if (confirm("Deactivate this agent? They stop receiving new withdrawals and can no longer sign in.")) post({ action: "deactivate" }, "Agent deactivated"); }}
            disabled={acting}
            className="w-full h-10 rounded-xl bg-[#FF3B5C20] border border-[#FF3B5C44] text-[color:var(--red)] font-bold text-[13px] hover:bg-[#FF3B5C35] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
            <ShieldOff className="w-4 h-4" /> Deactivate agent
          </button>
        ) : (
          <button
            onClick={() => post({ action: "activate" }, "Agent activated")}
            disabled={acting}
            className="w-full h-10 rounded-xl bg-[#2BD97420] border border-[#2BD97444] text-[color:var(--green)] font-bold text-[13px] hover:bg-[#2BD97435] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Activate agent
          </button>
        )}

        <div className="pt-3 border-t border-[color:var(--border-muted)]">
          <button onClick={remove} disabled={acting}
            className="w-full h-10 rounded-xl bg-[#FF3B5C] text-white font-bold text-[13px] hover:bg-[#E02F4E] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
            {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete agent
          </button>
          <p className="text-[11px] text-[color:var(--text-muted)] mt-2">
            Needs everything settled first: nothing owed to them, no float or unreleased commission,
            no open withdrawal or settlement request. Players&rsquo; withdrawal records are kept.
          </p>
        </div>
      </div>

      {/* Recent requests — the publicId is what the admin quotes when chasing a delay */}
      <div className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[color:var(--border-muted)]">
          <h2 className="text-[14px] font-bold text-[color:var(--text-primary)]">Recent requests</h2>
        </div>
        {d.requests.length === 0 ? (
          <p className="text-center text-[13px] text-[color:var(--text-muted)] py-10">Nothing routed to this agent yet.</p>
        ) : (
          <div className="divide-y divide-[color:var(--border-muted)]">
            {d.requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[12px] font-bold text-[color:var(--gold)]">{r.publicId}</span>
                    {r.sla && (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        r.sla.breached
                          ? "bg-[#FF3B5C1A] text-[color:var(--red)] border border-[#FF3B5C44]"
                          : "bg-[var(--bg-elevated)] text-[color:var(--text-muted)] border border-[color:var(--border-base)]"
                      }`}>
                        {r.sla.breached ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {r.sla.elapsedMinutes}m
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 capitalize">
                    {r.method} · @{r.username} · {fmtDate(r.paidAt ?? r.createdAt)}
                  </p>
                  {r.adminNote && <p className="text-[11px] text-[color:var(--text-muted)] italic">{r.adminNote}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-[13px] tabular-nums text-[color:var(--text-primary)]">ETB {fmt(r.amount)}</p>
                  <p className="text-[10px] font-bold" style={{ color: STATUS_COLOR[r.status] ?? "var(--text-muted)" }}>{r.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
