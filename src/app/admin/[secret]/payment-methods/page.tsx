"use client";

import { useEffect, useState, useCallback } from "react";
import { useAdminFetch } from "../useAdmin";
import { Loader2, Save, Check, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

interface Method {
  id: string;
  name: string;
  desc: string;
  logo: string;
  accent: string;
  agentLabel: string;
  agentNumber: string;
  agentName: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  minDeposit: number;
  maxDeposit: number;
  minWithdraw: number;
  maxWithdraw: number;
}

// Limits are held as strings while editing so the field can go empty without
// snapping back to 0.
const LIMIT_FIELDS = [
  ["minDeposit", "Min deposit"],
  ["maxDeposit", "Max deposit"],
  ["minWithdraw", "Min withdrawal"],
  ["maxWithdraw", "Max withdrawal"],
] as const;

type LimitField = (typeof LIMIT_FIELDS)[number][0];
type Draft = Record<"agentNumber" | "agentName" | LimitField, string>;

const draftOf = (m: Method): Draft => ({
  agentNumber: m.agentNumber,
  agentName: m.agentName,
  minDeposit: String(m.minDeposit),
  maxDeposit: String(m.maxDeposit),
  minWithdraw: String(m.minWithdraw),
  maxWithdraw: String(m.maxWithdraw),
});

export default function PaymentMethodsPage() {
  const adminFetch = useAdminFetch();
  const [methods, setMethods] = useState<Method[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch("/payment-methods");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMethods(data.methods);
      const d: Record<string, Draft> = {};
      for (const m of data.methods as Method[]) d[m.id] = draftOf(m);
      setDrafts(d);
    } catch {
      setError("Failed to load payment methods.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(id: string) {
    const draft = drafts[id];
    if (!draft?.agentNumber.trim() || !draft?.agentName.trim()) {
      setError("Agent number and name are both required.");
      return;
    }
    const limits = Object.fromEntries(
      LIMIT_FIELDS.map(([f]) => [f, Number(draft[f])])
    ) as Record<LimitField, number>;
    if (LIMIT_FIELDS.some(([f]) => !Number.isInteger(limits[f]) || limits[f] < 1)) {
      setError("Limits must be whole ETB amounts of 1 or more.");
      return;
    }
    setSaving(id);
    setError("");
    try {
      const res = await adminFetch("/payment-methods", {
        method: "POST",
        body: JSON.stringify({
          id,
          agentNumber: draft.agentNumber.trim(),
          agentName: draft.agentName.trim(),
          ...limits,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Failed to save.");
        return;
      }
      setMethods((prev) => prev.map((m) => m.id === id
        ? { ...m, agentNumber: draft.agentNumber.trim(), agentName: draft.agentName.trim(), ...limits }
        : m));
      setSavedId(id);
      setTimeout(() => setSavedId((s) => (s === id ? null : s)), 1800);
    } catch {
      setError("Network error â€” try again.");
    } finally {
      setSaving(null);
    }
  }

  // Availability saves immediately — a rail going down is an urgent action, and
  // making it wait behind the agent-details Save button invites half-applied state.
  async function toggle(m: Method, field: "depositEnabled" | "withdrawEnabled") {
    const next = !m[field];
    setMethods((prev) => prev.map((x) => (x.id === m.id ? { ...x, [field]: next } : x)));
    setError("");
    const res = await adminFetch("/payment-methods", {
      method: "PATCH",
      body: JSON.stringify({ id: m.id, [field]: next }),
    });
    if (!res.ok) {
      // Roll the optimistic flip back so the switch can't lie about a live rail.
      setMethods((prev) => prev.map((x) => (x.id === m.id ? { ...x, [field]: !next } : x)));
      setError("Could not change availability.");
    }
  }

  function setDraft(id: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function dirty(m: Method) {
    const d = drafts[m.id];
    if (!d) return false;
    const saved = draftOf(m);
    return (Object.keys(saved) as (keyof Draft)[]).some((k) => d[k] !== saved[k]);
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-[color:var(--text-primary)] flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-[color:var(--gold)]" />
          Payment Agents
        </h1>
        <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
          The destination account shown to players on the deposit page, plus the deposit and withdrawal limits enforced for each method.
        </p>
      </div>

      {error && (
        <p className="text-[13px] text-[color:var(--red)] bg-[#FF3B5C12] border border-[#FF3B5C33] rounded-xl px-4 py-3">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[color:var(--gold)]" />
        </div>
      ) : (
        <div className="space-y-4">
          {methods.map((m) => {
            const d = drafts[m.id] ?? draftOf(m);
            const isDirty = dirty(m);
            const isSaving = saving === m.id;
            const isSaved = savedId === m.id;
            return (
              <div key={m.id} className="rounded-2xl border border-[color:var(--border-base)] bg-[var(--bg-surface)] p-4 md:p-5">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="w-9 h-9 rounded-xl grid place-items-center text-[14px] font-bold shrink-0"
                    style={{ background: `${m.accent}1A`, color: m.accent, border: `1px solid ${m.accent}44` }}
                  >
                    {m.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-[color:var(--text-primary)]">{m.name}</p>
                    <p className="text-[12px] text-[color:var(--text-muted)] truncate">{m.desc}</p>
                  </div>
                </div>

                {/* Availability — saves on click, independent of the fields below */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {([
                    ["depositEnabled", "Deposits"],
                    ["withdrawEnabled", "Withdrawals"],
                  ] as const).map(([field, label]) => {
                    const on = m[field];
                    return (
                      <button
                        key={field}
                        onClick={() => toggle(m, field)}
                        className={cn(
                          "inline-flex items-center gap-2 px-3 h-9 rounded-xl text-[12px] font-semibold border transition-colors",
                          on
                            ? "border-[#2BD97444] bg-[#2BD97412] text-[color:var(--green)]"
                            : "border-[#FF3B5C44] bg-[#FF3B5C12] text-[color:var(--red)]"
                        )}
                      >
                        <span className={cn("w-1.5 h-1.5 rounded-full", on ? "bg-[var(--green)]" : "bg-[var(--red)]")} />
                        {label} {on ? "on" : "off"}
                      </button>
                    );
                  })}
                </div>

                {/* Fields */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">
                      {m.agentLabel}
                    </label>
                    <input
                      type="text"
                      value={d.agentNumber}
                      onChange={(e) => setDraft(m.id, "agentNumber", e.target.value)}
                      placeholder="e.g. 0912 345 678"
                      className="w-full h-11 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] focus:outline-none focus:border-[color:var(--border-accent)] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">
                      Account name
                    </label>
                    <input
                      type="text"
                      value={d.agentName}
                      onChange={(e) => setDraft(m.id, "agentName", e.target.value)}
                      placeholder="e.g. Yega Agent"
                      className="w-full h-11 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] focus:outline-none focus:border-[color:var(--border-accent)] transition-colors"
                    />
                  </div>
                </div>

                {/* Amount limits — enforced by the deposit/withdraw routes */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  {LIMIT_FIELDS.map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-[11px] uppercase tracking-[0.06em] text-[color:var(--text-muted)] mb-1.5">
                        {label} (ETB)
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={d[field]}
                        onChange={(e) => setDraft(m.id, field, e.target.value)}
                        className="w-full h-11 px-4 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[14px] tabular-nums focus:outline-none focus:border-[color:var(--border-accent)] transition-colors"
                      />
                    </div>
                  ))}
                </div>

                {/* Save */}
                <div className="flex justify-end mt-3">
                  <button
                    onClick={() => save(m.id)}
                    disabled={!isDirty || isSaving}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 h-10 rounded-xl text-[13px] font-bold transition-all",
                      isSaved
                        ? "bg-[var(--green)] text-[#09090B]"
                        : isDirty
                          ? "bg-gold-grad text-[#09090B] hover:scale-[1.02]"
                          : "bg-[var(--bg-elevated)] text-[color:var(--text-muted)] cursor-not-allowed"
                    )}
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" />
                      : isSaved ? <><Check className="w-4 h-4" /> Saved</>
                      : <><Save className="w-4 h-4" /> Save</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
