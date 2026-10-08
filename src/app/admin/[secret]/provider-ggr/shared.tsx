"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Calendar, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NEGATIVE_POLICIES, type NegativePolicy } from "@/lib/providerGgrCore";
import { useAdminFetch } from "../useAdmin";

export type Rate = {
  id: string; providerKey: string; ratePct: number; policy: NegativePolicy;
  effectiveFrom: string; changedBy: string; note: string | null; createdAt: string;
};

export type Totals = {
  totalBet: number; totalWin: number; ggr: number; fee: number; remaining: number; rounds: number;
  unsettledBet: number; unsettledRounds: number; voidedBet: number; voidedRounds: number;
  rate: Rate | null; mixedRates: boolean; unratedGgr: number;
};

export const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number, currency: string) => `${currency} ${fmt(n)}`;
export const policyLabel = (p: NegativePolicy) => NEGATIVE_POLICIES.find((x) => x.id === p)?.label ?? p;
export const ggrTone = (n: number) => (n >= 0 ? "text-[color:var(--gold)]" : "text-[color:var(--red)]");

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "custom", label: "Custom Range" },
] as const;

/** The selected range, from the URL — shared by overview and details. */
export function useRange() {
  const sp = useSearchParams();
  const period = sp.get("period") ?? "month";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const query = period === "custom" ? `period=custom&from=${from}&to=${to}` : `period=${period}`;
  return { period, from, to, query, ready: period !== "custom" || (!!from && !!to) };
}

export function PeriodPicker({ loading }: { loading: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { period, from, to } = useRange();
  const [cf, setCf] = useState(from);
  const [ct, setCt] = useState(to);
  const go = (q: string) => router.replace(`${pathname}?${q}`);

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {PERIODS.map((t) => (
          <button key={t.id} onClick={() => (t.id === "custom" ? go(`period=custom&from=${cf}&to=${ct}`) : go(`period=${t.id}`))}
            className={cn(
              "px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors border",
              period === t.id
                ? "bg-[var(--bg-accent-dim)] text-[color:var(--gold)] border-[color:var(--border-accent)]"
                : "bg-[var(--bg-elevated)] text-[color:var(--text-secondary)] border-[color:var(--border-base)] hover:text-[color:var(--text-primary)]"
            )}>
            {t.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex flex-wrap gap-3 items-end p-4 rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-base)]">
          <DateField label="From" value={cf} onChange={setCf} />
          <DateField label="To" value={ct} onChange={setCt} />
          <button onClick={() => go(`period=custom&from=${cf}&to=${ct}`)} disabled={!cf || !ct || loading}
            className="h-9 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] disabled:opacity-50 flex items-center gap-2">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
            Apply
          </button>
        </div>
      )}
    </>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">{label}</label>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]" />
    </div>
  );
}

export function RangeNote({ fromDay, toDay, tz }: { fromDay: string; toDay: string; tz: string }) {
  return (
    <p className="text-[12px] text-[color:var(--text-muted)]">
      {fromDay === toDay ? fromDay : `${fromDay} → ${toDay}`} · times in {tz}
    </p>
  );
}

export function StatCard({ label, value, sub, tone = "neutral" }: {
  label: string; value: string; sub?: string; tone?: "neutral" | "gold" | "red" | "purple" | "green";
}) {
  const c = {
    neutral: { bg: "var(--bg-surface)", border: "var(--border-base)" },
    gold: { bg: "var(--bg-accent-dim)", border: "var(--border-accent)" },
    red: { bg: "#FF3B5C18", border: "#FF3B5C33" },
    purple: { bg: "#C07AFF18", border: "#C07AFF33" },
    green: { bg: "#10B98118", border: "#10B98133" },
  }[tone];
  return (
    <div className="rounded-2xl border p-4" style={{ background: c.bg, borderColor: c.border }}>
      <p className="text-[11px] text-[color:var(--text-muted)] uppercase tracking-wide mb-2">{label}</p>
      <p className="text-[17px] font-bold text-[color:var(--text-primary)] leading-tight tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

/** The five headline figures plus unsettled, for one currency. */
export function TotalsCards({ t, currency }: { t: Pick<Totals, "totalBet" | "totalWin" | "ggr" | "fee" | "remaining" | "unsettledBet">; currency: string }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard label="Total Bet" value={money(t.totalBet, currency)} sub="Settled stakes" />
      <StatCard label="Total Win" value={money(t.totalWin, currency)} sub="Payouts incl. refunds" tone="red" />
      <StatCard label="GGR" value={money(t.ggr, currency)} sub="Bet − Win" tone={t.ggr >= 0 ? "gold" : "red"} />
      <StatCard label="Provider Fee" value={money(t.fee, currency)} tone="purple" />
      <StatCard label="Remaining GGR" value={money(t.remaining, currency)} sub="After fee" tone={t.remaining >= 0 ? "green" : "red"} />
      <StatCard label="Unsettled" value={money(t.unsettledBet, currency)} sub="Open stakes, not in GGR" />
    </div>
  );
}

/** Add a new rate version. Rates are never edited in place. */
export function RateForm({ providerKey, current, today, onSaved, compact }: {
  providerKey: string; current: Rate | null; today: string; onSaved: () => void; compact?: boolean;
}) {
  const adminFetch = useAdminFetch();
  const [pct, setPct] = useState(current ? String(current.ratePct) : "");
  const [policy, setPolicy] = useState<NegativePolicy>(current?.policy ?? "net_floor");
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const backdated = from < today;

  async function save() {
    const ratePct = Number(pct);
    if (pct.trim() === "" || !Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
      toast.error("Enter a percentage from 0 to 100");
      return;
    }
    setBusy(true);
    try {
      const res = await adminFetch("/provider-ggr/rates", {
        method: "POST",
        body: JSON.stringify({ providerKey, ratePct, negativePolicy: policy, effectiveFrom: from, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error ?? "Could not save"); return; }
      toast.success(`Saved ${ratePct}% from ${from}`);
      setNote("");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const input = "h-9 px-3 rounded-xl bg-[var(--bg-elevated)] border border-[color:var(--border-base)] text-[color:var(--text-primary)] text-[13px] focus:outline-none focus:border-[color:var(--border-accent)]";
  return (
    <div className={cn("flex flex-wrap gap-2 items-end", !compact && "p-4 rounded-2xl bg-[var(--bg-surface)] border border-[color:var(--border-base)]")}>
      <div>
        <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">Fee %</label>
        <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" placeholder="e.g. 8" className={cn(input, "w-24")} />
      </div>
      <div>
        <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">When GGR is negative</label>
        <select value={policy} onChange={(e) => setPolicy(e.target.value as NegativePolicy)} className={input}>
          {NEGATIVE_POLICIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">Effective from</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
      </div>
      <div className="flex-1 min-w-[160px]">
        <label className="block text-[11px] text-[color:var(--text-muted)] mb-1">
          Note{backdated && <span className="text-[color:var(--red)]"> — required: this recalculates past days</span>}
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. new contract" className={cn(input, "w-full")} />
      </div>
      <button onClick={save} disabled={busy || (backdated && !note.trim())}
        className="h-9 px-4 rounded-xl bg-gold-grad text-[#09090B] font-bold text-[13px] disabled:opacity-50 flex items-center gap-2">
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save new rate
      </button>
    </div>
  );
}
